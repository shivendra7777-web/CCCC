import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import gameRoutes from './routes/game.js';
import miningRoutes from './routes/mining.js';
import referralRoutes from './routes/referrals.js';
import { generateCrashPoint } from './services/gameEngine.js';
import { supabase } from './services/supabase.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// REST API Routes
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/mining', miningRoutes);
app.use('/api/referrals', referralRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ========== SOCKET.IO CRASH GAME ==========
// All connected clients see the SAME crash game in real-time

const crashState = {
  gameState: 'betting',   // betting | flying | crashed
  multiplier: 1.0,
  crashPoint: null,
  elapsed: 0,
  roundNumber: 1,
  timeLeft: 5,
  history: [2.45, 1.12, 5.67, 1.89, 3.21, 1.05, 8.90, 2.34, 1.45, 6.78],
  activeBets: new Map(), // userId -> { betId, amount, autoCashout, username }
  cashedOut: new Set(),
  serverSeedHash: generateSeedHash(),
  flyInterval: null,
  countdownInterval: null,
};

function generateSeedHash() {
  return Math.random().toString(36).substring(2, 18) + '...';
}

function broadcastState() {
  io.emit('crash:state', {
    gameState: crashState.gameState,
    multiplier: crashState.multiplier,
    crashPoint: crashState.crashPoint,
    timeLeft: crashState.timeLeft,
    roundNumber: crashState.roundNumber,
    history: crashState.history,
    serverSeedHash: crashState.serverSeedHash,
    activeBets: Array.from(crashState.activeBets.entries()).map(([uid, bet]) => ({
      userId: uid, ...bet, status: crashState.cashedOut.has(uid) ? 'cashed' : 'active'
    }))
  });
}

function startFlying() {
  crashState.gameState = 'flying';
  crashState.crashPoint = generateCrashPoint();
  crashState.elapsed = 0;
  crashState.cashedOut.clear();
  crashState.serverSeedHash = generateSeedHash();
  broadcastState();

  let lastParticleTime = 0;
  const particles = [];

  crashState.flyInterval = setInterval(() => {
    crashState.elapsed += 0.06;
    crashState.multiplier = Math.max(1.0, 1.0 + 0.06 * crashState.elapsed * crashState.elapsed);

    // Auto-cashout check
    for (const [userId, bet] of crashState.activeBets) {
      if (crashState.cashedOut.has(userId)) continue;
      const auto = parseFloat(bet.autoCashout);
      if (auto >= 1.01 && crashState.multiplier >= auto) {
        crashState.cashedOut.add(userId);
        // Emit cashout event to that user's socket
        io.to(`user:${userId}`).emit('crash:autoCashed', {
          multiplier: crashState.multiplier,
          winAmount: bet.amount * crashState.multiplier
        });
      }
    }

    // Generate particles
    const now = Date.now();
    if (now - lastParticleTime > 80) {
      lastParticleTime = now;
      particles.push({ id: now, opacity: 1 });
      if (particles.length > 25) particles.shift();
    }

    broadcastState();

    if (crashState.multiplier >= crashState.crashPoint) {
      crashState.multiplier = crashState.crashPoint;
      clearInterval(crashState.flyInterval);
      crashState.gameState = 'crashed';
      broadcastState();

      // Process results for all bets (async helper)
      async function processCrashResults() {
        for (const [userId, bet] of crashState.activeBets) {
          if (crashState.cashedOut.has(userId)) {
            // Already handled by cashout/autoCashed event
            continue;
          }
          // Lost - update DB
          try {
            const { data: lostUser } = await supabase.from('users').select('total_lost').eq('id', userId).single();
            if (lostUser) {
              const newLost = parseFloat((lostUser.total_lost + bet.amount).toFixed(4));
              await supabase.from('users').update({ total_lost: newLost }).eq('id', userId);
              await supabase.from('bets').update({
                status: 'lost', result_value: crashState.crashPoint,
                profit: -bet.amount, settled_at: new Date().toISOString()
              }).eq('id', bet.betId);
            }
          } catch (e) {
            console.error('Failed to process crash loss for user', userId, e.message);
          }

          io.to(`user:${userId}`).emit('crash:lost', {
            crashPoint: crashState.crashPoint,
            lostAmount: bet.amount
          });
        }
      }
      processCrashResults();

      crashState.history = [crashState.crashPoint, ...crashState.history].slice(0, 20);
      crashState.activeBets.clear();

      setTimeout(() => {
        crashState.roundNumber++;
        startRound();
      }, 3000);
    }
  }, 50);
}

function startRound() {
  crashState.gameState = 'betting';
  crashState.multiplier = 1.0;
  crashState.crashPoint = null;
  crashState.elapsed = 0;
  crashState.timeLeft = 5;
  crashState.activeBets.clear();
  crashState.cashedOut.clear();
  crashState.serverSeedHash = generateSeedHash();
  broadcastState();

  let countdown = 5;
  crashState.countdownInterval = setInterval(() => {
    countdown -= 1;
    crashState.timeLeft = countdown;
    broadcastState();

    if (countdown <= 0) {
      clearInterval(crashState.countdownInterval);
      startFlying();
    }
  }, 1000);
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join user-specific room for targeted events
  socket.on('auth', (userId) => {
    socket.join(`user:${userId}`);
    console.log(`Socket ${socket.id} joined room user:${userId}`);
  });

  // Place bet via socket (real-time)
  socket.on('crash:bet', async ({ userId, amount, autoCashout }) => {
    if (crashState.gameState !== 'betting') {
      socket.emit('crash:error', { message: 'Betting closed' });
      return;
    }

    try {
      const { data: user } = await supabase.from('users').select('balance, username').eq('id', userId).single();
      if (!user || user.balance < amount) {
        socket.emit('crash:error', { message: 'Insufficient balance' });
        return;
      }

      const newBalance = parseFloat((user.balance - amount).toFixed(4));
      await supabase.from('users').update({ balance: newBalance }).eq('id', userId);

      const { data: bet } = await supabase.from('bets').insert({
        user_id: userId, amount,
        auto_cashout: autoCashout || null,
        status: 'active',
        placed_at: new Date().toISOString()
      }).select().single();

      crashState.activeBets.set(userId, {
        betId: bet.id, amount, autoCashout: autoCashout || '0', username: user.username
      });

      socket.emit('crash:betConfirmed', { betId: bet.id, balance: newBalance });
      broadcastState();
    } catch (e) {
      socket.emit('crash:error', { message: e.message });
    }
  });

  // Manual cashout via socket
  socket.on('crash:cashout', ({ userId }) => {
    if (crashState.gameState !== 'flying') {
      socket.emit('crash:error', { message: 'Not flying' });
      return;
    }

    const bet = crashState.activeBets.get(userId);
    if (!bet || crashState.cashedOut.has(userId)) {
      socket.emit('crash:error', { message: 'No active bet' });
      return;
    }

    // Async processing
    async function processCashout() {
      try {
        const mult = crashState.multiplier;
        const winAmount = parseFloat((bet.amount * mult).toFixed(4));
        const profit = parseFloat((winAmount - bet.amount).toFixed(4));

        const { data: user } = await supabase.from('users').select('balance, total_won').eq('id', userId).single();
        if (!user) throw new Error('User not found');

        const newBalance = parseFloat((user.balance + winAmount).toFixed(4));
        const newWon = parseFloat((user.total_won + profit).toFixed(4));

        await supabase.from('users').update({ balance: newBalance, total_won: newWon }).eq('id', userId);
        await supabase.from('bets').update({
          status: 'cashed_out', cashed_out_at: mult, profit,
          settled_at: new Date().toISOString()
        }).eq('id', bet.betId);

        crashState.cashedOut.add(userId);
        socket.emit('crash:cashedOut', { multiplier: mult, winAmount, profit, balance: newBalance });
        broadcastState();
      } catch (e) {
        socket.emit('crash:error', { message: e.message });
      }
    }
    processCashout();
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start the first round
startRound();

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 TONMINE Backend running on http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready for real-time crash games`);
  console.log(`🎮 REST API at http://localhost:${PORT}/api`);
});
