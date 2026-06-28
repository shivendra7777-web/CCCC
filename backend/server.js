import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv'; // 👈 ADD THIS
import authRoutes from './routes/auth.js';
import gameRoutes from './routes/game.js';
import miningRoutes from './routes/mining.js';
import referralRoutes from './routes/referrals.js';
import { generateCrashPoint } from './services/gameEngine.js';
import { supabase } from './services/supabase.js';

dotenv.config(); // 👈 ADD THIS

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/mining', miningRoutes);
app.use('/api/referrals', referralRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ========== SOCKET.IO CRASH GAME ==========
const crashState = {
  gameState: 'betting',
  multiplier: 1.0,
  crashPoint: null,
  elapsed: 0,
  roundNumber: 1,
  timeLeft: 5,
  history: [2.45, 1.12, 5.67, 1.89, 3.21, 1.05, 8.90, 2.34, 1.45, 6.78],
  activeBets: new Map(),
  cashedOut: new Set(),
  serverSeedHash: generateSeedHash(),
  flyInterval: null,
  countdownInterval: null,
  currentRoundId: null, // 👈 ADD THIS (Game round track karne ke liye)
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
        async function processAutoCashout() {
          try {
            const mult = crashState.multiplier;
            // 👇 SECURE RPC CALL: Balance me profit add hoga, total_won badhega
            const { error } = await supabase.rpc('cashout_crash_bet', {
              p_bet_id: bet.betId,
              p_cashout_multiplier: mult
            });

            if (error) throw new Error(error.message);

            const { data: user } = await supabase.from('users').select('balance').eq('id', userId).single();
            const winAmount = parseFloat((bet.amount * mult).toFixed(4));
            const profit = parseFloat((winAmount - bet.amount).toFixed(4));

            io.to(`user:${userId}`).emit('crash:autoCashed', {
              multiplier: mult, winAmount, profit, balance: user.balance
            });
          } catch (e) {
            console.error('Auto-cashout failed:', e.message);
          }
        }
        processAutoCashout();
      }
    }

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

      async function processCrashResults() {
        // 👇 Game round ko 'crashed' mark karo DB me
        await supabase.from('game_rounds').update({
          status: 'crashed', crash_point: crashState.crashPoint, ended_at: new Date().toISOString()
        }).eq('id', crashState.currentRoundId);

        for (const [userId, bet] of crashState.activeBets) {
          if (crashState.cashedOut.has(userId)) continue;
          try {
            // 👇 SECURE RPC CALL: Bet 'lost' mark hogi, total_lost badhega
            await supabase.rpc('settle_instant_bet', {
              p_bet_id: bet.betId,
              p_is_win: false,
              p_profit_amount: 0,
              p_result_value: crashState.crashPoint
            });

            io.to(`user:${userId}`).emit('crash:lost', {
              crashPoint: crashState.crashPoint,
              lostAmount: bet.amount
            });
          } catch (e) {
            console.error('Failed to process crash loss for user', userId, e.message);
          }
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

async function startRound() {
  crashState.gameState = 'betting';
  crashState.multiplier = 1.0;
  crashState.crashPoint = null;
  crashState.elapsed = 0;
  crashState.timeLeft = 5;
  crashState.activeBets.clear();
  crashState.cashedOut.clear();
  crashState.serverSeedHash = generateSeedHash();
  
  // 👇 DATABASE: Naye round ki entry game_rounds table me
  try {
    const { data: newRound } = await supabase.from('game_rounds').insert({
      game_type: 'crash',
      round_number: crashState.roundNumber,
      server_seed_hash: crashState.serverSeedHash,
      status: 'betting',
      started_at: new Date().toISOString()
    }).select().single();
    
    crashState.currentRoundId = newRound.id;
  } catch (e) {
    console.error("Round create nahi hua:", e.message);
  }

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

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

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
      // 👇 SECURE RPC CALL: Balance katega, Wager track hoga, Transaction save hogi
      const { data: betId, error: betError } = await supabase.rpc('place_bet_securely', {
        p_user_id: userId,
        p_game_round_id: crashState.currentRoundId,
        p_amount: amount,
        p_auto_cashout: autoCashout || null,
        p_target_value: null,
        p_dice_direction: null
      });

      if (betError) {
        socket.emit('crash:error', { message: betError.message.includes('Insufficient') ? 'Insufficient balance' : betError.message });
        return;
      }

      const { data: user } = await supabase.from('users').select('balance, username').eq('id', userId).single();

      crashState.activeBets.set(userId, {
        betId: betId, amount, autoCashout: autoCashout || '0', username: user.username
      });

      socket.emit('crash:betConfirmed', { betId: betId, balance: user.balance });
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

    async function processCashout() {
      try {
        const mult = crashState.multiplier;
        
        // 👇 SECURE RPC CALL: Balance me profit add hoga, total_won badhega
        const { error } = await supabase.rpc('cashout_crash_bet', {
          p_bet_id: bet.betId,
          p_cashout_multiplier: mult
        });

        if (error) throw new Error(error.message);

        const { data: user } = await supabase.from('users').select('balance').eq('id', userId).single();
        const winAmount = parseFloat((bet.amount * mult).toFixed(4));
        const profit = parseFloat((winAmount - bet.amount).toFixed(4));

        crashState.cashedOut.add(userId);
        socket.emit('crash:cashedOut', { multiplier: mult, winAmount, profit, balance: user.balance });
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

startRound();

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 TONMINE Backend running on http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready for real-time crash games`);
  console.log(`🎮 REST API at http://localhost:${PORT}/api`);
});