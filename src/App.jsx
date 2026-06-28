import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { 
  Zap, Pickaxe, Gamepad2, Trophy, Wallet, 
  Copy, Share2, RefreshCw, Shield, ArrowUpDown, 
  Clock, AlertTriangle, ChevronDown, ChevronUp, Infinity,
  Users, Gift, X
} from 'lucide-react';
import { supabase } from './supabaseClient';
import { 
  updateUser as apiUpdateUser, 
  addTransaction as apiAddTransaction, 
  placeBet as apiPlaceBet, 
  updateBet as apiUpdateBet, 
  addMiningTap as apiAddMiningTap, 
  getLeaderboard as apiGetLeaderboard,
  getReferralStats as apiGetReferralStats,
  getUserByReferralCode as apiGetUserByReferralCode,
  createUserWithReferral as apiCreateUserWithReferral,
  createUser as apiCreateUser
} from './api';

const formatTMC = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatTON = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const generateRefCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
};

// ============================================
// APP
// ============================================
export default function App() {
  const [activeTab, setActiveTab] = useState('mine');
  const [isReady, setIsReady] = useState(false);

  // Referral system state
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [inviterInfo, setInviterInfo] = useState(null);
  const [pendingReferral, setPendingReferral] = useState(() => {
    return localStorage.getItem('tonmine_pending_ref') || null;
  });
  const [isNewUser, setIsNewUser] = useState(false);

  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('tonmine_user');
    const base = {
      id: null,
      telegramId: null,
      username: 'TonMiner', tmcBalance: 1247.50, totalMined: 748.50, totalWagered: 450.00,
      totalWon: 374.20, totalLost: 200.00, miningRate: 0.5, miningLevel: 1,
      energy: 100, maxEnergy: 100, lastTapAt: null, lastDailyTapAt: 0,
      lastActiveAt: Date.now(), lastEnergyRegen: Date.now(),
      claimStreak: 3, lastClaimAt: Date.now() - 86400000,
      referralCode: generateRefCode(), referredBy: null, referrals: 0,
      tonWalletAddress: null, totalMinedEver: 1248.50,
    };
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...base, ...parsed };
    }
    return base;
  });

  // ===== TELEGRAM WEBAPP INIT + REFERRAL DETECTION =====
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();

      const initData = tg.initDataUnsafe || {};
      const startParam = initData.start_param || new URLSearchParams(window.location.search).get('start') || new URLSearchParams(window.location.search).get('startapp');

      if (startParam) {
        console.log('🔗 Referral parameter detected:', startParam);
        localStorage.setItem('tonmine_pending_ref', startParam);
        setPendingReferral(startParam);
      }
    }
  }, []);

  // ===== USER LOAD / CREATE WITH REFERRAL =====
  useEffect(() => {
    async function initUser() {
      try {
        // In production: const telegramId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
        const telegramId = 100001;

        console.log('Fetching user from Supabase...');
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('telegram_id', telegramId)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.log('Supabase user fetch error:', error.message);
          setUser(prev => ({ ...prev, id: 'local-' + Date.now() }));
          setIsReady(true);
          return;
        }

        if (data) {
          // EXISTING USER
          console.log('Existing user loaded:', data.username, 'ID:', data.id);

          // Check if user was referred and hasn't seen welcome yet
          if (data.referred_by && !localStorage.getItem('tonmine_ref_welcomed_' + data.id)) {
            try {
              const { data: referrer } = await supabase
                .from('users')
                .select('username, referral_code')
                .eq('id', data.referred_by)
                .single();
              if (referrer) {
                setInviterInfo(referrer);
                setShowReferralModal(true);
                localStorage.setItem('tonmine_ref_welcomed_' + data.id, 'true');
              }
            } catch (e) { console.log('Could not load referrer info'); }
          }

          setUser({
            id: data.id,
            telegramId: data.telegram_id,
            username: data.username || 'TonMiner',
            tmcBalance: parseFloat(data.balance) || 0,
            totalMined: parseFloat(data.total_mined) || 0,
            totalMinedEver: parseFloat(data.total_mined_ever) || 0,
            totalWagered: parseFloat(data.total_wagered) || 0,
            totalWon: parseFloat(data.total_won) || 0,
            totalLost: parseFloat(data.total_lost) || 0,
            miningRate: parseFloat(data.mining_rate) || 0.5,
            miningLevel: data.mining_level || 1,
            energy: data.energy || 100,
            maxEnergy: data.max_energy || 100,
            lastTapAt: data.last_daily_tap_at,
            lastDailyTapAt: data.last_daily_tap_at ? new Date(data.last_daily_tap_at).getTime() : 0,
            lastActiveAt: Date.now(),
            lastEnergyRegen: data.last_energy_regen ? new Date(data.last_energy_regen).getTime() : Date.now(),
            claimStreak: data.claim_streak || 0,
            lastClaimAt: data.last_claim_at ? new Date(data.last_claim_at).getTime() : Date.now() - 86400000,
            referralCode: data.referral_code || generateRefCode(),
            referredBy: data.referred_by,
            referrals: 0,
            tonWalletAddress: data.ton_wallet_address,
          });
          setIsReady(true);
        } else {
          // NEW USER — check for pending referral
          const pendingRef = localStorage.getItem('tonmine_pending_ref');
          const newRefCode = generateRefCode();

          const baseUserData = {
            telegram_id: telegramId,
            username: 'TonMiner',
            first_name: window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || 'Player',
            referral_code: newRefCode,
            mining_rate: 0.5,
            mining_level: 1,
            balance: 0,
            total_mined: 0,
            total_mined_ever: 0,
            total_wagered: 0,
            total_won: 0,
            total_lost: 0,
            energy: 100,
            max_energy: 100,
            claim_streak: 0,
          };

          let newUserData;

          if (pendingRef) {
            console.log('Creating user with referral:', pendingRef);
            try {
              newUserData = await apiCreateUserWithReferral(baseUserData, pendingRef);
              setIsNewUser(true);

              // Load referrer info for welcome modal
              const { data: referrer } = await supabase
                .from('users')
                .select('username, referral_code')
                .eq('referral_code', pendingRef)
                .single();
              if (referrer) {
                setInviterInfo(referrer);
                setShowReferralModal(true);
              }
              localStorage.setItem('tonmine_ref_welcomed_' + newUserData.id, 'true');
              localStorage.removeItem('tonmine_pending_ref');
              setPendingReferral(null);
            } catch (e) {
              console.error('Referral creation failed, creating without:', e);
              newUserData = await apiCreateUser(baseUserData);
            }
          } else {
            console.log('Creating user without referral');
            newUserData = await apiCreateUser(baseUserData);
          }

          console.log('New user created:', newUserData.id);
          setUser({
            id: newUserData.id,
            telegramId: newUserData.telegram_id,
            username: newUserData.username || 'TonMiner',
            tmcBalance: parseFloat(newUserData.balance) || 0,
            totalMined: 0, totalMinedEver: 0,
            totalWagered: 0, totalWon: 0, totalLost: 0,
            miningRate: 0.5, miningLevel: 1,
            energy: 100, maxEnergy: 100,
            lastDailyTapAt: 0, lastActiveAt: Date.now(),
            lastEnergyRegen: Date.now(),
            claimStreak: 0, lastClaimAt: Date.now() - 86400000,
            referralCode: newUserData.referral_code || newRefCode,
            referredBy: newUserData.referred_by,
            referrals: 0,
            tonWalletAddress: null,
          });
          setIsReady(true);
        }
      } catch (err) {
        console.error('User init error:', err);
        setUser(prev => ({ ...prev, id: 'local-' + Date.now() }));
        setIsReady(true);
      }
    }

    initUser();
  }, []);

  const [transactions, setTransactions] = useState([]);

  // Load transactions from Supabase when user is ready
  useEffect(() => {
    async function loadTransactions() {
      const fallback = [
        { id: 1, type: 'crash_win', amount: 234.50, direction: 'credit', created_at: Date.now() - 120000, note: 'Cashed @ 2.45×' },
        { id: 2, type: 'bet_debit', amount: 50.00, direction: 'debit', created_at: Date.now() - 300000, note: 'Rolled 43 < 50' },
        { id: 3, type: 'mining_passive', amount: 12.34, direction: 'credit', created_at: Date.now() - 3600000, note: 'Passive mining' },
        { id: 4, type: 'deposit', amount: 1000.00, direction: 'credit', created_at: Date.now() - 10800000, ton_amount: 1.0, note: 'TON Deposit' },
      ];

      if (!user?.id) {
        setTransactions(fallback);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (error || !data || data.length === 0) {
          setTransactions(fallback);
          return;
        }

        const mapped = data.map(tx => ({
          id: tx.id, type: tx.type, amount: parseFloat(tx.amount),
          direction: tx.direction, created_at: new Date(tx.created_at).getTime(),
          note: tx.metadata?.note || tx.type.replace(/_/g, ' '),
          ton_amount: tx.metadata?.ton_amount,
        }));
        setTransactions(mapped);
      } catch (err) {
        setTransactions(fallback);
      }
    }

    loadTransactions();
  }, [user?.id]);

  const [floatingTexts, setFloatingTexts] = useState([]);
  const [liveBets, setLiveBets] = useState([
    { id: 1, username: 'CryptoKing', amount: 50, game: 'Crash', result: 'win', multiplier: 2.10, profit: 55 },
    { id: 2, username: 'Anonymous', amount: 100, game: 'Dice', result: 'lose', profit: -100 },
    { id: 3, username: 'TonWhale', amount: 500, game: 'Limbo', result: 'win', multiplier: 5.6, profit: 2300 },
  ]);

  // ===== CRASH GAME STATE =====
  const [crashDisplay, setCrashDisplay] = useState({
    gameState: 'betting', multiplier: 1.0, displayMultiplier: 1.0,
    crashPoint: null, timeLeft: 5, roundNumber: 1,
    chartPoints: [{ t: 0, m: 1.0 }], history: [2.45, 1.12, 5.67, 1.89, 3.21, 1.05, 8.90, 2.34, 1.45, 6.78],
    screenShake: false, particles: [], roundBets: [],
    serverSeedHash: 'a3f8c2d1...', rocketRotation: -45,
  });
  const [crashUserBet, setCrashUserBet] = useState(null);
  const [crashUserCashed, setCrashUserCashed] = useState(false);
  const [crashAutoCashout, setCrashAutoCashout] = useState('1.98');
  const [crashBetAmount, setCrashBetAmount] = useState(50);
  const [crashAutoBet, setCrashAutoBet] = useState(false);
  const [showAutoBetSettings, setShowAutoBetSettings] = useState(false);
  const [autoBetSettings, setAutoBetSettings] = useState({
    baseAmount: 50, onWin: { action: 'reset', value: 0 },
    onLoss: { action: 'increase', value: 100 },
    stopOnWin: 0, stopOnLoss: 0, maxBet: 10000, rounds: 0,
  });
  const [autoBetStats, setAutoBetStats] = useState({ wins: 0, losses: 0, currentBet: 50, roundsLeft: 0, totalProfit: 0, totalLoss: 0 });

  const gameRef = useRef({
    gameState: 'betting', multiplier: 1.0, crashPoint: null,
    elapsed: 0, chartPoints: [{ t: 0, m: 1.0 }], particles: [],
    roundBets: [], roundNumber: 1, screenShake: false,
    serverSeedHash: 'a3f8c2d1...', rocketRotation: -45,
    history: [2.45, 1.12, 5.67, 1.89, 3.21, 1.05, 8.90, 2.34, 1.45, 6.78],
  });
  const userBetRef = useRef(null);
  const userCashedRef = useRef(false);
  const autoCashoutRef = useRef('');
  const autoBetRef = useRef(false);
  const autoBetSettingsRef = useRef(autoBetSettings);
  const autoBetStatsRef = useRef(autoBetStats);
  const betAmountRef = useRef(50);
  const userRef = useRef(user);
  const timerRef = useRef(null);
  const lastDisplayUpdateRef = useRef(0);
  const dbBetIdRef = useRef(null);
  const betAutoCashoutRef = useRef(null);
  const lastAutoCashoutAtRef = useRef(0);

  useEffect(() => { userBetRef.current = crashUserBet; }, [crashUserBet]);
  useEffect(() => { userCashedRef.current = crashUserCashed; }, [crashUserCashed]);
  useEffect(() => { autoCashoutRef.current = crashAutoCashout; }, [crashAutoCashout]);
  useEffect(() => { autoBetRef.current = crashAutoBet; }, [crashAutoBet]);
  useEffect(() => { autoBetSettingsRef.current = autoBetSettings; }, [autoBetSettings]);
  useEffect(() => { autoBetStatsRef.current = autoBetStats; }, [autoBetStats]);
  useEffect(() => { betAmountRef.current = parseFloat(crashBetAmount) || 0.01; }, [crashBetAmount]);
  useEffect(() => { userRef.current = user; }, [user]);

  const updateDisplay = useCallback(() => {
    const now = Date.now();
    if (now - lastDisplayUpdateRef.current < 80) return;
    lastDisplayUpdateRef.current = now;
    const g = gameRef.current;
    setCrashDisplay(prev => {
      const target = g.multiplier;
      const diff = target - prev.displayMultiplier;
      const smoothMult = Math.abs(diff) < 0.01 ? target : prev.displayMultiplier + diff * 0.3;
      let displayMult = smoothMult;
      if (g.gameState === 'crashed') {
        displayMult = g.crashPoint || g.multiplier;
      } else if (g.gameState === 'betting') {
        displayMult = 1.0;
      }
      return {
        gameState: g.gameState, multiplier: g.multiplier,
        displayMultiplier: displayMult,
        crashPoint: g.crashPoint, timeLeft: g.timeLeft,
        roundNumber: g.roundNumber, chartPoints: [...g.chartPoints],
        history: [...g.history], screenShake: g.screenShake,
        particles: [...g.particles], roundBets: [...g.roundBets],
        serverSeedHash: g.serverSeedHash, rocketRotation: g.rocketRotation,
      };
    });
  }, []);

  // ===== CROSS-TAB SYNC SETUP =====
  // Unique ID for this browser tab (survives re-renders, cleared on tab close)
  const TAB_ID = useRef((() => {
    let id = sessionStorage.getItem('tonmine_tab');
    if (!id) {
      id = `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('tonmine_tab', id);
    }
    return id;
  })());
  const channelRef = useRef(null);

  // ===== SOCKET.IO CRASH GAME (Server-Side Synced) =====
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io('http://localhost:3001');
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('🔌 Socket connected:', socket.id);
      if (userRef.current?.id) {
        socket.emit('auth', userRef.current.id);
      }
    });

    // Re-emit auth when user ID becomes available (after login/load)
    const authInterval = setInterval(() => {
      if (socket.connected && userRef.current?.id && !socket._authSent) {
        socket.emit('auth', userRef.current.id);
        socket._authSent = true;
      }
    }, 500);

    socket.on('crash:state', (state) => {
      const prevState = gameRef.current.gameState;
      const g = gameRef.current;
      g.gameState = state.gameState;
      g.multiplier = state.multiplier;
      g.crashPoint = state.crashPoint;
      g.timeLeft = state.timeLeft;
      g.roundNumber = state.roundNumber;
      g.history = state.history;
      g.serverSeedHash = state.serverSeedHash;
      g.screenShake = state.gameState === 'crashed';

      // Build chart points from server multiplier
      if (state.gameState === 'flying') {
        // Derive elapsed time from multiplier using inverse formula
        const newElapsed = Math.sqrt(Math.max(0, state.multiplier - 1.0) / 0.06);
        g.elapsed = newElapsed;

        // FIX #3: Reconstruct full curve for new connections or fresh round
        if (g.chartPoints.length <= 1) {
          g.chartPoints = [{ t: 0, m: 1.0 }];
          const stepSize = 0.05; // 50ms resolution
          const steps = Math.min(300, Math.floor(newElapsed / stepSize));
          for (let i = 1; i <= steps; i++) {
            const t = i * stepSize;
            const m = 1.0 + 0.06 * t * t;
            g.chartPoints.push({ t, m });
          }
          // Ensure exact current point is included
          const lastT = g.chartPoints[g.chartPoints.length - 1]?.t;
          if (lastT === undefined || Math.abs(lastT - newElapsed) > 0.001) {
            g.chartPoints.push({ t: newElapsed, m: state.multiplier });
          }
        } else {
          g.chartPoints.push({ t: newElapsed, m: state.multiplier });
        }

        if (g.chartPoints.length > 300) {
          g.chartPoints = [g.chartPoints[0], ...g.chartPoints.slice(1, -1).filter((_, i) => i % 2 === 0), g.chartPoints[g.chartPoints.length - 1]];
        }
        // Calculate rocket rotation
        if (g.chartPoints.length >= 2) {
          const last = g.chartPoints[g.chartPoints.length - 1];
          const prev = g.chartPoints[Math.max(0, g.chartPoints.length - 3)];
          const maxT = Math.max(8, last.t || 8);
          const maxM = Math.max(10, state.multiplier * 1.2);
          const x1 = (prev.t / maxT) * 94;
          const y1 = 100 - ((prev.m - 1) / (maxM - 1)) * 100;
          const x2 = (last.t / maxT) * 94;
          const y2 = 100 - ((last.m - 1) / (maxM - 1)) * 100;
          const dx = x2 - x1;
          const dy = y2 - y1;
          if (dx > 0) {
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            g.rocketRotation = angle + 90;
          }
        }

        // FIX #1: Sync bet + cashout state from server activeBets (new windows / missed events)
        const myActiveBet = (state.activeBets || []).find(b => 
          b.username === userRef.current?.username || b.userId === userRef.current?.id
        );
        if (myActiveBet) {
          const betAmount = parseFloat(myActiveBet.amount) || 0;
          if (!userBetRef.current && betAmount > 0) {
            setCrashUserBet(betAmount);
            userBetRef.current = betAmount;
          }
          if (myActiveBet.status === 'cashed' && !userCashedRef.current) {
            setCrashUserCashed(true);
            userCashedRef.current = true;
          }
        }
      } else if (state.gameState === 'betting') {
        g.elapsed = 0;
        g.chartPoints = [{ t: 0, m: 1.0 }];
        g.rocketRotation = -45;
        g.particles = [];

        // Sync balance if server sends it in state payload
        // BUT: ignore stale server balance for 3s after auto-cashout (server DB is async)
        if (state.userBalance !== undefined && userRef.current?.id) {
          const sinceAutoCashout = Date.now() - lastAutoCashoutAtRef.current;
          if (sinceAutoCashout > 3000) {
            setUser(prev => ({ ...prev, tmcBalance: state.userBalance }));
          }
        }

        // Reset bet/cashed state for new round (only if no active bet in new round)
        if (prevState === 'crashed' || prevState === 'flying') {
          setCrashUserBet(null);
          userBetRef.current = null;
          setCrashUserCashed(false);
          userCashedRef.current = false;
          betAutoCashoutRef.current = null;
          // Clear all old round-specific localStorage cashout keys
          try {
            Object.keys(localStorage).forEach(k => {
              if (k.startsWith('tonmine_cashout_')) localStorage.removeItem(k);
            });
          } catch(e) {}
        }
      } else if (state.gameState === 'crashed') {
        lastDisplayUpdateRef.current = 0; // bypass throttle for crash
        g.particles = Array.from({ length: 15 }, (_, i) => ({
          id: Date.now() + i, x: 50 + Math.random() * 20 - 10, y: 50 + Math.random() * 20 - 10,
          vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5,
          opacity: 1, size: Math.random() * 5 + 2,
          color: ['#FF3D71', '#FFB800', '#FF6B6B', '#FF8C42'][Math.floor(Math.random() * 4)],
        }));
      }

      // FIX #1: Global sync — if server says our bet is gone during betting, reset
      if (state.gameState === 'betting') {
        const myBetInActive = (state.activeBets || []).find(b => 
          b.username === userRef.current?.username || b.userId === userRef.current?.id
        );
        if (!myBetInActive && userBetRef.current) {
          setCrashUserBet(null);
          userBetRef.current = null;
          setCrashUserCashed(false);
          userCashedRef.current = false;
        }
      }

      // Map server activeBets to roundBets
      const lookupCashout = (username, roundNum) => {
        try {
          const saved = JSON.parse(localStorage.getItem('tonmine_cashout_' + roundNum));
          if (saved && saved.username === username && Date.now() - saved.timestamp < 60000) {
            return saved.multiplier;
          }
        } catch(e) {}
        return null;
      };

      if (state.gameState === 'flying' || state.gameState === 'crashed') {
        const localCashed = g.roundBets.filter(rb => rb.status === 'cashed' && rb.username === userRef.current?.username);
        const serverBets = (state.activeBets || []).map(b => {
          const local = g.roundBets.find(rb => rb.username === b.username);
          const srvMult = parseFloat(b.multiplier);

          // CRITICAL: If we already know this bet cashed locally (with a valid multiplier),
          // NEVER let the server overwrite it with a rounded/different value.
          if (local && local.status === 'cashed' && local.multiplier > 1.01) {
            return { ...local };
          }

          // If server still says 'active' but we already cashed locally, trust local
          if (local && local.status === 'cashed' && b.status !== 'cashed') {
            return { ...local };
          }

          let finalMult = (!isNaN(srvMult) && srvMult > 1.01) ? srvMult : (local?.multiplier || null);
          // If server says cashed but multiplier is missing/1, check localStorage
          if ((!finalMult || finalMult <= 1.01) && b.status === 'cashed') {
            finalMult = lookupCashout(b.username, state.roundNumber);
          }

          // ✅ FIX D: If this is the current user and we still have no valid multiplier,
          // use the persisted auto-cashout target so we never show "Cashed" blank
          if ((!finalMult || finalMult <= 1.01) && b.status === 'cashed' &&
              (b.username === userRef.current?.username || b.userId === userRef.current?.id)) {
            try {
              const auto = JSON.parse(localStorage.getItem('tonmine_autocashout_' + userRef.current?.id));
              if (auto && auto.target > 1 && Date.now() - auto.timestamp < 300000) {
                finalMult = auto.target;
              }
            } catch (e) {}
          }

          return {
            username: b.username,
            amount: parseFloat(b.amount) || 0,
            status: b.status,
            multiplier: finalMult || 1
          };
        });
        // Re-add our cashed bet if server removed it from activeBets entirely
        const serverNames = new Set(serverBets.map(b => b.username));
        localCashed.forEach(lb => {
          if (!serverNames.has(lb.username)) serverBets.push(lb);
        });
        g.roundBets = serverBets;
      } else {
        // Betting phase — fresh round, do NOT carry over old cashed bets
        g.roundBets = (state.activeBets || []).map(b => {
          const srvMult = parseFloat(b.multiplier);
          let finalMult = (!isNaN(srvMult) && srvMult > 1.01) ? srvMult : null;
          if (!finalMult) finalMult = lookupCashout(b.username, state.roundNumber);
          return {
            username: b.username,
            amount: parseFloat(b.amount) || 0,
            status: b.status,
            multiplier: finalMult || 1
          };
        });
      }

      updateDisplay();
    });

    socket.on('crash:betConfirmed', (data) => {
      setCrashUserBet(data.amount);
      userBetRef.current = data.amount;
      setCrashUserCashed(false);
      userCashedRef.current = false;
      setUser(prev => ({ ...prev, tmcBalance: data.balance }));
    });

    // ✅ PATCH C: crash:cashedOut — also update roundBets + localStorage
    socket.on('crash:cashedOut', (data) => {
      setCrashUserCashed(true);
      userCashedRef.current = true;

      const betAmount = userBetRef.current || 0;
      const winAmount = data.winAmount !== undefined ? data.winAmount : (betAmount * data.multiplier);
      const profit = data.profit !== undefined ? data.profit : (winAmount - betAmount);
      const newBalance = data.balance !== undefined ? data.balance : ((userRef.current?.tmcBalance || 0) + profit);

      setUser(prev => ({ ...prev, tmcBalance: newBalance }));
      lastAutoCashoutAtRef.current = Date.now();
      setLiveBets(prev => [{ id: Date.now(), username: userRef.current.username, amount: betAmount, game: 'Crash', result: 'win', multiplier: data.multiplier, profit: Number(profit).toFixed(2) }, ...prev].slice(0, 10));
      setTransactions(prev => [{ id: Date.now(), type: 'crash_cashout', amount: winAmount, direction: 'credit', note: `Crash cashed @ ${data.multiplier.toFixed(2)}×` }, ...prev]);

      // Update roundBets and localStorage so other tabs / VS Code preview can see it
      const myRoundBet = gameRef.current.roundBets.find(b => b.username === userRef.current?.username);
      if (myRoundBet) {
        myRoundBet.multiplier = data.multiplier;
        myRoundBet.status = 'cashed';
      } else {
        gameRef.current.roundBets.push({
          username: userRef.current?.username || 'You',
          amount: betAmount,
          status: 'cashed',
          multiplier: data.multiplier
        });
      }
      try {
        localStorage.setItem('tonmine_cashout_' + gameRef.current.roundNumber, JSON.stringify({
          username: userRef.current?.username || 'You',
          multiplier: data.multiplier,
          amount: betAmount,
          timestamp: Date.now()
        }));
        localStorage.setItem('tonmine_balance_' + userRef.current?.id, JSON.stringify({
          balance: newBalance,
          timestamp: Date.now()
        }));
      } catch (e) {}
      setCrashDisplay(prev => ({ ...prev, roundBets: [...gameRef.current.roundBets] }));
    });

    // ✅ PATCH B: crash:autoCashed — use server balance, read target from storage
    socket.on('crash:autoCashed', (data) => {
      const betAmount = userBetRef.current || 0;
      const serverWin = data.winAmount;
      const serverMult = data.multiplier;

      // Read target from this tab's ref, or from localStorage (other tabs)
      let targetMult = betAutoCashoutRef.current;
      if (!targetMult) {
        try {
          const saved = JSON.parse(localStorage.getItem('tonmine_autocashout_' + userRef.current?.id));
          if (saved && saved.target > 1 && Date.now() - saved.timestamp < 300000) {
            targetMult = saved.target;
          }
        } catch (e) {}
      }

      // Display multiplier = target (what user asked for). Balance = server actual.
      const displayMult = targetMult && targetMult > 1 ? targetMult : (serverMult || 1);

      // Always use the server's actual winAmount for balance; do NOT recalculate
      const winAmount = serverWin !== undefined ? serverWin : (betAmount * (serverMult || displayMult));
      const profit = data.profit !== undefined ? data.profit : (winAmount - betAmount);
      const newBalance = data.balance !== undefined ? data.balance : ((userRef.current?.tmcBalance || 0) + profit);

      // Always update balance (crash:state may have already set userCashedRef=true)
      setUser(prev => ({ ...prev, tmcBalance: newBalance }));
      lastAutoCashoutAtRef.current = Date.now();

      if (!userCashedRef.current) {
        setCrashUserCashed(true);
        userCashedRef.current = true;
        setLiveBets(prev => [{ id: Date.now(), username: userRef.current?.username || 'You', amount: betAmount, game: 'Crash', result: 'win', multiplier: displayMult, profit: Number(profit).toFixed(2) }, ...prev].slice(0, 10));
        setTransactions(prev => [{ id: Date.now(), type: 'crash_cashout', amount: winAmount, direction: 'credit', note: `Auto-cashed @ ${displayMult.toFixed(2)}×` }, ...prev]);
      }

      // Update roundBets with the display multiplier so all tabs match
      const myRoundBet = gameRef.current.roundBets.find(b => b.username === userRef.current?.username);
      if (myRoundBet) {
        myRoundBet.multiplier = displayMult;
        myRoundBet.status = 'cashed';
      } else {
        gameRef.current.roundBets.push({
          username: userRef.current?.username || 'You',
          amount: betAmount,
          status: 'cashed',
          multiplier: displayMult
        });
      }

      // Write to localStorage for cross-tab sync
      try {
        localStorage.setItem('tonmine_cashout_' + gameRef.current.roundNumber, JSON.stringify({
          username: userRef.current?.username || 'You',
          multiplier: displayMult,
          amount: betAmount,
          timestamp: Date.now()
        }));
        localStorage.setItem('tonmine_balance_' + userRef.current?.id, JSON.stringify({
          balance: newBalance,
          timestamp: Date.now()
        }));
      } catch (e) {}

      setCrashDisplay(prev => ({ ...prev, roundBets: [...gameRef.current.roundBets] }));
    });

    socket.on('crash:lost', (data) => {
      setCrashUserBet(null);
      userBetRef.current = null;
      setCrashUserCashed(false);
      userCashedRef.current = false;
      betAutoCashoutRef.current = null;

      // Mark our round bet as crashed for instant UI update
      const myRoundBet = gameRef.current.roundBets.find(b => b.username === userRef.current?.username);
      if (myRoundBet) {
        myRoundBet.status = 'crashed';
      }
      setCrashDisplay(prev => ({ ...prev, roundBets: [...gameRef.current.roundBets] }));

      setTransactions(prev => [{ id: Date.now(), type: 'bet_debit', amount: data.lostAmount, direction: 'debit', note: `Crash crashed @ ${data.crashPoint.toFixed(2)}×` }, ...prev]);
    });

    socket.on('crash:error', (data) => {
      alert(data.message);
    });

    // Cross-tab sync: listen for round-specific localStorage cashout + balance events from other tabs
    const handleStorage = (e) => {
      // ===== FIX: Sync full user state written by another tab =====
      if (e.key === 'tonmine_user') {
        try {
          const saved = JSON.parse(e.newValue);
          // Only apply if it's the same user and the incoming data is newer
          if (
            saved &&
            (saved.id === userRef.current?.id || saved.telegramId === userRef.current?.telegramId) &&
            saved.lastActiveAt >= (userRef.current?.lastActiveAt || 0)
          ) {
            setUser(prev => ({
              ...prev,
              tmcBalance:      saved.tmcBalance,
              totalMined:      saved.totalMined,
              totalMinedEver:  saved.totalMinedEver,
              totalWagered:    saved.totalWagered,
              totalWon:        saved.totalWon,
              totalLost:       saved.totalLost,
              energy:          saved.energy,
              lastActiveAt:    saved.lastActiveAt,
              lastEnergyRegen: saved.lastEnergyRegen,
              claimStreak:     saved.claimStreak,
              lastClaimAt:     saved.lastClaimAt,
            }));
          }
        } catch(_e) {}
      }

      if (e.key && e.key.startsWith('tonmine_cashout_')) {
        try {
          const roundNum = parseInt(e.key.replace('tonmine_cashout_', ''), 10);
          const saved = JSON.parse(e.newValue);
          if (saved && roundNum === gameRef.current.roundNumber) {
            const bet = gameRef.current.roundBets.find(b => b.username === saved.username);
            if (bet) {
              // Always update multiplier even if already cashed (fixes cross-tab sync)
              bet.multiplier = saved.multiplier;
              bet.status = 'cashed';
              updateDisplay();
            } else {
              // Bet not in list yet (new tab opened mid-round) — add it
              gameRef.current.roundBets.push({
                username: saved.username,
                amount: saved.amount || 0,
                status: 'cashed',
                multiplier: saved.multiplier
              });
              updateDisplay();
            }
          }
        } catch(_e) {}
      }
      // Sync balance across tabs
      if (e.key && e.key.startsWith('tonmine_balance_')) {
        try {
          const saved = JSON.parse(e.newValue);
          if (saved && saved.balance !== undefined && Date.now() - saved.timestamp < 30000) {
            setUser(prev => ({ ...prev, tmcBalance: saved.balance }));
          }
        } catch(_e) {}
      }
    };
    window.addEventListener('storage', handleStorage);

    // ✅ CLEANUP MUST BE LAST — after all listeners are registered
    return () => {
      clearInterval(authInterval);
      window.removeEventListener('storage', handleStorage);
      socket.disconnect();
    };
  }, []);

  // ===== BROADCAST CHANNEL (instant cross-tab user state sync) =====
  useEffect(() => {
    try {
      const channel = new BroadcastChannel('tonmine_user_sync');
      channelRef.current = channel;

      channel.onmessage = (event) => {
        const { type, payload, fromTab } = event.data;
        if (fromTab === TAB_ID.current) return; // Ignore messages we sent ourselves

        if (type === 'USER_STATE' && payload) {
          setUser(prev => {
            // Only apply if same user
            if (payload.id !== prev.id && payload.telegramId !== prev.telegramId) return prev;
            // Only apply if the incoming data is newer
            if (payload.lastActiveAt < (prev.lastActiveAt || 0)) return prev;
            return {
              ...prev,
              tmcBalance:      payload.tmcBalance,
              totalMined:      payload.totalMined,
              totalMinedEver:  payload.totalMinedEver,
              totalWagered:    payload.totalWagered,
              totalWon:        payload.totalWon,
              totalLost:       payload.totalLost,
              energy:          payload.energy,
              lastActiveAt:    payload.lastActiveAt,
              claimStreak:     payload.claimStreak,
              lastClaimAt:     payload.lastClaimAt,
            };
          });
        }
      };
    } catch (_e) {
      console.log('BroadcastChannel not supported, relying on localStorage events');
    }

    return () => {
      if (channelRef.current) { channelRef.current.close(); channelRef.current = null; }
    };
  }, []);

  // ===== RE-SYNC WHEN TAB BECOMES VISIBLE =====
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        try {
          const saved = localStorage.getItem('tonmine_user');
          if (!saved) return;
          const parsed = JSON.parse(saved);
          if (
            parsed &&
            (parsed.id === userRef.current?.id || parsed.telegramId === userRef.current?.telegramId) &&
            parsed.lastActiveAt >= (userRef.current?.lastActiveAt || 0)
          ) {
            setUser(prev => ({
              ...prev,
              tmcBalance:      parsed.tmcBalance,
              totalMined:      parsed.totalMined,
              totalMinedEver:  parsed.totalMinedEver,
              totalWagered:    parsed.totalWagered,
              totalWon:        parsed.totalWon,
              totalLost:       parsed.totalLost,
              energy:          parsed.energy,
              lastActiveAt:    parsed.lastActiveAt,
              claimStreak:     parsed.claimStreak,
              lastClaimAt:     parsed.lastClaimAt,
            }));
          }
        } catch (_e) {}
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // ✅ PATCH A: Persist auto-cashout target when betting
  const handleManualBet = useCallback(() => {
    const val = parseFloat(crashBetAmount);
    if (isNaN(val) || val < 0.01) { alert('Minimum bet is 0.01 TMC'); return; }
    if (user.tmcBalance < val) { alert('Insufficient balance!'); return; }
    if (gameRef.current.gameState !== 'betting') { alert('Betting closed!'); return; }

    // Snapshot autoCashout at bet time so auto-cashout display is accurate
    betAutoCashoutRef.current = parseFloat(crashAutoCashout) || null;

    // Persist target for cross-tab / cross-origin sync
    const target = betAutoCashoutRef.current;
    if (target && target > 1) {
      try {
        localStorage.setItem('tonmine_autocashout_' + user.id, JSON.stringify({
          target,
          roundNumber: gameRef.current.roundNumber,
          timestamp: Date.now()
        }));
      } catch (e) {}
    }

    // Emit via Socket.io to backend
    if (socketRef.current) {
      socketRef.current.emit('crash:bet', {
        userId: user.id,
        amount: val,
        autoCashout: crashAutoCashout
      });
    }
  }, [crashBetAmount, crashAutoCashout, user.tmcBalance, user.id]);

  const handleManualCashout = useCallback(() => {
    if (!userBetRef.current || userCashedRef.current || gameRef.current.gameState !== 'flying') return;

    const betAmount = userBetRef.current;
    const currentMult = gameRef.current.multiplier;
    const winAmount = betAmount * currentMult;
    const profit = winAmount - betAmount;
    const newBalance = (userRef.current?.tmcBalance || 0) + profit;

    // Optimistic instant update — UI feels immediate, server validates in background
    setCrashUserCashed(true);
    userCashedRef.current = true;
    setUser(prev => ({ ...prev, tmcBalance: newBalance }));

    // Update roundBets immediately so the list shows exact multiplier + profit
    const myRoundBet = gameRef.current.roundBets.find(b => b.username === userRef.current?.username);
    if (myRoundBet) {
      myRoundBet.multiplier = currentMult;
      myRoundBet.status = 'cashed';
    } else {
      // Bet not yet in roundBets (server lag) — add it manually
      gameRef.current.roundBets.push({
        username: userRef.current?.username || 'You',
        amount: betAmount,
        status: 'cashed',
        multiplier: currentMult
      });
    }

    // Write to localStorage for cross-tab sync (round-specific key + balance)
    try {
      localStorage.setItem('tonmine_cashout_' + gameRef.current.roundNumber, JSON.stringify({
        username: userRef.current?.username || 'You',
        multiplier: currentMult,
        amount: betAmount,
        timestamp: Date.now()
      }));
      localStorage.setItem('tonmine_balance_' + userRef.current?.id, JSON.stringify({
        balance: newBalance,
        timestamp: Date.now()
      }));
    } catch(e) {}

    // Force immediate React re-render of round bets (bypass 80ms throttle)
    setCrashDisplay(prev => ({ ...prev, roundBets: [...gameRef.current.roundBets] }));

    setLiveBets(prev => [{ id: Date.now(), username: userRef.current?.username || 'You', amount: betAmount, game: 'Crash', result: 'win', multiplier: currentMult, profit: profit.toFixed(2) }, ...prev].slice(0, 10));
    setTransactions(prev => [{ id: Date.now(), type: 'crash_cashout', amount: winAmount, direction: 'credit', note: `Crash cashed @ ${currentMult.toFixed(2)}×` }, ...prev]);

    // Emit to server (background validation)
    if (socketRef.current) {
      socketRef.current.emit('crash:cashout', { userId: user.id });
    }
  }, [user.id]);

  const toggleAutoBet = useCallback(() => {
    setCrashAutoBet(prev => {
      const next = !prev;
      if (next) {
        const startBet = Math.max(0.01, parseFloat(crashBetAmount) || 0.01);
        const synced = { ...autoBetSettings, baseAmount: startBet };
        setAutoBetSettings(synced);
        autoBetSettingsRef.current = synced;
        setAutoBetStats({ wins: 0, losses: 0, currentBet: startBet, roundsLeft: 0, totalProfit: 0, totalLoss: 0 });
      }
      return next;
    });
  }, [autoBetSettings, crashBetAmount]);

  // ===== PERSIST + BROADCAST user state to all other tabs on every change =====
  useEffect(() => {
    localStorage.setItem('tonmine_user', JSON.stringify(user));

    // Broadcast the new state via BroadcastChannel for instant sync
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'USER_STATE',
        fromTab: TAB_ID.current,
        payload: {
          id:             user.id,
          telegramId:     user.telegramId,
          tmcBalance:     user.tmcBalance,
          totalMined:     user.totalMined,
          totalMinedEver: user.totalMinedEver,
          totalWagered:   user.totalWagered,
          totalWon:       user.totalWon,
          totalLost:      user.totalLost,
          energy:         user.energy,
          lastActiveAt:   user.lastActiveAt,
          lastEnergyRegen:user.lastEnergyRegen,
          claimStreak:    user.claimStreak,
          lastClaimAt:    user.lastClaimAt,
        },
      });
    }
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => {
      setUser(prev => { const now = Date.now(); const regen = Math.floor((now - prev.lastEnergyRegen) / 3000); if (regen > 0) return { ...prev, energy: Math.min(prev.maxEnergy, prev.energy + regen), lastEnergyRegen: now }; return prev; });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const addFloatingText = (text, x, y) => { const id = Date.now(); setFloatingTexts(prev => [...prev, { id, text, x, y }]); setTimeout(() => setFloatingTexts(prev => prev.filter(t => t.id !== id)), 1000); };

  const addTransaction = useCallback(async (tx) => {
    setTransactions(prev => [{ id: Date.now(), ...tx }, ...prev]);
    if (user?.id && !String(user.id).startsWith('local-')) {
      try {
        const balanceAfter = tx.direction === 'credit' ? user.tmcBalance + tx.amount : user.tmcBalance - tx.amount;
        await apiAddTransaction({
          user_id: user.id, type: tx.type, direction: tx.direction,
          amount: tx.amount, balance_after: balanceAfter,
          metadata: { note: tx.note, ...(tx.ton_amount && { ton_amount: tx.ton_amount }) }
        });
      } catch (e) { console.error('TX save failed:', e); }
    }
  }, [user?.id, user?.tmcBalance]);

  if (!isReady) {
    return (
      <div className="min-h-screen w-full max-w-[430px] mx-auto bg-[#050508] flex flex-col items-center justify-center">
        <div className="relative mb-6">
          <div className="w-20 h-20 rounded-full border-2 border-dashed border-gold/40 animate-spin-slow" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Zap className="w-8 h-8 text-gold animate-pulse" />
          </div>
        </div>
        <h1 className="font-orbitron text-2xl font-bold text-gold tracking-wider mb-2">TONMINE</h1>
        <p className="text-xs text-text-secondary font-sora">MINE · BET · EARN</p>
        <div className="mt-4 flex gap-1">
          <div className="w-2 h-2 rounded-full bg-gold animate-bounce" style={{animationDelay: '0ms'}} />
          <div className="w-2 h-2 rounded-full bg-gold animate-bounce" style={{animationDelay: '150ms'}} />
          <div className="w-2 h-2 rounded-full bg-gold animate-bounce" style={{animationDelay: '300ms'}} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full max-w-[430px] mx-auto bg-[#050508] overflow-hidden flex flex-col">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-20 -left-20 w-72 h-72 bg-gold rounded-full opacity-[0.07] blur-[100px] animate-drift" />
        <div className="absolute -bottom-20 -right-20 w-96 h-96 bg-cyan rounded-full opacity-[0.05] blur-[100px] animate-drift-reverse" />
        <div className="absolute top-1/2 right-0 w-64 h-64 bg-purple rounded-full opacity-[0.04] blur-[80px] animate-drift" />
        <div className="absolute inset-0 bg-dot-grid opacity-50" />
      </div>
      <Header user={user} />
      <LiveTicker />
      <main className="flex-1 overflow-y-auto pb-24 px-4 pt-2 relative z-10">
        {activeTab === 'mine' && <MineTab user={user} setUser={setUser} addFloatingText={addFloatingText} addTransaction={addTransaction} />}
        {activeTab === 'casino' && <CasinoTab user={user} setUser={setUser} liveBets={liveBets} setLiveBets={setLiveBets} addTransaction={addTransaction} setTransactions={setTransactions} crashDisplay={crashDisplay} crashUserBet={crashUserBet} crashUserCashed={crashUserCashed} crashBetAmount={crashBetAmount} setCrashBetAmount={setCrashBetAmount} crashAutoCashout={crashAutoCashout} setCrashAutoCashout={setCrashAutoCashout} crashAutoBet={crashAutoBet} toggleAutoBet={toggleAutoBet} autoBetSettings={autoBetSettings} setAutoBetSettings={setAutoBetSettings} autoBetStats={autoBetStats} showAutoBetSettings={showAutoBetSettings} setShowAutoBetSettings={setShowAutoBetSettings} onManualBet={handleManualBet} onManualCashout={handleManualCashout} />}
        {activeTab === 'ranks' && <RanksTab user={user} />}
        {activeTab === 'wallet' && <WalletTab user={user} setUser={setUser} transactions={transactions} addTransaction={addTransaction} />}
      </main>
      {floatingTexts.map(ft => <div key={ft.id} className="fixed z-50 font-orbitron text-gold font-bold text-sm pointer-events-none animate-float-up" style={{ left: ft.x, top: ft.y }}>{ft.text}</div>)}
      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Referral Welcome Modal */}
      <ReferralWelcome 
        show={showReferralModal} 
        onClose={() => setShowReferralModal(false)} 
        inviter={inviterInfo}
        isNewUser={isNewUser}
      />
    </div>
  );
}

function Header({ user }) {
  return (
    <header className="sticky top-0 z-40 bg-[rgba(5,5,8,0.85)] backdrop-blur-md border-b border-border">
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-gold" />
          <span className="font-orbitron font-bold text-lg tracking-wider shimmer-text">TONMINE</span>
        </div>
        <div className="flex items-center gap-2 glass-card px-3 py-1.5">
          <span className="font-orbitron text-gold font-bold text-sm">{formatTMC(user.tmcBalance)}</span>
          <span className="text-[10px] text-text-secondary font-medium">TMC</span>
        </div>
      </div>
    </header>
  );
}

function LiveTicker() {
  const [online, setOnline] = useState(1247);
  useEffect(() => { const interval = setInterval(() => setOnline(o => o + Math.floor(Math.random() * 5) - 2), 5000); return () => clearInterval(interval); }, []);
  return (
    <div className="sticky top-14 z-30 px-4 py-1.5">
      <div className="glass-card px-3 py-2 overflow-hidden">
        <div className="flex items-center gap-2 text-xs whitespace-nowrap">
          <span className="text-green font-bold animate-pulse-live">● LIVE</span>
          <span className="text-text-secondary">|</span>
          <span className="text-text-secondary">Total Mined: <span className="text-gold font-orbitron">4.89M TMC</span></span>
          <span className="text-text-secondary">|</span>
          <span className="text-text-secondary">Online: <span className="text-cyan font-orbitron">{online}</span></span>
          <span className="text-text-secondary">|</span>
          <span className="text-text-secondary">1 TON = 1,000 TMC</span>
        </div>
      </div>
    </div>
  );
}

function BottomNav({ activeTab, setActiveTab }) {
  const tabs = [
    { id: 'mine', icon: Pickaxe, label: 'Mine' },
    { id: 'casino', icon: Gamepad2, label: 'Casino' },
    { id: 'ranks', icon: Trophy, label: 'Ranks' },
    { id: 'wallet', icon: Wallet, label: 'Wallet' },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[rgba(5,5,8,0.95)] backdrop-blur-lg border-t border-border">
      <div className="max-w-[430px] mx-auto flex items-center justify-around h-16">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-1 w-16 transition-all duration-200 ${isActive ? 'text-gold' : 'text-text-secondary opacity-50'}`}>
              <Icon className={`w-5 h-5 ${isActive ? 'drop-shadow-[0_0_8px_rgba(255,184,0,0.5)]' : ''}`} />
              <span className="text-[10px] font-medium font-sora">{tab.label}</span>
              {isActive && <div className="absolute bottom-0 w-8 h-0.5 bg-gold rounded-full shadow-[0_0_10px_rgba(255,184,0,0.5)]" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ============================================
// REFERRAL WELCOME MODAL
// ============================================
function ReferralWelcome({ show, onClose, inviter, isNewUser }) {
  if (!show) return null;

  const handleShare = () => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent('https://t.me/TonMineBot')}&text=${encodeURIComponent('Join me on TONMINE and start earning!')}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-card-gold p-6 w-full max-w-sm relative animate-in zoom-in duration-300">
        <button onClick={onClose} className="absolute top-3 right-3 p-1 hover:bg-white/5 rounded-full transition-colors">
          <X className="w-4 h-4 text-text-secondary" />
        </button>

        <div className="text-center mb-4">
          <div className="w-16 h-16 rounded-full bg-gold/20 flex items-center justify-center mx-auto mb-3">
            <Gift className="w-8 h-8 text-gold" />
          </div>
          <h2 className="font-orbitron text-lg font-bold text-gold mb-1">
            {isNewUser ? 'Welcome to TONMINE!' : 'Referral Bonus Active'}
          </h2>
          {inviter && (
            <p className="text-sm text-text-secondary">
              You were invited by <span className="text-cyan font-bold">{inviter.username}</span>
            </p>
          )}
        </div>

        <div className="glass-card p-3 mb-4">
          <div className="text-xs text-text-secondary text-center mb-2">Your Earning Structure</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Direct Friends (Tier 1)</span>
              <span className="text-gold font-bold">25% commission</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Friends of Friends (Tier 2)</span>
              <span className="text-cyan font-bold">10% commission</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Extended Network (Tier 3)</span>
              <span className="text-purple font-bold">5% commission</span>
            </div>
          </div>
        </div>

        <div className="text-center text-xs text-text-muted mb-4">
          Earn TMC every time your friends mine or play. The more they earn, the more you earn!
        </div>

        <button onClick={onClose} className="w-full btn-gold py-3 text-sm font-bold">
          {isNewUser ? 'START MINING →' : 'GOT IT'}
        </button>
      </div>
    </div>
  );
}

function MineTab({ user, setUser, addFloatingText, addTransaction }) {
  const [orbActive, setOrbActive] = useState(false);
  const [countdown, setCountdown] = useState('');
  const orbRef = useRef(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const lastTap = user.lastDailyTapAt || 0;
      const msRemaining = 86400000 - (now - lastTap);
      if (msRemaining <= 0) setCountdown('');
      else { const h = Math.floor(msRemaining / 3600000), m = Math.floor((msRemaining % 3600000) / 60000), s = Math.floor((msRemaining % 60000) / 1000); setCountdown(`${h}h ${m}m ${s}s`); }
    }, 1000);
    return () => clearInterval(interval);
  }, [user.lastDailyTapAt]);

  const canTap = () => { const now = Date.now(); return (now - (user.lastDailyTapAt || 0)) >= 86400000; };

  const handleTap = async (e) => {
    if (!canTap()) return;
    const rect = orbRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : e.clientX;
    const y = rect ? rect.top : e.clientY;

    setUser(prev => ({ ...prev, lastDailyTapAt: Date.now(), lastTapAt: Date.now() }));
    addFloatingText(`⚡ ACTIVATED`, x, y);
    setOrbActive(true); setTimeout(() => setOrbActive(false), 100);

    if (user.id && !String(user.id).startsWith('local-')) {
      try {
        await apiUpdateUser(user.id, {
          last_daily_tap_at: new Date().toISOString()
        });
      } catch (e) { console.error('DB tap sync failed:', e); }
    }
  };

  const getLeague = (mined) => {
    if (mined >= 1000000) return { name: 'Legend', icon: '👑', color: '#C084FC' };
    if (mined >= 100000) return { name: 'Diamond', icon: '💎', color: '#00E5FF' };
    if (mined >= 10000) return { name: 'Gold', icon: '🥇', color: '#FFB800' };
    if (mined >= 1000) return { name: 'Silver', icon: '🥈', color: '#94A3B8' };
    return { name: 'Bronze', icon: '🥉', color: '#CD7F32' };
  };
  const league = getLeague(user.totalMinedEver);

  const upgrades = [
    { level: 1, name: 'Basic Miner', rate: 0.5, referrals: 10, icon: '⛏️' },
    { level: 2, name: 'Fast Miner', rate: 1.0, referrals: 50, icon: '⚡' },
    { level: 3, name: 'Turbo Miner', rate: 2.5, referrals: 200, icon: '🚀' },
  ];

  const handleUpgrade = async (upg) => {
    if (user.miningLevel >= upg.level) return;
    if (user.referrals < upg.referrals) { alert(`Need ${upg.referrals} referrals to unlock ${upg.name}!`); return; }
    setUser(prev => ({ ...prev, miningRate: upg.rate, miningLevel: upg.level }));
    addTransaction({ type: 'upgrade_unlock', amount: 0, direction: 'credit', note: `Unlocked ${upg.name} via referrals` });

    if (user.id && !String(user.id).startsWith('local-')) {
      try {
        await apiUpdateUser(user.id, { mining_rate: upg.rate, mining_level: upg.level });
      } catch (e) { console.error('DB upgrade sync failed:', e); }
    }
  };

  const tapAvailable = canTap();
  const canClaim = tapAvailable && (user.lastDailyTapAt || 0) > 0 && (user.lastClaimAt || 0) <= (user.lastDailyTapAt || 0);

  const handleDailyClaim = async () => {
    const now = Date.now();
    if (!canClaim) { alert('Not ready yet! Complete your session first.'); return; }
    const lastClaim = user.lastClaimAt || 0;
    const hoursSince = (now - lastClaim) / 3600000;
    const streak = hoursSince > 48 ? 1 : user.claimStreak + 1;
    const mult = streak >= 30 ? 10 : streak >= 7 ? 3 : 1;
    const amount = user.miningRate * mult;
    const newBalance = user.tmcBalance + amount;
    const newTotalMined = user.totalMined + amount;
    const newTotalMinedEver = user.totalMinedEver + amount;

    setUser(prev => ({ ...prev, tmcBalance: newBalance, totalMined: newTotalMined, totalMinedEver: newTotalMinedEver, claimStreak: streak, lastClaimAt: now }));
    addTransaction({ type: 'mining_daily', amount, direction: 'credit', note: `Day ${streak} streak` });

    if (user.id && !String(user.id).startsWith('local-')) {
      try {
        await apiUpdateUser(user.id, {
          balance: newBalance, total_mined: newTotalMined,
          total_mined_ever: newTotalMinedEver,
          claim_streak: streak, last_claim_at: new Date().toISOString()
        });
        await apiAddMiningTap({
          user_id: user.id, tap_type: 'passive_claim',
          amount_earned: amount, streak_day: streak
        });
      } catch (e) { console.error('DB claim sync failed:', e); }
    }
  };



  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card p-3">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Mining Rate</div>
          <div className="font-orbitron text-lg text-gold">{user.miningRate} <span className="text-xs text-text-secondary">TMC/session</span></div>
        </div>
        <div className="glass-card p-3">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Total Mined</div>
          <div className="font-orbitron text-lg text-cyan">{formatTMC(user.totalMined)}</div>
        </div>
      </div>

      <div className="glass-card p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{league.icon}</span>
          <div>
            <div className="text-xs text-text-secondary">Current League</div>
            <div className="font-orbitron font-bold" style={{ color: league.color }}>{league.name}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-text-secondary">Next Rank</div>
          <div className="font-orbitron text-xs text-text-secondary">{league.name === 'Legend' ? 'MAX' : formatTMC(league.name === 'Bronze' ? 1000 : league.name === 'Silver' ? 10000 : league.name === 'Gold' ? 100000 : 1000000)} TMC</div>
        </div>
      </div>

      <div className="flex flex-col items-center py-6">
        <div ref={orbRef} onClick={handleTap} className={`relative w-36 h-36 cursor-pointer transition-transform duration-100 select-none ${orbActive ? 'scale-[0.91]' : 'scale-100'} ${!tapAvailable ? 'opacity-60' : ''}`}>
          <div className={`absolute inset-0 rounded-full border-2 border-dashed border-gold/30 ${tapAvailable ? 'animate-spin-slow' : ''}`} />
          <div className={`absolute inset-2 rounded-full border border-cyan/20 ${tapAvailable ? 'animate-spin-reverse' : ''}`} />
          {tapAvailable && (<><div className="orb-pulse absolute inset-0" /><div className="orb-pulse absolute inset-0" style={{ animationDelay: '1s' }} /></>)}
          <div className={`absolute inset-4 rounded-full border transition-all duration-500 ${tapAvailable ? 'border-gold/20 shadow-[0_0_30px_rgba(255,184,0,0.15)]' : 'border-white/5 shadow-none'}`} />
          <div className={`absolute inset-6 rounded-full flex items-center justify-center transition-all duration-500 ${tapAvailable ? 'bg-gradient-radial from-yellow-300 via-amber-500 to-amber-700 shadow-[0_0_40px_rgba(255,184,0,0.3)]' : 'bg-gray-800 shadow-none'}`}>
            <div className={`absolute top-3 left-4 w-8 h-5 rounded-full blur-sm transition-opacity ${tapAvailable ? 'bg-white/20' : 'bg-white/5'}`} />
            <div className="text-center">
              <div className={`font-orbitron font-bold text-lg leading-none transition-colors ${tapAvailable ? 'text-[#050508]' : 'text-text-muted'}`}>{tapAvailable ? 'TAP' : 'WAIT'}</div>
              <div className={`text-[10px] font-bold mt-0.5 transition-colors ${tapAvailable ? 'text-[#050508]/70' : 'text-text-muted'}`}>{tapAvailable ? '24H MINING' : 'NEXT TAP'}</div>
            </div>
          </div>
        </div>

        <div className="w-48 mt-4 text-center">
          {tapAvailable ? (
            <div className="text-xs text-gold font-medium animate-pulse">⚡ Daily mining ready! Tap to activate</div>
          ) : (
            <div className="space-y-1">
              <div className="text-[10px] text-text-secondary mb-1 font-orbitron">NEXT TAP IN</div>
              <div className="h-2 bg-surface rounded-full overflow-hidden border border-border">
                <div className="h-full bg-gold/50 transition-all duration-1000" style={{ width: `${Math.max(0, Math.min(100, ((Date.now() - (user.lastDailyTapAt || 0)) / 86400000) * 100))}%` }} />
              </div>
              <div className="font-orbitron text-sm text-gold">{countdown}</div>
              <div className="text-[10px] text-text-muted">Session reward: {user.miningRate} TMC</div>
            </div>
          )}
        </div>
      </div>

      <div className="glass-card-gold p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-gold" /><span className="font-orbitron text-sm text-gold">Daily Bonus</span></div>
          <span className="text-xs text-text-secondary">Streak: {user.claimStreak} days</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-text-secondary">{canClaim ? 'Ready!' : 'Come back in 24h'}</div>
          <button onClick={handleDailyClaim} disabled={!canClaim} className="btn-gold px-4 py-2 text-xs disabled:opacity-30">CLAIM</button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-orbitron text-sm text-text-secondary uppercase tracking-wider px-1">Mining Upgrades</h3>
        {upgrades.map(upg => {
          const isActive = user.miningLevel === upg.level;
          const isUnlocked = user.referrals >= upg.referrals;
          const isLocked = !isUnlocked && user.miningLevel < upg.level;
          return (
            <div key={upg.level} className={`glass-card p-3 flex items-center justify-between ${isActive ? 'glass-card-gold' : ''}`}>
              <div className="flex items-center gap-3"><span className="text-xl">{upg.icon}</span><div><div className="font-sora font-semibold text-sm">{upg.name}</div><div className="text-[10px] text-text-secondary">{upg.rate} TMC/session</div></div></div>
              <div className="flex items-center gap-2">
                {isActive ? <span className="text-xs text-cyan font-bold px-2 py-1 bg-cyan/10 rounded">ACTIVE ✓</span> :
                 isLocked ? <span className="text-xs text-text-muted px-2 py-1 bg-surface rounded">🔒 {upg.referrals} refs</span> :
                 <button onClick={() => handleUpgrade(upg)} className="px-3 py-1.5 rounded text-xs font-bold font-orbitron btn-gold">UNLOCK</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CasinoTab({ user, setUser, liveBets, setLiveBets, addTransaction, setTransactions, crashDisplay, crashUserBet, crashUserCashed, crashBetAmount, setCrashBetAmount, crashAutoCashout, setCrashAutoCashout, crashAutoBet, toggleAutoBet, autoBetSettings, setAutoBetSettings, autoBetStats, showAutoBetSettings, setShowAutoBetSettings, onManualBet, onManualCashout }) {
  const [selectedGame, setSelectedGame] = useState(null);

  const games = [
    { id: 'crash', icon: '🚀', label: 'Crash', color: '#FF3D71', desc: 'Fly high, cash out before crash' },
    { id: 'dice', icon: '🎲', label: 'Dice', color: '#00E096', desc: 'Roll over or under your target' },
    { id: 'limbo', icon: '🎯', label: 'Limbo', color: '#FFB800', desc: 'Beat the multiplier threshold' },
  ];

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="glass-card p-2 overflow-hidden">
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse-live" />
          <span className="text-[10px] text-text-secondary uppercase tracking-wider">Live Bets</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 text-xs whitespace-nowrap">
          {liveBets.map(bet => (
            <div key={bet.id} className="flex items-center gap-1.5">
              <span className={bet.result === 'win' ? 'text-green' : 'text-red'}>{bet.result === 'win' ? '✅' : '💥'}</span>
              <span className="text-text-secondary">{bet.username}</span>
              <span className={bet.result === 'win' ? 'text-green' : 'text-red'}>{bet.result === 'win' ? `+${bet.profit}` : bet.profit} TMC</span>
              <span className="text-text-muted">on {bet.game}</span>
            </div>
          ))}
        </div>
      </div>

      {!selectedGame ? (
        <div className="space-y-3">
          <div className="text-center py-2">
            <div className="font-orbitron text-sm text-gold tracking-wider">SELECT A GAME</div>
            <div className="text-[10px] text-text-muted mt-1">Choose your game to start playing</div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {games.map(game => (
              <button
                key={game.id}
                onClick={() => setSelectedGame(game.id)}
                className="glass-card p-4 flex items-center gap-4 text-left transition-all hover:border-gold/30 hover:bg-gold/5 active:scale-[0.98]"
              >
                <div className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl" style={{ background: `${game.color}15`, border: `1px solid ${game.color}30` }}>
                  {game.icon}
                </div>
                <div className="flex-1">
                  <div className="font-orbitron font-bold text-sm" style={{ color: game.color }}>{game.label}</div>
                  <div className="text-[10px] text-text-muted mt-0.5">{game.desc}</div>
                </div>
                <div className="text-gold text-lg">›</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={() => setSelectedGame(null)}
            className="flex items-center gap-2 text-xs text-text-secondary hover:text-gold transition-colors"
          >
            <span className="text-lg">‹</span>
            <span className="font-sora font-medium">Back to Games</span>
          </button>
          <div className="min-h-[400px]">
            {selectedGame === 'crash' && <CrashGame user={user} crashDisplay={crashDisplay} crashUserBet={crashUserBet} crashUserCashed={crashUserCashed} crashBetAmount={crashBetAmount} setCrashBetAmount={setCrashBetAmount} crashAutoCashout={crashAutoCashout} setCrashAutoCashout={setCrashAutoCashout} crashAutoBet={crashAutoBet} toggleAutoBet={toggleAutoBet} autoBetSettings={autoBetSettings} setAutoBetSettings={setAutoBetSettings} autoBetStats={autoBetStats} showAutoBetSettings={showAutoBetSettings} setShowAutoBetSettings={setShowAutoBetSettings} onManualBet={onManualBet} onManualCashout={onManualCashout} />}
            {selectedGame === 'dice' && <DiceGame user={user} setUser={setUser} addTransaction={addTransaction} />}
            {selectedGame === 'limbo' && <LimboGame user={user} setUser={setUser} addTransaction={addTransaction} />}
          </div>
        </div>
      )}
    </div>
  );
}

function CrashGame({ user, crashDisplay, crashUserBet, crashUserCashed, crashBetAmount, setCrashBetAmount, crashAutoCashout, setCrashAutoCashout, crashAutoBet, toggleAutoBet, autoBetSettings, setAutoBetSettings, autoBetStats, showAutoBetSettings, setShowAutoBetSettings, onManualBet, onManualCashout }) {
  const { gameState, displayMultiplier, crashPoint, timeLeft, roundNumber, chartPoints, history, screenShake, particles, rocketRotation, roundBets, serverSeedHash } = crashDisplay;
  const [controlTab, setControlTab] = useState('manual');

  const isBetting = gameState === 'betting';
  const isFlying = gameState === 'flying';
  const isCrashed = gameState === 'crashed';
  const hasBet = crashUserBet !== null;
  const hasCashed = crashUserCashed;

  const handleBetInput = (e) => {
    const val = e.target.value;
    if (val === '' || val === '.') { setCrashBetAmount(val); return; }
    const num = parseFloat(val);
    if (isNaN(num)) return;
    if (num < 0.01) { setCrashBetAmount('0.01'); return; }
    const max = user.tmcBalance;
    if (num > max) { setCrashBetAmount(max.toFixed(2)); return; }
    setCrashBetAmount(parseFloat(num.toFixed(2)).toString());
  };

  const handleAutoCashoutInput = (e) => {
    const val = e.target.value;
    if (val === '' || val === '.') { setCrashAutoCashout(val); return; }
    const num = parseFloat(val);
    if (isNaN(num)) return;
    if (num < 1.01) { setCrashAutoCashout('1.01'); return; }
    setCrashAutoCashout(val);
  };

  const updateAutoBetSetting = (key, subKey, value) => {
    setAutoBetSettings(prev => ({ ...prev, [key]: { ...prev[key], [subKey]: value } }));
  };

  const halfBet = () => setCrashBetAmount(prev => parseFloat(Math.max(0.01, (parseFloat(prev) || 0) / 2).toFixed(2)).toString());
  const doubleBet = () => setCrashBetAmount(prev => {
    const doubled = (parseFloat(prev) || 0) * 2;
    const max = user.tmcBalance;
    return parseFloat(Math.min(max, doubled).toFixed(2)).toString();
  });

  const maxT = Math.max(8, chartPoints[chartPoints.length - 1]?.t || 8);
  const maxM = Math.max(10, crashDisplay.multiplier * 1.2);

  const generateSmoothPath = (pts) => {
    if (pts.length < 2) return '';
    let path = `M ${(pts[0].t / maxT) * 94} ${100 - ((pts[0].m - 1) / (maxM - 1)) * 100}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1], curr = pts[i];
      const x1 = (prev.t / maxT) * 94, y1 = 100 - ((prev.m - 1) / (maxM - 1)) * 100;
      const x2 = (curr.t / maxT) * 94, y2 = 100 - ((curr.m - 1) / (maxM - 1)) * 100;
      const cpx = (x1 + x2) / 2, cpy = (y1 + y2) / 2;
      path += ` Q ${cpx} ${cpy}, ${x2} ${y2}`;
    }
    return path;
  };

  const smoothPath = generateSmoothPath(chartPoints);
  const areaPath = smoothPath + ` L ${(chartPoints[chartPoints.length - 1]?.t / maxT) * 94 || 0} 100 L 0 100 Z`;
  const currentX = chartPoints.length > 0 ? (chartPoints[chartPoints.length - 1].t / maxT) * 94 : 0;
  const currentY = chartPoints.length > 0 ? 100 - ((chartPoints[chartPoints.length - 1].m - 1) / (maxM - 1)) * 100 : 100;

  const getLineColor = (m) => { if (m < 2) return '#00E096'; if (m < 5) return '#FFB800'; if (m < 10) return '#00E5FF'; return '#C084FC'; };
  const currentColor = isCrashed ? '#FF3D71' : getLineColor(crashDisplay.multiplier);

  return (
    <div className={`space-y-3 ${screenShake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {history.map((h, i) => (
          <button key={i} className={`flex-shrink-0 px-2 py-1 rounded-lg text-xs font-orbitron font-bold transition-all hover:scale-105 ${h >= 2 ? 'bg-green/20 text-green border border-green/30' : h >= 1.5 ? 'bg-gold/20 text-gold border border-gold/30' : 'bg-red/20 text-red border border-red/30'}`}>
            {h.toFixed(2)}×
          </button>
        ))}
      </div>

      <div className={`glass-card p-0 relative h-64 overflow-hidden ${isCrashed ? 'lose-flash' : ''}`}>
        <svg width="0" height="0" className="absolute">
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="strongGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={currentColor} stopOpacity="0.3" /><stop offset="100%" stopColor={currentColor} stopOpacity="0" /></linearGradient>
          </defs>
        </svg>

        <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
          {[1, 2, 3, 5, 10, 20, 50].map(g => {
            const y = 100 - ((g - 1) / (maxM - 1)) * 100;
            if (y < 0 || y > 100 || g > maxM) return null;
            return (
              <g key={g}>
                <line x1="0" y1={y} x2="100" y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="0.2" />
                <text x="2" y={y - 1} fontSize="2.5" fill="rgba(255,255,255,0.2)" fontFamily="Orbitron">{g}×</text>
              </g>
            );
          })}
          {[2, 4, 6, 8].map(t => {
            const x = (t / maxT) * 94;
            if (x > 100) return null;
            return <line key={t} x1={x} y1="0" x2={x} y2="100" stroke="rgba(255,255,255,0.02)" strokeWidth="0.2" strokeDasharray="1,2" />;
          })}

          {smoothPath && !isBetting && <path d={areaPath} fill="url(#areaGradient)" opacity="0.6" />}
          {smoothPath && !isBetting && <path d={smoothPath} fill="none" stroke={currentColor} strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 2px ${currentColor}) drop-shadow(0 0 4px ${currentColor})` }} />}
          {smoothPath && !isBetting && <path d={smoothPath} fill="none" stroke={currentColor} strokeWidth="0.3" strokeLinecap="round" opacity="0.9" />}

          {isFlying && particles.map(p => <circle key={p.id} cx={p.x} cy={p.y} r={p.size * 0.15} fill={currentColor} opacity={p.opacity * 0.4} />)}

          {isFlying && (
            <g transform={`translate(${currentX}, ${currentY}) rotate(${rocketRotation})`}>
              <circle cx="0" cy="0" r="5" fill={currentColor} opacity="0.15" filter="url(#strongGlow)" />
              <path d="M 0,-7 L 2,0 L 1.5,4 L 0,5 L -1.5,4 L -2,0 Z" fill="#E0E0E0" stroke="#FFB800" strokeWidth="0.4" />
              <path d="M 0,-7 L 1.2,-2 L 0,-1.5 L -1.2,-2 Z" fill="#FFB800" />
              <path d="M 0,-7 L 0.6,-3 L 0,-2.5 L -0.6,-3 Z" fill="#FFE066" />
              <circle cx="0" cy="-1" r="1" fill="#00E5FF" opacity="0.8" />
              <circle cx="0" cy="-1" r="0.6" fill="#050508" opacity="0.6" />
              <path d="M -2,0 L -4,3 L -1.5,3 Z" fill="#FF8C00" />
              <path d="M 2,0 L 4,3 L 1.5,3 Z" fill="#FF8C00" />
              <path d="M -1.5,4 L -2.5,6 L -0.5,5 Z" fill="#FF6B00" opacity="0.9" />
              <path d="M 1.5,4 L 2.5,6 L 0.5,5 Z" fill="#FF6B00" opacity="0.9" />
              <path d="M -1,5 Q 0,9 1,5 Q 0,7.5 -1,5" fill="#FF3D00" opacity="0.9" />
              <path d="M -0.6,5 Q 0,8 0.6,5 Q 0,7 -0.6,5" fill="#FFB800" opacity="0.7" />
              <path d="M -0.3,5 Q 0,6.5 0.3,5 Q 0,6 -0.3,5" fill="#FFF" opacity="0.5" />
            </g>
          )}

          {isCrashed && particles.map((p, i) => <circle key={p.id} cx={p.x + (Date.now() - p.id) * p.vx * 0.01} cy={p.y + (Date.now() - p.id) * p.vy * 0.01} r={p.size * 0.2} fill={p.color} opacity={Math.max(0, 1 - (Date.now() - p.id) / 1000)} />)}

          {isCrashed && (
            <g transform={`translate(${currentX}, ${currentY})`}>
              <text x="0" y="0" fontSize="6" textAnchor="middle" dominantBaseline="middle" fill="#FF3D71" style={{ filter: 'drop-shadow(0 0 5px #FF3D71)' }}>💥</text>
              <line x1="-3" y1="-3" x2="3" y2="3" stroke="#FF3D71" strokeWidth="0.5" opacity="0.6" />
              <line x1="3" y1="-3" x2="-3" y2="3" stroke="#FF3D71" strokeWidth="0.5" opacity="0.6" />
            </g>
          )}

          {isBetting && (
            <g>
              <line x1="0" y1="95" x2="100" y2="95" stroke="#00E096" strokeWidth="0.3" strokeDasharray="2,2" opacity="0.5" />
              <text x="50" y="90" fontSize="4" textAnchor="middle" fill="#00E096" fontFamily="Orbitron" opacity="0.8">PREPARING FOR LAUNCH...</text>
            </g>
          )}
        </svg>

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
          <div className={`font-orbitron text-5xl font-bold transition-colors duration-300 ${isCrashed ? 'text-red' : displayMultiplier < 2 ? 'text-green' : displayMultiplier < 5 ? 'text-gold' : displayMultiplier < 10 ? 'text-cyan' : 'text-purple'}`} style={{ textShadow: `0 0 20px ${currentColor}40` }}>
            {displayMultiplier.toFixed(2)}×
          </div>
          {isBetting && <div className="text-xs text-green mt-1 font-bold animate-pulse">LAUNCH IN {timeLeft}s</div>}
          {isCrashed && <div className="text-xs text-red mt-1 font-bold">CRASHED @ {crashPoint?.toFixed(2)}×</div>}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex gap-1 p-0.5 bg-surface rounded-lg">
          {['manual', 'auto'].map(tab => (
            <button key={tab} onClick={() => setControlTab(tab)} className={`flex-1 py-2 rounded-md text-xs font-bold font-sora transition-all flex items-center justify-center ${controlTab === tab ? 'bg-gold/20 text-gold border border-gold/30' : 'text-text-secondary hover:text-text-primary'}`}>
              {tab === 'manual' && <span>Manual</span>}
              {tab === 'auto' && <span className="flex items-center justify-center gap-1">Auto {crashAutoBet && <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />}</span>}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="glass-card p-2 min-w-0">
            <div className="text-[9px] text-text-secondary uppercase tracking-wider mb-1">Amount</div>
            <div className="flex items-center gap-1">
              <span className="text-gold text-xs flex-shrink-0">◎</span>
              <input type="number" value={crashBetAmount} onChange={handleBetInput} className="w-full bg-transparent font-orbitron text-sm outline-none min-w-0" step="0.01" />
              <div className="flex gap-0.5 flex-shrink-0">
                <button onClick={halfBet} className="px-1.5 py-0.5 bg-surface rounded text-[9px] font-bold text-text-secondary hover:text-gold">1/2</button>
                <button onClick={doubleBet} className="px-1.5 py-0.5 bg-surface rounded text-[9px] font-bold text-text-secondary hover:text-gold">2×</button>
              </div>
            </div>
          </div>
          <div className="glass-card p-2 min-w-0">
            <div className="text-[9px] text-text-secondary uppercase tracking-wider mb-1">Auto Cashout</div>
            <div className="flex items-center gap-1">
              <input type="number" value={crashAutoCashout} onChange={handleAutoCashoutInput} placeholder="1.01" className="w-full bg-transparent font-orbitron text-sm outline-none min-w-0" step="0.01" />
              <span className="text-xs text-text-secondary font-bold flex-shrink-0">×</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {[1, 10, 100, 1000].map(n => (
            <button key={n} onClick={() => setCrashBetAmount(Math.min(n, user.tmcBalance).toFixed(2))} className="py-1.5 rounded-lg text-xs font-bold font-orbitron glass-card text-text-secondary hover:text-gold hover:border-gold/30 transition-all">
              {n >= 1000 ? (n/1000).toFixed(1) + 'k' : n}
            </button>
          ))}
        </div>

        {controlTab === 'manual' && (
          <div className="space-y-2">
            {isBetting && !hasBet && (
              <button onClick={onManualBet} disabled={!crashBetAmount || parseFloat(crashBetAmount) < 0.01} className="w-full bg-green hover:bg-green/80 disabled:bg-surface disabled:text-text-muted text-[#050508] py-3.5 rounded-xl text-sm font-bold font-sora transition-all active:scale-95 disabled:cursor-not-allowed">
                {crashBetAmount && parseFloat(crashBetAmount) >= 0.01 ? `BET ${parseFloat(crashBetAmount).toFixed(2)} TMC` : 'MIN 0.01 TMC'}
              </button>
            )}
            {isBetting && hasBet && (
              <button disabled className="w-full bg-surface text-text-muted py-3.5 rounded-xl text-sm font-bold font-sora border border-border">
                ✓ BET PLACED — WAITING FOR LAUNCH
              </button>
            )}
            {isFlying && hasBet && !hasCashed && (
              <button onClick={onManualCashout} className="w-full bg-gold hover:bg-gold/80 text-[#050508] py-3.5 rounded-xl text-sm font-bold font-sora transition-all active:scale-95 animate-pulse">
                CASHOUT @ {displayMultiplier.toFixed(2)}×
              </button>
            )}
            {isFlying && (!hasBet || hasCashed) && (
              <button disabled className="w-full bg-surface text-text-muted py-3.5 rounded-xl text-sm font-bold font-sora border border-border">
                {hasCashed ? '✓ CASHED OUT' : 'BET NEXT ROUND'}
              </button>
            )}
            {isCrashed && (
              <button disabled className="w-full bg-red/10 text-red border border-red/20 py-3.5 rounded-xl text-sm font-bold font-orbitron">
                💥 CRASHED — NEXT ROUND
              </button>
            )}
          </div>
        )}

        {controlTab === 'auto' && (
          <div className="space-y-2">
            <div className="glass-card p-2">
              <div className="text-[9px] text-text-secondary mb-1">Number of Bets</div>
              <div className="flex gap-1">
                <button onClick={() => setAutoBetSettings(prev => ({ ...prev, rounds: 0 }))} className={`flex-1 py-1.5 rounded text-xs font-bold ${autoBetSettings.rounds === 0 ? 'bg-cyan/20 text-cyan border border-cyan/30' : 'glass-card text-text-secondary'}`}><Infinity className="w-3 h-3 mx-auto" /></button>
                {[10, 100].map(n => (
                  <button key={n} onClick={() => setAutoBetSettings(prev => ({ ...prev, rounds: n }))} className={`flex-1 py-1.5 rounded text-xs font-bold ${autoBetSettings.rounds === n ? 'bg-cyan/20 text-cyan border border-cyan/30' : 'glass-card text-text-secondary'}`}>{n}</button>
                ))}
                <input type="number" value={autoBetSettings.rounds} onChange={e => setAutoBetSettings(prev => ({ ...prev, rounds: Number(e.target.value) }))} className="w-14 bg-surface rounded text-xs font-orbitron text-center outline-none" min="0" />
              </div>
            </div>

            <button onClick={toggleAutoBet} className={`w-full py-3.5 rounded-xl text-sm font-bold font-sora transition-all active:scale-95 ${crashAutoBet ? 'bg-red/20 text-red border border-red/30 hover:bg-red/30' : 'bg-green hover:bg-green/80 text-[#050508]'}`}>
              {crashAutoBet ? `STOP AUTO (${autoBetStats.wins}W/${autoBetStats.losses}L)` : 'START AUTO BET'}
            </button>

            <div className="glass-card p-2">
              <button onClick={() => setShowAutoBetSettings(!showAutoBetSettings)} className="w-full flex items-center justify-between text-xs font-bold text-text-secondary">
                <span>Advanced Options</span>
                {showAutoBetSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showAutoBetSettings && (
                <div className="space-y-2 mt-2 pt-2 border-t border-border">
                  <div className="space-y-1">
                    <div className="text-[9px] text-text-secondary">On Win</div>
                    <div className="flex gap-1">
                      <button onClick={() => updateAutoBetSetting('onWin', 'action', 'reset')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoBetSettings.onWin.action === 'reset' ? 'bg-green/20 text-green border border-green/30' : 'glass-card text-text-secondary'}`}>Reset</button>
                      <button onClick={() => updateAutoBetSetting('onWin', 'action', 'increase')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoBetSettings.onWin.action === 'increase' ? 'bg-gold/20 text-gold border border-gold/30' : 'glass-card text-text-secondary'}`}>Increase</button>
                    </div>
                    {autoBetSettings.onWin.action !== 'reset' && (
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-text-muted">by</span>
                        <input type="number" value={autoBetSettings.onWin.value} onChange={e => updateAutoBetSetting('onWin', 'value', Number(e.target.value))} className="w-14 bg-surface rounded px-1 py-0.5 text-xs font-orbitron outline-none" min="0" max="500" />
                        <span className="text-[9px] text-text-muted">%</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="text-[9px] text-text-secondary">On Loss</div>
                    <div className="flex gap-1">
                      <button onClick={() => updateAutoBetSetting('onLoss', 'action', 'reset')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoBetSettings.onLoss.action === 'reset' ? 'bg-green/20 text-green border border-green/30' : 'glass-card text-text-secondary'}`}>Reset</button>
                      <button onClick={() => updateAutoBetSetting('onLoss', 'action', 'increase')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoBetSettings.onLoss.action === 'increase' ? 'bg-gold/20 text-gold border border-gold/30' : 'glass-card text-text-secondary'}`}>Increase</button>
                    </div>
                    {autoBetSettings.onLoss.action !== 'reset' && (
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-text-muted">by</span>
                        <input type="number" value={autoBetSettings.onLoss.value} onChange={e => updateAutoBetSetting('onLoss', 'value', Number(e.target.value))} className="w-14 bg-surface rounded px-1 py-0.5 text-xs font-orbitron outline-none" min="0" max="500" />
                        <span className="text-[9px] text-text-muted">%</span>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><div className="text-[9px] text-text-secondary mb-0.5">Stop on Win</div><input type="number" value={autoBetSettings.stopOnWin} onChange={e => setAutoBetSettings(prev => ({ ...prev, stopOnWin: Number(e.target.value) }))} className="w-full bg-surface rounded px-2 py-1 text-xs font-orbitron outline-none" placeholder="∞" min="0" /></div>
                    <div><div className="text-[9px] text-text-secondary mb-0.5">Stop on Loss</div><input type="number" value={autoBetSettings.stopOnLoss} onChange={e => setAutoBetSettings(prev => ({ ...prev, stopOnLoss: Number(e.target.value) }))} className="w-full bg-surface rounded px-2 py-1 text-xs font-orbitron outline-none" placeholder="∞" min="0" /></div>
                  </div>
                  <div><div className="text-[9px] text-text-secondary mb-0.5">Max Bet</div><input type="number" value={autoBetSettings.maxBet} onChange={e => setAutoBetSettings(prev => ({ ...prev, maxBet: Number(e.target.value) }))} className="w-full bg-surface rounded px-2 py-1 text-xs font-orbitron outline-none" min="0.01" /></div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="glass-card p-3">
        <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />Round Bets
        </div>
        <div className="space-y-1.5 max-h-24 overflow-y-auto">
          {roundBets.length === 0 && <div className="text-xs text-text-muted text-center py-2">No bets this round</div>}
          {roundBets.map((bet, i) => {
            const isCashed = bet.status === 'cashed';
            const isCrashed = bet.status === 'crashed';
            const mult = parseFloat(bet.multiplier);
            const hasValidMult = !isNaN(mult) && mult > 1.01;
            // Profit is always calculated from the stored multiplier so it matches the display
            const profit = hasValidMult ? Number((bet.amount * mult) - bet.amount).toFixed(2) : null;
            return (
              <div key={i} className="flex items-center justify-between text-xs glass-card p-2">
                <span className="text-text-secondary">👤 {bet.username}</span>
                <span className="font-orbitron text-gold">{bet.amount} TMC</span>
                <span className={isCashed ? 'text-green' : isCrashed ? 'text-red' : 'text-cyan'}>
                  {isCashed
                    ? (profit !== null ? `✅ +${profit} @ ${mult.toFixed(2)}×` : `✅ CASHED`)
                    : isCrashed
                      ? `💥 -${bet.amount}`
                      : '● ACTIVE'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DiceGame({ user, setUser, addTransaction }) {
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState('over');
  const [betAmount, setBetAmount] = useState(50);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [history, setHistory] = useState([]);
  const [lastRoll, setLastRoll] = useState(null);
  const [multInput, setMultInput] = useState('');

  const [controlTab, setControlTab] = useState('manual');
  const [autoBet, setAutoBet] = useState(false);
  const [autoRounds, setAutoRounds] = useState(0);
  const [autoRolled, setAutoRolled] = useState(0);
  const [autoSettings, setAutoSettings] = useState({
    baseAmount: 50, onWin: { action: 'reset', value: 0 },
    onLoss: { action: 'increase', value: 100 },
    stopOnWin: 0, stopOnLoss: 0, maxBet: 10000,
  });
  const [autoStats, setAutoStats] = useState({ wins: 0, losses: 0, currentBet: 50, totalProfit: 0, totalLoss: 0 });
  const autoTimerRef = useRef(null);

  const autoStatsRef = useRef(autoStats);
  const autoSettingsRef = useRef(autoSettings);
  const betAmountRef = useRef(parseFloat(betAmount) || 0.01);
  const autoRoundsRef = useRef(autoRounds);
  const rollingRef = useRef(rolling);
  const autoBetRef = useRef(autoBet);
  const autoRolledRef = useRef(autoRolled);
  const directionRef = useRef(direction);
  const targetRef = useRef(target);
  const balanceRef = useRef(user.tmcBalance);
  const userRef = useRef(user);
  const userIdRef = useRef(user.id);

  useEffect(() => { autoStatsRef.current = autoStats; }, [autoStats]);
  useEffect(() => { autoSettingsRef.current = autoSettings; }, [autoSettings]);
  useEffect(() => { betAmountRef.current = parseFloat(betAmount) || 0.01; }, [betAmount]);
  useEffect(() => { autoRoundsRef.current = autoRounds; }, [autoRounds]);
  useEffect(() => { rollingRef.current = rolling; }, [rolling]);
  useEffect(() => { autoBetRef.current = autoBet; }, [autoBet]);
  useEffect(() => { autoRolledRef.current = autoRolled; }, [autoRolled]);
  useEffect(() => { directionRef.current = direction; }, [direction]);
  useEffect(() => { targetRef.current = target; }, [target]);
  useEffect(() => { balanceRef.current = user.tmcBalance; }, [user.tmcBalance]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { userIdRef.current = user.id; }, [user.id]);

  const sliderRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const getTargetFromX = (clientX) => {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect) return target;
    const pct = (clientX - rect.left) / rect.width;
    let val = pct * 100;
    if (direction === 'over') val = Math.max(0.01, Math.min(99.99, val));
    else val = Math.max(1.01, Math.min(99.99, val));
    return parseFloat(val.toFixed(2));
  };

  const handleSliderDown = (e) => {
    e.preventDefault();
    setDragging(true);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    setTarget(getTargetFromX(clientX));
  };

  const updateAutoSetting = (key, subKey, value) => {
    setAutoSettings(prev => ({ ...prev, [key]: { ...prev[key], [subKey]: value } }));
  };

  const winChance = Math.max(0.01, direction === 'over' ? 100 - target : target - 1);
  const multiplier = parseFloat((99 / winChance).toFixed(2));
  const potentialWin = (betAmount * multiplier).toFixed(2);

  const calculateNextBet = (lastResult) => {
    const settings = autoSettingsRef.current;
    const stats = autoStatsRef.current;
    let nextBet = stats.currentBet;
    if (lastResult === 'win') {
      if (settings.onWin.action === 'reset') nextBet = settings.baseAmount;
      else if (settings.onWin.action === 'increase') nextBet = stats.currentBet * (1 + settings.onWin.value / 100);
      else if (settings.onWin.action === 'decrease') nextBet = stats.currentBet * (1 - settings.onWin.value / 100);
    } else {
      if (settings.onLoss.action === 'reset') nextBet = settings.baseAmount;
      else if (settings.onLoss.action === 'increase') nextBet = stats.currentBet * (1 + settings.onLoss.value / 100);
      else if (settings.onLoss.action === 'decrease') nextBet = stats.currentBet * (1 - settings.onLoss.value / 100);
    }
    return Math.max(0.01, Math.min(settings.maxBet, nextBet));
  };

  const executeRoll = async () => {
    const isAuto = autoBetRef.current;
    const currentBet = isAuto ? autoStatsRef.current.currentBet : betAmountRef.current;
    const currentDirection = directionRef.current;
    const currentTarget = targetRef.current;
    const currentWinChance = currentDirection === 'over' ? 100 - currentTarget : currentTarget - 1;
    const currentMultiplier = parseFloat((99 / currentWinChance).toFixed(2));

    if (balanceRef.current < currentBet) {
      autoBetRef.current = false; setAutoBet(false);
      clearInterval(autoTimerRef.current);
      alert('Insufficient balance!'); return;
    }

    const preBalance = balanceRef.current;
    const newBalance = preBalance - currentBet;
    const u = userRef.current;
    const uid = userIdRef.current;

    setUser(prev => {
      const updated = { ...prev, tmcBalance: newBalance, totalWagered: prev.totalWagered + currentBet };
      balanceRef.current = newBalance;
      return updated;
    });
    setRolling(true); rollingRef.current = true;
    setShowResult(false); setResult(null);

    let dbBetId = null;
    if (uid && !String(uid).startsWith('local-')) {
      try {
        await apiUpdateUser(uid, { balance: newBalance, total_wagered: u.totalWagered + currentBet });
        const bet = await apiPlaceBet({
          user_id: uid, amount: currentBet, target_value: currentTarget,
          dice_direction: currentDirection, status: 'active',
          is_auto_bet: isAuto, placed_at: new Date().toISOString()
        });
        dbBetId = bet.id;
      } catch (e) { console.error('DB dice bet failed:', e); }
    }

    setTimeout(async () => {
      const roll = parseFloat((Math.random() * 100).toFixed(2));
      const isWin = currentDirection === 'over' ? roll > currentTarget : roll < currentTarget;
      const winAmount = isWin ? currentBet * currentMultiplier : 0;
      const nextBet = calculateNextBet(isWin ? 'win' : 'loss');
      const postBalance = isWin ? newBalance + winAmount : newBalance;
      const profit = isWin ? winAmount - currentBet : -currentBet;

      setResult({ roll, isWin, winAmount, multiplier: currentMultiplier });
      setRolling(false); rollingRef.current = false;
      setShowResult(true); setLastRoll(roll);
      setHistory(prev => [{ roll, isWin, multiplier: currentMultiplier }, ...prev].slice(0, 20));

      if (isWin) {
        setUser(prev => {
          const updated = { ...prev, tmcBalance: postBalance, totalWon: prev.totalWon + profit };
          balanceRef.current = postBalance;
          return updated;
        });
        addTransaction({ type: 'bet_credit', amount: winAmount, direction: 'credit', note: `Dice ${roll} ${currentDirection} ${currentTarget} @ ${currentMultiplier}×` });
        const newStats = { ...autoStatsRef.current, wins: autoStatsRef.current.wins + 1, currentBet: nextBet, totalProfit: autoStatsRef.current.totalProfit + profit };
        autoStatsRef.current = newStats; setAutoStats(newStats);
      } else {
        setUser(prev => ({ ...prev, totalLost: prev.totalLost + currentBet }));
        addTransaction({ type: 'bet_debit', amount: currentBet, direction: 'debit', note: `Dice ${roll} ${currentDirection} ${currentTarget}` });
        const newStats = { ...autoStatsRef.current, losses: autoStatsRef.current.losses + 1, currentBet: nextBet, totalLoss: autoStatsRef.current.totalLoss + currentBet };
        autoStatsRef.current = newStats; setAutoStats(newStats);
      }

      if (uid && !String(uid).startsWith('local-')) {
        try {
          if (isWin) await apiUpdateUser(uid, { balance: postBalance, total_won: u.totalWon + profit });
          else await apiUpdateUser(uid, { total_lost: u.totalLost + currentBet });
          if (dbBetId) await apiUpdateBet(dbBetId, { status: isWin ? 'won' : 'lost', result_value: roll, profit: profit, settled_at: new Date().toISOString() });
          await apiAddTransaction({ user_id: uid, type: isWin ? 'bet_credit' : 'bet_debit', direction: isWin ? 'credit' : 'debit', amount: isWin ? winAmount : currentBet, balance_after: postBalance, metadata: { note: `Dice ${roll} ${currentDirection} ${currentTarget}` } });
        } catch (e) { console.error('DB dice result sync failed:', e); }
      }

      if (isAuto) { setBetAmount(nextBet.toFixed(2)); betAmountRef.current = nextBet; }
      autoRolledRef.current += 1; setAutoRolled(prev => prev + 1);
    }, 350);
  };

  const toggleAuto = () => {
    if (autoBetRef.current) {
      autoBetRef.current = false; setAutoBet(false);
      clearInterval(autoTimerRef.current);
    } else {
      autoBetRef.current = true; setAutoBet(true);
      setAutoRolled(0); autoRolledRef.current = 0;
      const initialBet = betAmountRef.current;
      const syncedSettings = { ...autoSettingsRef.current, baseAmount: initialBet };
      autoSettingsRef.current = syncedSettings; setAutoSettings(syncedSettings);
      const initialStats = { wins: 0, losses: 0, currentBet: initialBet, totalProfit: 0, totalLoss: 0 };
      autoStatsRef.current = initialStats; setAutoStats(initialStats);
      setBetAmount(initialBet.toFixed(2));
      executeRoll();
      autoTimerRef.current = setInterval(() => {
        const s = autoSettingsRef.current; const stats = autoStatsRef.current;
        if ((s.stopOnWin > 0 && stats.totalProfit >= s.stopOnWin) || (s.stopOnLoss > 0 && stats.totalLoss >= s.stopOnLoss)) {
          autoBetRef.current = false; setAutoBet(false); clearInterval(autoTimerRef.current); return;
        }
        if (autoRoundsRef.current > 0 && autoRolledRef.current >= autoRoundsRef.current) {
          autoBetRef.current = false; setAutoBet(false); clearInterval(autoTimerRef.current); return;
        }
        if (!rollingRef.current) executeRoll();
      }, 800);
    }
  };

  useEffect(() => { return () => clearInterval(autoTimerRef.current); }, []);

  const handleRoll = () => { if (rollingRef.current) return; executeRoll(); };
  const halfBet = () => setBetAmount(prev => parseFloat(Math.max(0.01, prev / 2).toFixed(2)));
  const doubleBet = () => setBetAmount(prev => { const doubled = prev * 2; const max = balanceRef.current; return parseFloat(Math.min(max, doubled).toFixed(2)); });
  const halfTarget = () => setTarget(prev => Math.max(1.01, parseFloat((prev / 2).toFixed(2))));
  const doubleTarget = () => setTarget(prev => Math.max(1.01, parseFloat((prev * 2).toFixed(2))));

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {history.map((h, i) => (
          <button key={i} className={`flex-shrink-0 px-2 py-1 rounded-lg text-xs font-orbitron font-bold transition-all hover:scale-105 ${h.isWin ? 'bg-green/20 text-green border border-green/30' : 'bg-red/20 text-red border border-red/30'}`}>{h.roll}</button>
        ))}
      </div>
      <div className={`glass-card p-4 text-center ${showResult && result?.isWin ? 'win-flash' : showResult && !result?.isWin ? 'lose-flash' : ''}`}>
        <div className={`font-orbitron text-4xl font-bold mb-3 ${rolling ? 'number-roll' : ''} ${showResult ? (result?.isWin ? 'text-green' : 'text-red') : 'text-gold'}`}>{rolling ? '—' : showResult ? result?.roll : '—'}</div>
        <div className="relative mb-2 select-none" ref={sliderRef}
          onMouseDown={handleSliderDown} onTouchStart={handleSliderDown}
          onMouseMove={(e) => { if (dragging) { e.preventDefault(); setTarget(getTargetFromX(e.clientX)); } }}
          onTouchMove={(e) => { if (dragging) { e.preventDefault(); setTarget(getTargetFromX(e.touches[0].clientX)); } }}
          onMouseUp={() => setDragging(false)} onTouchEnd={() => setDragging(false)} onMouseLeave={() => setDragging(false)}
        >
          <div className="relative h-3 bg-surface rounded-full overflow-hidden cursor-pointer">
            <div className="absolute inset-y-0 bg-green/50 rounded-full" style={{ left: `${direction === 'over' ? target : 0}%`, width: `${winChance}%` }} />
            <div className="absolute inset-y-0 bg-red/50 rounded-full" style={{ left: `${direction === 'over' ? 0 : target}%`, width: `${100 - winChance}%` }} />
            <div className="absolute top-0 bottom-0 w-0.5 bg-white z-10" style={{ left: `${target}%` }} />
            <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.6)] border border-white/50 z-20" style={{ left: `${showResult ? result?.roll : (lastRoll !== null ? lastRoll : target)}%`, transition: showResult ? 'left 0.35s ease-out' : 'none' }} />
          </div>
          <div className="flex justify-between text-[9px] text-text-muted mt-1"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={() => setDirection('over')} className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${direction === 'over' ? 'bg-cyan/20 text-cyan border border-cyan/30' : 'glass-card text-text-secondary'}`}>ROLL OVER</button>
          <button onClick={() => setDirection('under')} className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${direction === 'under' ? 'bg-cyan/20 text-cyan border border-cyan/30' : 'glass-card text-text-secondary'}`}>ROLL UNDER</button>
        </div>
      </div>
      <div className="flex gap-1 p-0.5 bg-surface rounded-lg">
        {['manual', 'auto'].map(tab => (
          <button key={tab} onClick={() => setControlTab(tab)} className={`flex-1 py-2 rounded-md text-xs font-bold font-sora transition-all ${controlTab === tab ? 'bg-gold/20 text-gold border border-gold/30' : 'text-text-secondary'}`}>
            {tab === 'manual' ? 'Manual' : <span className="flex items-center justify-center gap-1">Auto {autoBet && <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />}</span>}
          </button>
        ))}
      </div>
      <div className="glass-card p-2">
        <div className="text-[9px] text-text-secondary uppercase tracking-wider mb-1">Amount</div>
        <div className="flex items-center gap-1">
          <span className="text-gold text-xs">◎</span>
          <input type="text" inputMode="decimal" value={betAmount} onChange={e => { const val = e.target.value; if (val === '' || val === '.') { setBetAmount(val); return; } const num = parseFloat(val); if (isNaN(num)) return; if (num < 0.01) { setBetAmount('0.01'); return; } const max = balanceRef.current; if (num > max) { setBetAmount(parseFloat(max.toFixed(2))); return; } setBetAmount(parseFloat(num.toFixed(2))); }} onBlur={e => { const val = e.target.value; if (val === '' || val === '.' || isNaN(parseFloat(val)) || parseFloat(val) < 0.01) { setBetAmount('0.01'); return; } const max = balanceRef.current; const num = parseFloat(val); if (num > max) setBetAmount(parseFloat(max.toFixed(2))); }} className="flex-1 bg-transparent font-orbitron text-sm outline-none" />
          <div className="flex gap-0.5">
            <button onClick={halfBet} className="px-1.5 py-0.5 bg-surface rounded text-[9px] font-bold text-text-secondary hover:text-gold">1/2</button>
            <button onClick={doubleBet} className="px-1.5 py-0.5 bg-surface rounded text-[9px] font-bold text-text-secondary hover:text-gold">2×</button>
          </div>
        </div>
      </div>
      {controlTab === 'auto' && (
        <div className="space-y-2">
          <div className="glass-card p-2">
            <div className="text-[9px] text-text-secondary mb-1">Rounds</div>
            <div className="flex gap-1">
              <button onClick={() => setAutoRounds(0)} className={`flex-1 py-1.5 rounded text-xs font-bold ${autoRounds === 0 ? 'bg-cyan/20 text-cyan border border-cyan/30' : 'glass-card text-text-secondary'}`}><Infinity className="w-3 h-3 mx-auto" /></button>
              {[10, 50, 100].map(n => <button key={n} onClick={() => setAutoRounds(n)} className={`flex-1 py-1.5 rounded text-xs font-bold ${autoRounds === n ? 'bg-cyan/20 text-cyan border border-cyan/30' : 'glass-card text-text-secondary'}`}>{n}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="glass-card p-2">
              <div className="text-[9px] text-text-secondary mb-1">On Win</div>
              <div className="flex gap-1 mb-1">
                <button onClick={() => updateAutoSetting('onWin', 'action', 'reset')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoSettings.onWin.action === 'reset' ? 'bg-green/20 text-green border border-green/30' : 'glass-card text-text-secondary'}`}>Reset</button>
                <button onClick={() => updateAutoSetting('onWin', 'action', 'increase')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoSettings.onWin.action === 'increase' ? 'bg-gold/20 text-gold border border-gold/30' : 'glass-card text-text-secondary'}`}>Increase</button>
              </div>
              {autoSettings.onWin.action !== 'reset' && (
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-text-muted">by</span>
                  <input type="text" inputMode="decimal" value={autoSettings.onWin.value || ''} onChange={e => { const v = e.target.value; if (v === '' || v === '.') { updateAutoSetting('onWin', 'value', 0); return; } const n = parseFloat(v); if (!isNaN(n)) updateAutoSetting('onWin', 'value', n); }} onBlur={e => { const n = parseFloat(e.target.value); if (isNaN(n) || n < 0) updateAutoSetting('onWin', 'value', 0); }} className="w-full bg-surface rounded px-1 py-0.5 text-xs font-orbitron outline-none" />
                  <span className="text-[9px] text-text-muted">%</span>
                </div>
              )}
            </div>
            <div className="glass-card p-2">
              <div className="text-[9px] text-text-secondary mb-1">On Loss</div>
              <div className="flex gap-1 mb-1">
                <button onClick={() => updateAutoSetting('onLoss', 'action', 'reset')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoSettings.onLoss.action === 'reset' ? 'bg-green/20 text-green border border-green/30' : 'glass-card text-text-secondary'}`}>Reset</button>
                <button onClick={() => updateAutoSetting('onLoss', 'action', 'increase')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoSettings.onLoss.action === 'increase' ? 'bg-gold/20 text-gold border border-gold/30' : 'glass-card text-text-secondary'}`}>Increase</button>
              </div>
              {autoSettings.onLoss.action !== 'reset' && (
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-text-muted">by</span>
                  <input type="text" inputMode="decimal" value={autoSettings.onLoss.value || ''} onChange={e => { const v = e.target.value; if (v === '' || v === '.') { updateAutoSetting('onLoss', 'value', 0); return; } const n = parseFloat(v); if (!isNaN(n)) updateAutoSetting('onLoss', 'value', n); }} onBlur={e => { const n = parseFloat(e.target.value); if (isNaN(n) || n < 0) updateAutoSetting('onLoss', 'value', 0); }} className="w-full bg-surface rounded px-1 py-0.5 text-xs font-orbitron outline-none" />
                  <span className="text-[9px] text-text-muted">%</span>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="glass-card p-2"><div className="text-[9px] text-text-secondary mb-1">Stop on Profit</div><input type="text" inputMode="decimal" value={autoSettings.stopOnWin || ''} onChange={e => { const v = e.target.value; if (v === '' || v === '.') { setAutoSettings(prev => ({ ...prev, stopOnWin: 0 })); return; } const n = parseFloat(v); if (!isNaN(n)) setAutoSettings(prev => ({ ...prev, stopOnWin: n })); }} onBlur={e => { const n = parseFloat(e.target.value); if (isNaN(n) || n < 0) setAutoSettings(prev => ({ ...prev, stopOnWin: 0 })); }} className="w-full bg-surface rounded px-2 py-1 text-xs font-orbitron outline-none" placeholder="∞" /></div>
            <div className="glass-card p-2"><div className="text-[9px] text-text-secondary mb-1">Stop on Loss</div><input type="text" inputMode="decimal" value={autoSettings.stopOnLoss || ''} onChange={e => { const v = e.target.value; if (v === '' || v === '.') { setAutoSettings(prev => ({ ...prev, stopOnLoss: 0 })); return; } const n = parseFloat(v); if (!isNaN(n)) setAutoSettings(prev => ({ ...prev, stopOnLoss: n })); }} onBlur={e => { const n = parseFloat(e.target.value); if (isNaN(n) || n < 0) setAutoSettings(prev => ({ ...prev, stopOnLoss: 0 })); }} className="w-full bg-surface rounded px-2 py-1 text-xs font-orbitron outline-none" placeholder="∞" /></div>
          </div>
          <button onClick={toggleAuto} className={`w-full py-3.5 rounded-xl text-sm font-bold font-sora transition-all active:scale-95 ${autoBet ? 'bg-red/20 text-red border border-red/30' : 'bg-green hover:bg-green/80 text-[#050508]'}`}>{autoBet ? `STOP (${autoStats.wins}W/${autoStats.losses}L)` : 'START AUTO ROLL'}</button>
        </div>
      )}
      {controlTab === 'manual' && (
        <button onClick={handleRoll} disabled={rolling || balanceRef.current < (parseFloat(betAmount) || 0.01)} className="w-full bg-green hover:bg-green/80 text-[#050508] py-3.5 rounded-xl text-sm font-bold font-sora transition-all active:scale-95 disabled:opacity-50">
          {rolling ? 'ROLLING...' : balanceRef.current < (parseFloat(betAmount) || 0.01) ? 'INSUFFICIENT BALANCE' : `ROLL ${(parseFloat(betAmount) || 0.01).toFixed(2)} TMC`}
        </button>
      )}
      <div className="glass-card p-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[9px] text-text-secondary mb-1">Multiplier</div>
          <div className="flex items-center justify-center gap-1">
            <input type="text" inputMode="decimal" value={multInput} placeholder={multiplier.toFixed(2)} onChange={e => setMultInput(e.target.value)} onBlur={e => { const val = e.target.value; if (val === '' || val === '.' || isNaN(parseFloat(val)) || parseFloat(val) < 1.01) { setMultInput(''); } else { const num = parseFloat(val); const winCh = 99 / num; let newTarget; if (direction === 'over') newTarget = 100 - winCh; else newTarget = winCh + 1; newTarget = Math.max(0.01, Math.min(99.99, parseFloat(newTarget.toFixed(2)))); setTarget(newTarget); setMultInput(''); } }} className="w-16 bg-surface rounded px-1 py-0.5 text-xs font-orbitron text-gold text-center outline-none placeholder:text-gold" />
            <span className="text-xs text-gold">×</span>
          </div>
        </div>
        <div><div className="text-[9px] text-text-secondary">Roll {direction === 'over' ? 'Over' : 'Under'}</div><div className="font-orbitron text-sm text-cyan">{parseFloat(target).toFixed(2)}</div></div>
        <div><div className="text-[9px] text-text-secondary">Win Chance</div><div className="font-orbitron text-sm text-green">{winChance.toFixed(2)}%</div></div>
      </div>
    </div>
  );
}

function LimboGame({ user, setUser, addTransaction }) {
  const [target, setTarget] = useState(2.0);
  const [betAmount, setBetAmount] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [history, setHistory] = useState([]);

  const [controlTab, setControlTab] = useState('manual');
  const [autoBet, setAutoBet] = useState(false);
  const [autoRounds, setAutoRounds] = useState(0);
  const [autoRolled, setAutoRolled] = useState(0);
  const [autoSettings, setAutoSettings] = useState({
    baseAmount: 50, onWin: { action: 'reset', value: 0 },
    onLoss: { action: 'increase', value: 100 },
    stopOnWin: 0, stopOnLoss: 0, maxBet: 10000,
  });
  const [autoStats, setAutoStats] = useState({ wins: 0, losses: 0, currentBet: 50, totalProfit: 0, totalLoss: 0 });
  const autoTimerRef = useRef(null);

  const autoStatsRef = useRef(autoStats);
  const autoSettingsRef = useRef(autoSettings);
  const betAmountRef = useRef(parseFloat(betAmount) || 0.01);
  const autoRoundsRef = useRef(autoRounds);
  const playingRef = useRef(playing);
  const autoBetRef = useRef(autoBet);
  const autoRolledRef = useRef(autoRolled);
  const targetRef = useRef(target);
  const balanceRef = useRef(user.tmcBalance);
  const userRef = useRef(user);
  const userIdRef = useRef(user.id);

  useEffect(() => { autoStatsRef.current = autoStats; }, [autoStats]);
  useEffect(() => { autoSettingsRef.current = autoSettings; }, [autoSettings]);
  useEffect(() => { betAmountRef.current = parseFloat(betAmount) || 0.01; }, [betAmount]);
  useEffect(() => { autoRoundsRef.current = autoRounds; }, [autoRounds]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { autoBetRef.current = autoBet; }, [autoBet]);
  useEffect(() => { autoRolledRef.current = autoRolled; }, [autoRolled]);
  useEffect(() => { targetRef.current = target; }, [target]);
  useEffect(() => { balanceRef.current = user.tmcBalance; }, [user.tmcBalance]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { userIdRef.current = user.id; }, [user.id]);

  const updateAutoSetting = (key, subKey, value) => {
    setAutoSettings(prev => ({ ...prev, [key]: { ...prev[key], [subKey]: value } }));
  };

  const winChance = parseFloat((99 / target).toFixed(2));
  const potentialWin = (betAmount * target).toFixed(2);

  const calculateNextBet = (lastResult) => {
    const settings = autoSettingsRef.current;
    const stats = autoStatsRef.current;
    let nextBet = stats.currentBet;
    if (lastResult === 'win') {
      if (settings.onWin.action === 'reset') nextBet = settings.baseAmount;
      else if (settings.onWin.action === 'increase') nextBet = stats.currentBet * (1 + settings.onWin.value / 100);
      else if (settings.onWin.action === 'decrease') nextBet = stats.currentBet * (1 - settings.onWin.value / 100);
    } else {
      if (settings.onLoss.action === 'reset') nextBet = settings.baseAmount;
      else if (settings.onLoss.action === 'increase') nextBet = stats.currentBet * (1 + settings.onLoss.value / 100);
      else if (settings.onLoss.action === 'decrease') nextBet = stats.currentBet * (1 - settings.onLoss.value / 100);
    }
    return Math.max(0.01, Math.min(settings.maxBet, nextBet));
  };

  const executePlay = async () => {
    const isAuto = autoBetRef.current;
    const currentBet = isAuto ? autoStatsRef.current.currentBet : betAmountRef.current;
    const currentTarget = targetRef.current;

    if (balanceRef.current < currentBet) {
      autoBetRef.current = false; setAutoBet(false);
      clearInterval(autoTimerRef.current);
      alert('Insufficient balance!'); return;
    }

    const preBalance = balanceRef.current;
    const newBalance = preBalance - currentBet;
    const u = userRef.current;
    const uid = userIdRef.current;

    setUser(prev => {
      const updated = { ...prev, tmcBalance: newBalance, totalWagered: prev.totalWagered + currentBet };
      balanceRef.current = newBalance;
      return updated;
    });
    setPlaying(true); playingRef.current = true;
    setShowResult(false); setResult(null);

    let dbBetId = null;
    if (uid && !String(uid).startsWith('local-')) {
      try {
        await apiUpdateUser(uid, { balance: newBalance, total_wagered: u.totalWagered + currentBet });
        const bet = await apiPlaceBet({
          user_id: uid, amount: currentBet, target_value: currentTarget,
          status: 'active', is_auto_bet: isAuto, placed_at: new Date().toISOString()
        });
        dbBetId = bet.id;
      } catch (e) { console.error('DB limbo bet failed:', e); }
    }

    setTimeout(async () => {
      const float = Math.random();
      const resultMult = float < 0.01 ? 1.00 : Math.max(1.01, parseFloat((0.99 / (1 - float)).toFixed(2)));
      const isWin = resultMult >= currentTarget;
      const winAmount = isWin ? currentBet * currentTarget : 0;
      const nextBet = calculateNextBet(isWin ? 'win' : 'loss');
      const postBalance = isWin ? newBalance + winAmount : newBalance;
      const profit = isWin ? winAmount - currentBet : -currentBet;

      setResult({ resultMult, isWin, winAmount });
      setPlaying(false); playingRef.current = false;
      setShowResult(true);
      setHistory(prev => [{ resultMult, isWin }, ...prev].slice(0, 20));

      if (isWin) {
        setUser(prev => {
          const updated = { ...prev, tmcBalance: postBalance, totalWon: prev.totalWon + profit };
          balanceRef.current = postBalance;
          return updated;
        });
        addTransaction({ type: 'bet_credit', amount: winAmount, direction: 'credit', note: `Limbo ${resultMult.toFixed(2)}× ≥ ${currentTarget}×` });
        const newStats = { ...autoStatsRef.current, wins: autoStatsRef.current.wins + 1, currentBet: nextBet, totalProfit: autoStatsRef.current.totalProfit + profit };
        autoStatsRef.current = newStats; setAutoStats(newStats);
      } else {
        setUser(prev => ({ ...prev, totalLost: prev.totalLost + currentBet }));
        addTransaction({ type: 'bet_debit', amount: currentBet, direction: 'debit', note: `Limbo ${resultMult.toFixed(2)}× < ${currentTarget}×` });
        const newStats = { ...autoStatsRef.current, losses: autoStatsRef.current.losses + 1, currentBet: nextBet, totalLoss: autoStatsRef.current.totalLoss + currentBet };
        autoStatsRef.current = newStats; setAutoStats(newStats);
      }

      if (uid && !String(uid).startsWith('local-')) {
        try {
          if (isWin) await apiUpdateUser(uid, { balance: postBalance, total_won: u.totalWon + profit });
          else await apiUpdateUser(uid, { total_lost: u.totalLost + currentBet });
          if (dbBetId) await apiUpdateBet(dbBetId, { status: isWin ? 'won' : 'lost', result_value: resultMult, profit: profit, settled_at: new Date().toISOString() });
          await apiAddTransaction({ user_id: uid, type: isWin ? 'bet_credit' : 'bet_debit', direction: isWin ? 'credit' : 'debit', amount: isWin ? winAmount : currentBet, balance_after: postBalance, metadata: { note: `Limbo ${resultMult.toFixed(2)}× ${isWin ? '≥' : '<'} ${currentTarget}×` } });
        } catch (e) { console.error('DB limbo result sync failed:', e); }
      }

      if (isAuto) { setBetAmount(nextBet.toFixed(2)); betAmountRef.current = nextBet; }
      autoRolledRef.current += 1; setAutoRolled(prev => prev + 1);
    }, 400);
  };

  const toggleAuto = () => {
    if (autoBetRef.current) {
      autoBetRef.current = false; setAutoBet(false);
      clearInterval(autoTimerRef.current);
    } else {
      autoBetRef.current = true; setAutoBet(true);
      setAutoRolled(0); autoRolledRef.current = 0;
      const initialBet = betAmountRef.current;
      const syncedSettings = { ...autoSettingsRef.current, baseAmount: initialBet };
      autoSettingsRef.current = syncedSettings; setAutoSettings(syncedSettings);
      const initialStats = { wins: 0, losses: 0, currentBet: initialBet, totalProfit: 0, totalLoss: 0 };
      autoStatsRef.current = initialStats; setAutoStats(initialStats);
      setBetAmount(initialBet.toFixed(2));
      executePlay();
      autoTimerRef.current = setInterval(() => {
        const s = autoSettingsRef.current; const stats = autoStatsRef.current;
        if ((s.stopOnWin > 0 && stats.totalProfit >= s.stopOnWin) || (s.stopOnLoss > 0 && stats.totalLoss >= s.stopOnLoss)) {
          autoBetRef.current = false; setAutoBet(false); clearInterval(autoTimerRef.current); return;
        }
        if (autoRoundsRef.current > 0 && autoRolledRef.current >= autoRoundsRef.current) {
          autoBetRef.current = false; setAutoBet(false); clearInterval(autoTimerRef.current); return;
        }
        if (!playingRef.current) executePlay();
      }, 900);
    }
  };

  useEffect(() => { return () => clearInterval(autoTimerRef.current); }, []);

  const handlePlay = () => { if (playingRef.current) return; executePlay(); };
  const halfBet = () => setBetAmount(prev => parseFloat(Math.max(0.01, prev / 2).toFixed(2)));
  const doubleBet = () => setBetAmount(prev => { const doubled = prev * 2; const max = balanceRef.current; return parseFloat(Math.min(max, doubled).toFixed(2)); });
  const halfTarget = () => setTarget(prev => Math.max(1.01, parseFloat((prev / 2).toFixed(2))));
  const doubleTarget = () => setTarget(prev => Math.max(1.01, parseFloat((prev * 2).toFixed(2))));

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {history.map((h, i) => (
          <button key={i} className={`flex-shrink-0 px-2 py-1 rounded-lg text-xs font-orbitron font-bold transition-all hover:scale-105 ${h.isWin ? 'bg-green/20 text-green border border-green/30' : 'bg-red/20 text-red border border-red/30'}`}>{h.resultMult.toFixed(2)}×</button>
        ))}
      </div>
      <div className={`glass-card p-6 text-center ${showResult && result?.isWin ? 'win-flash' : showResult && !result?.isWin ? 'lose-flash' : ''}`}>
        <div className={`font-orbitron text-5xl font-bold mb-1 transition-all duration-300 ${playing ? 'scale-110 text-gold animate-pulse' : ''} ${showResult ? (result?.isWin ? 'text-green' : 'text-red') : 'text-gold'}`}>{playing ? '⏳' : showResult ? `${result?.resultMult.toFixed(2)}×` : '—'}</div>
      </div>
      <div className="glass-card p-3 grid grid-cols-2 gap-2 text-center">
        <div><div className="text-[9px] text-text-secondary">Win Chance</div><div className="font-orbitron text-sm text-cyan">{winChance.toFixed(2)}%</div></div>
        <div><div className="text-[9px] text-text-secondary">Potential Win</div><div className="font-orbitron text-sm text-green">{potentialWin} TMC</div></div>
      </div>
      <div className="glass-card p-2">
        <div className="text-[9px] text-text-secondary uppercase tracking-wider mb-1">Target Multiplier</div>
        <div className="flex items-center gap-1">
          <input type="text" inputMode="decimal" value={target} onChange={e => { const val = e.target.value; if (val === '' || val === '.') { setTarget(val); return; } const num = parseFloat(val); if (isNaN(num)) return; if (num < 1.01) { setTarget('1.01'); return; } setTarget(val); }} onBlur={e => { const val = e.target.value; if (val === '' || val === '.' || isNaN(parseFloat(val)) || parseFloat(val) < 1.01) setTarget('1.01'); }} className="w-full bg-transparent font-orbitron text-sm outline-none" />
          <div className="flex gap-0.5 flex-shrink-0">
            <button onClick={halfTarget} className="px-1.5 py-0.5 bg-surface rounded text-[9px] font-bold text-text-secondary hover:text-gold">1/2</button>
            <button onClick={doubleTarget} className="px-1.5 py-0.5 bg-surface rounded text-[9px] font-bold text-text-secondary hover:text-gold">2×</button>
          </div>
        </div>
      </div>
      <div className="flex gap-1 p-0.5 bg-surface rounded-lg">
        {['manual', 'auto'].map(tab => (
          <button key={tab} onClick={() => setControlTab(tab)} className={`flex-1 py-2 rounded-md text-xs font-bold font-sora transition-all ${controlTab === tab ? 'bg-gold/20 text-gold border border-gold/30' : 'text-text-secondary'}`}>
            {tab === 'manual' ? 'Manual' : <span className="flex items-center justify-center gap-1">Auto {autoBet && <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />}</span>}
          </button>
        ))}
      </div>
      <div className="glass-card p-2">
        <div className="text-[9px] text-text-secondary uppercase tracking-wider mb-1">Amount</div>
        <div className="flex items-center gap-1">
          <span className="text-gold text-xs">◎</span>
          <input type="text" inputMode="decimal" value={betAmount} onChange={e => { const val = e.target.value; if (val === '' || val === '.') { setBetAmount(val); return; } const num = parseFloat(val); if (isNaN(num)) return; if (num < 0.01) { setBetAmount('0.01'); return; } const max = balanceRef.current; if (num > max) { setBetAmount(parseFloat(max.toFixed(2))); return; } setBetAmount(parseFloat(num.toFixed(2))); }} onBlur={e => { const val = e.target.value; if (val === '' || val === '.' || isNaN(parseFloat(val)) || parseFloat(val) < 0.01) { setBetAmount('0.01'); return; } const max = balanceRef.current; const num = parseFloat(val); if (num > max) setBetAmount(parseFloat(max.toFixed(2))); }} className="flex-1 bg-transparent font-orbitron text-sm outline-none" />
          <div className="flex gap-0.5">
            <button onClick={halfBet} className="px-1.5 py-0.5 bg-surface rounded text-[9px] font-bold text-text-secondary hover:text-gold">1/2</button>
            <button onClick={doubleBet} className="px-1.5 py-0.5 bg-surface rounded text-[9px] font-bold text-text-secondary hover:text-gold">2×</button>
          </div>
        </div>
      </div>
      {controlTab === 'auto' && (
        <div className="space-y-2">
          <div className="glass-card p-2">
            <div className="text-[9px] text-text-secondary mb-1">Rounds</div>
            <div className="flex gap-1">
              <button onClick={() => setAutoRounds(0)} className={`flex-1 py-1.5 rounded text-xs font-bold ${autoRounds === 0 ? 'bg-cyan/20 text-cyan border border-cyan/30' : 'glass-card text-text-secondary'}`}><Infinity className="w-3 h-3 mx-auto" /></button>
              {[10, 50, 100].map(n => <button key={n} onClick={() => setAutoRounds(n)} className={`flex-1 py-1.5 rounded text-xs font-bold ${autoRounds === n ? 'bg-cyan/20 text-cyan border border-cyan/30' : 'glass-card text-text-secondary'}`}>{n}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="glass-card p-2">
              <div className="text-[9px] text-text-secondary mb-1">On Win</div>
              <div className="flex gap-1 mb-1">
                <button onClick={() => updateAutoSetting('onWin', 'action', 'reset')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoSettings.onWin.action === 'reset' ? 'bg-green/20 text-green border border-green/30' : 'glass-card text-text-secondary'}`}>Reset</button>
                <button onClick={() => updateAutoSetting('onWin', 'action', 'increase')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoSettings.onWin.action === 'increase' ? 'bg-gold/20 text-gold border border-gold/30' : 'glass-card text-text-secondary'}`}>Increase</button>
              </div>
              {autoSettings.onWin.action !== 'reset' && (
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-text-muted">by</span>
                  <input type="text" inputMode="decimal" value={autoSettings.onWin.value || ''} onChange={e => { const v = e.target.value; if (v === '' || v === '.') { updateAutoSetting('onWin', 'value', 0); return; } const n = parseFloat(v); if (!isNaN(n)) updateAutoSetting('onWin', 'value', n); }} onBlur={e => { const n = parseFloat(e.target.value); if (isNaN(n) || n < 0) updateAutoSetting('onWin', 'value', 0); }} className="w-full bg-surface rounded px-1 py-0.5 text-xs font-orbitron outline-none" />
                  <span className="text-[9px] text-text-muted">%</span>
                </div>
              )}
            </div>
            <div className="glass-card p-2">
              <div className="text-[9px] text-text-secondary mb-1">On Loss</div>
              <div className="flex gap-1 mb-1">
                <button onClick={() => updateAutoSetting('onLoss', 'action', 'reset')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoSettings.onLoss.action === 'reset' ? 'bg-green/20 text-green border border-green/30' : 'glass-card text-text-secondary'}`}>Reset</button>
                <button onClick={() => updateAutoSetting('onLoss', 'action', 'increase')} className={`flex-1 py-1 rounded text-[9px] font-bold ${autoSettings.onLoss.action === 'increase' ? 'bg-gold/20 text-gold border border-gold/30' : 'glass-card text-text-secondary'}`}>Increase</button>
              </div>
              {autoSettings.onLoss.action !== 'reset' && (
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-text-muted">by</span>
                  <input type="text" inputMode="decimal" value={autoSettings.onLoss.value || ''} onChange={e => { const v = e.target.value; if (v === '' || v === '.') { updateAutoSetting('onLoss', 'value', 0); return; } const n = parseFloat(v); if (!isNaN(n)) updateAutoSetting('onLoss', 'value', n); }} onBlur={e => { const n = parseFloat(e.target.value); if (isNaN(n) || n < 0) updateAutoSetting('onLoss', 'value', 0); }} className="w-full bg-surface rounded px-1 py-0.5 text-xs font-orbitron outline-none" />
                  <span className="text-[9px] text-text-muted">%</span>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="glass-card p-2"><div className="text-[9px] text-text-secondary mb-1">Stop on Profit</div><input type="text" inputMode="decimal" value={autoSettings.stopOnWin || ''} onChange={e => { const v = e.target.value; if (v === '' || v === '.') { setAutoSettings(prev => ({ ...prev, stopOnWin: 0 })); return; } const n = parseFloat(v); if (!isNaN(n)) setAutoSettings(prev => ({ ...prev, stopOnWin: n })); }} onBlur={e => { const n = parseFloat(e.target.value); if (isNaN(n) || n < 0) setAutoSettings(prev => ({ ...prev, stopOnWin: 0 })); }} className="w-full bg-surface rounded px-2 py-1 text-xs font-orbitron outline-none" placeholder="∞" /></div>
            <div className="glass-card p-2"><div className="text-[9px] text-text-secondary mb-1">Stop on Loss</div><input type="text" inputMode="decimal" value={autoSettings.stopOnLoss || ''} onChange={e => { const v = e.target.value; if (v === '' || v === '.') { setAutoSettings(prev => ({ ...prev, stopOnLoss: 0 })); return; } const n = parseFloat(v); if (!isNaN(n)) setAutoSettings(prev => ({ ...prev, stopOnLoss: n })); }} onBlur={e => { const n = parseFloat(e.target.value); if (isNaN(n) || n < 0) setAutoSettings(prev => ({ ...prev, stopOnLoss: 0 })); }} className="w-full bg-surface rounded px-2 py-1 text-xs font-orbitron outline-none" placeholder="∞" /></div>
          </div>
          <button onClick={toggleAuto} className={`w-full py-3.5 rounded-xl text-sm font-bold font-sora transition-all active:scale-95 ${autoBet ? 'bg-red/20 text-red border border-red/30' : 'bg-green hover:bg-green/80 text-[#050508]'}`}>{autoBet ? `STOP (${autoStats.wins}W/${autoStats.losses}L)` : 'START AUTO PLAY'}</button>
        </div>
      )}
      {controlTab === 'manual' && (
        <button onClick={handlePlay} disabled={playing || balanceRef.current < (parseFloat(betAmount) || 0.01)} className="w-full bg-green hover:bg-green/80 text-[#050508] py-3.5 rounded-xl text-sm font-bold font-sora transition-all active:scale-95 disabled:opacity-50">
          {playing ? 'PLAYING...' : balanceRef.current < (parseFloat(betAmount) || 0.01) ? 'INSUFFICIENT BALANCE' : `PLAY ${(parseFloat(betAmount) || 0.01).toFixed(2)} TMC`}
        </button>
      )}
    </div>
  );
}

function WalletTab({ user, setUser, transactions, addTransaction }) {
  const [swapDirection, setSwapDirection] = useState('buy');
  const [swapAmount, setSwapAmount] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const rate = 1000, fee = swapDirection === 'sell' ? 0.02 : 0;

  useEffect(() => {
    if (wallet?.account?.address) {
      setUser(prev => ({ ...prev, tonWalletAddress: wallet.account.address }));
    } else {
      setUser(prev => ({ ...prev, tonWalletAddress: null }));
    }
  }, [wallet, setUser]);

  const calculateReceive = () => {
    const amount = parseFloat(swapAmount) || 0;
    return swapDirection === 'buy' ? amount * rate : (amount * (1 - fee)) / rate;
  };

  const handleSwap = () => {
    if (!user.tonWalletAddress) { alert('Connect TON wallet first!'); return; }
    if (swapDirection === 'sell' && parseFloat(swapAmount) > user.tmcBalance) { alert('Insufficient TMC!'); return; }
    if (swapDirection === 'sell' && parseFloat(swapAmount) < 500) { alert('Min withdrawal: 500 TMC'); return; }
    setShowConfirm(true);
  };

  const confirmSwap = async () => {
    const amount = parseFloat(swapAmount), receive = calculateReceive();
    const newBalance = swapDirection === 'buy' ? user.tmcBalance + receive : user.tmcBalance - amount;

    if (swapDirection === 'buy') { 
      setUser(prev => ({ ...prev, tmcBalance: newBalance })); 
      addTransaction({ type: 'deposit', amount: receive, direction: 'credit', ton_amount: amount, note: 'TON → TMC' }); 
    } else { 
      setUser(prev => ({ ...prev, tmcBalance: newBalance })); 
      addTransaction({ type: 'withdrawal', amount, direction: 'debit', ton_amount: receive, note: 'TMC → TON (2% fee)' }); 
    }

    if (user.id && !String(user.id).startsWith('local-')) {
      try {
        await apiUpdateUser(user.id, { balance: newBalance });
        await apiAddTransaction({
          user_id: user.id, type: swapDirection === 'buy' ? 'deposit' : 'withdrawal',
          direction: swapDirection === 'buy' ? 'credit' : 'debit',
          amount: swapDirection === 'buy' ? receive : amount, balance_after: newBalance,
          metadata: { ton_amount: swapDirection === 'buy' ? amount : receive, note: swapDirection === 'buy' ? 'TON → TMC' : 'TMC → TON (2% fee)' }
        });
      } catch (e) { console.error('DB swap sync failed:', e); }
    }

    setSwapAmount(''); setShowConfirm(false);
  };

  const disconnectWallet = () => tonConnectUI.disconnect();
  const getTxIcon = (type) => type.includes('win') || type === 'bet_credit' || type === 'mining_passive' || type === 'mining_daily' || type === 'deposit' ? '✅' : type === 'withdrawal' ? '⏳' : '💥';
  const getTxColor = (type) => type.includes('win') || type === 'bet_credit' || type === 'mining_passive' || type === 'mining_daily' || type === 'deposit' ? 'text-green' : type === 'withdrawal' ? 'text-gold' : 'text-red';

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <span className="font-orbitron text-sm text-text-secondary">TON WALLET</span>
          {user.tonWalletAddress ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-cyan font-mono bg-cyan/10 px-2 py-1 rounded truncate max-w-[140px]">{user.tonWalletAddress.slice(0, 6)}...{user.tonWalletAddress.slice(-4)} ✓</span>
              <button onClick={disconnectWallet} className="btn-ghost px-2 py-1 text-[10px]">Disconnect</button>
            </div>
          ) : (
            <button onClick={() => tonConnectUI.openModal()} className="btn-gold px-3 py-1.5 text-xs">Connect TON</button>
          )}
        </div>
        <div className="text-center py-4">
          <div className="font-orbitron text-3xl font-bold text-gold">{formatTMC(user.tmcBalance)}</div>
          <div className="text-xs text-text-secondary mt-1">≈ {formatTON(user.tmcBalance / rate)} TON</div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <div className="text-center"><div className="text-[10px] text-text-secondary">MINED</div><div className="font-orbitron text-xs text-cyan">{formatTMC(user.totalMined)}</div></div>
          <div className="text-center"><div className="text-[10px] text-text-secondary">WON</div><div className="font-orbitron text-xs text-green">{formatTMC(user.totalWon)}</div></div>
          <div className="text-center"><div className="text-[10px] text-text-secondary">DEPOSIT</div><div className="font-orbitron text-xs text-gold">0.00</div></div>
        </div>
      </div>
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-orbitron text-sm text-text-secondary">SWAP</span>
          <div className="flex gap-1 bg-surface rounded-lg p-0.5">
            <button onClick={() => setSwapDirection('buy')} className={`px-3 py-1 rounded text-xs font-bold ${swapDirection === 'buy' ? 'bg-gold/20 text-gold' : 'text-text-secondary'}`}>BUY</button>
            <button onClick={() => setSwapDirection('sell')} className={`px-3 py-1 rounded text-xs font-bold ${swapDirection === 'sell' ? 'bg-red/20 text-red' : 'text-text-secondary'}`}>SELL</button>
          </div>
        </div>
        <div className="glass-card p-3 mb-2">
          <div className="text-[10px] text-text-secondary mb-1">YOU SEND</div>
          <div className="flex items-center justify-between">
            <input type="number" value={swapAmount} onChange={e => setSwapAmount(e.target.value)} placeholder="0.00" className="bg-transparent font-orbitron text-xl outline-none w-32" />
            <span className="font-bold text-sm">{swapDirection === 'buy' ? 'TON' : 'TMC'}</span>
          </div>
          <div className="text-[10px] text-text-muted mt-1">Balance: {swapDirection === 'buy' ? '3.45 TON' : `${formatTMC(user.tmcBalance)} TMC`}</div>
        </div>
        <div className="flex justify-center -my-2 relative z-10">
          <button onClick={() => setSwapDirection(s => s === 'buy' ? 'sell' : 'buy')} className="bg-[#050508] border border-border rounded-full p-1.5 hover:border-gold/50 transition-colors"><ArrowUpDown className="w-4 h-4 text-gold" /></button>
        </div>
        <div className="glass-card p-3 mt-2">
          <div className="text-[10px] text-text-secondary mb-1">YOU RECEIVE</div>
          <div className="font-orbitron text-xl text-gold">{formatTMC(calculateReceive())}</div>
          <div className="text-[10px] text-text-muted mt-1">1 TON = 1,000 TMC {swapDirection === 'sell' && '(2% fee)'}</div>
        </div>
        <button onClick={handleSwap} className="w-full btn-gold py-3 mt-3 text-sm">CONFIRM SWAP → {swapDirection === 'buy' ? 'BUY TMC' : 'WITHDRAW'}</button>
      </div>
      <div className="space-y-2">
        <h3 className="font-orbitron text-xs text-text-secondary uppercase tracking-wider px-1">Recent Transactions</h3>
        {transactions.map(tx => (
          <div key={tx.id} className="glass-card p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{getTxIcon(tx.type)}</span>
              <div><div className="text-xs font-sora font-medium capitalize">{tx.type.replace(/_/g, ' ')}</div><div className="text-[10px] text-text-muted">{tx.note}</div></div>
            </div>
            <div className={`font-orbitron text-sm font-bold ${getTxColor(tx.type)}`}>{tx.direction === 'credit' ? '+' : '-'}{formatTMC(tx.amount)}</div>
          </div>
        ))}
      </div>
      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-card p-6 w-full max-w-sm">
            <div className="flex items-center gap-2 text-gold mb-4"><AlertTriangle className="w-5 h-5" /><span className="font-orbitron font-bold">Confirm {swapDirection === 'buy' ? 'Purchase' : 'Withdrawal'}</span></div>
            <p className="text-sm text-text-secondary mb-4">Are you sure? This cannot be undone.</p>
            <div className="glass-card p-3 mb-4 text-center"><div className="text-xs text-text-secondary">You will receive</div><div className="font-orbitron text-xl text-gold">{formatTMC(calculateReceive())} TMC</div></div>
            <div className="flex gap-2"><button onClick={() => setShowConfirm(false)} className="flex-1 btn-ghost py-3 text-sm">Cancel</button><button onClick={confirmSwap} className="flex-1 btn-gold py-3 text-sm">Confirm</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function RanksTab({ user }) {
  const [rankTab, setRankTab] = useState('miners');
  const [leaders, setLeaders] = useState({ miners: [], bettors: [], winners: [] });
  const [loading, setLoading] = useState(true);
  const [referralStats, setReferralStats] = useState([]);
  const [copied, setCopied] = useState(false);

  const referralLink = `https://t.me/TonMineBot?start=${user.referralCode}`;
  const miniAppLink = `https://t.me/TonMineBot/app?startapp=${user.referralCode}`;

  useEffect(() => {
    async function loadLeaderboard() {
      try {
        const [miners, bettors, winners] = await Promise.all([
          apiGetLeaderboard('miners', 50),
          apiGetLeaderboard('bettors', 50),
          apiGetLeaderboard('winners', 50)
        ]);
        setLeaders({ miners, bettors, winners });
      } catch (e) { console.error('Leaderboard load failed:', e); }
      finally { setLoading(false); }
    }
    loadLeaderboard();
  }, []);

  useEffect(() => {
    async function loadReferrals() {
      if (!user?.id || String(user.id).startsWith('local-')) return;
      try {
        const data = await apiGetReferralStats(user.id);
        setReferralStats(data);
      } catch (e) { console.error('Referral load failed:', e); }
    }
    loadReferrals();
  }, [user?.id]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = referralLink;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = () => {
    const tg = window.Telegram?.WebApp;
    const shareText = `🚀 Join me on TONMINE — the ultimate mining & casino game on TON!\n\nUse my link to get started and earn together:\n${referralLink}`;
    if (tg) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`);
    } else {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`, '_blank');
    }
  };

  const getLeagueFromMined = (mined) => {
    if (mined >= 1000000) return { name: 'Legend', icon: '👑', color: '#C084FC' };
    if (mined >= 100000) return { name: 'Diamond', icon: '💎', color: '#00E5FF' };
    if (mined >= 10000) return { name: 'Gold', icon: '🥇', color: '#FFB800' };
    if (mined >= 1000) return { name: 'Silver', icon: '🥈', color: '#94A3B8' };
    return { name: 'Bronze', icon: '🥉', color: '#CD7F32' };
  };

  const getLeagueIcon = (league) => ({ 'Legend': '👑', 'Diamond': '💎', 'Gold': '🥇', 'Silver': '🥈', 'Bronze': '🥉' }[league] || '🥉');
  const getLeagueColor = (league) => ({ 'Legend': '#C084FC', 'Diamond': '#00E5FF', 'Gold': '#FFB800', 'Silver': '#94A3B8', 'Bronze': '#CD7F32' }[league] || '#CD7F32');

  const tier1Count = referralStats.filter(r => r.tier === 1).length;
  const tier2Count = referralStats.filter(r => r.tier === 2).length;
  const tier3Count = referralStats.filter(r => r.tier === 3).length;
  const totalEarned = referralStats.reduce((sum, r) => sum + (parseFloat(r.total_earned) || 0), 0);

  const currentLeaders = leaders[rankTab] || [];
  const scoreField = rankTab === 'miners' ? 'total_mined_ever' : rankTab === 'bettors' ? 'total_wagered' : 'total_won';

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Referral Card */}
      <div className="glass-card-gold p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-gold" />
          <span className="font-orbitron text-sm text-gold">Referral Program</span>
        </div>

        <div className="glass-card p-2 flex items-center gap-2 mb-3">
          <code className="text-xs text-cyan flex-1 truncate">{referralLink}</code>
          <button onClick={handleCopy} className="p-1.5 hover:bg-white/5 rounded transition-colors relative">
            <Copy className="w-4 h-4 text-text-secondary" />
            {copied && <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] text-green bg-green/10 px-1.5 py-0.5 rounded whitespace-nowrap">Copied!</span>}
          </button>
          <button onClick={handleShare} className="p-1.5 hover:bg-white/5 rounded transition-colors">
            <Share2 className="w-4 h-4 text-text-secondary" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="glass-card p-2 text-center">
            <div className="text-[10px] text-text-secondary">Total Earned</div>
            <div className="font-orbitron text-sm text-gold">+{formatTMC(totalEarned)} TMC</div>
          </div>
          <div className="glass-card p-2 text-center">
            <div className="text-[10px] text-text-secondary">Total Friends</div>
            <div className="font-orbitron text-sm text-cyan">{referralStats.length}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="glass-card p-2 text-center">
            <div className="text-[9px] text-text-secondary">Tier 1</div>
            <div className="font-orbitron text-xs text-gold">{tier1Count}</div>
            <div className="text-[9px] text-gold/70">25%</div>
          </div>
          <div className="glass-card p-2 text-center">
            <div className="text-[9px] text-text-secondary">Tier 2</div>
            <div className="font-orbitron text-xs text-cyan">{tier2Count}</div>
            <div className="text-[9px] text-cyan/70">10%</div>
          </div>
          <div className="glass-card p-2 text-center">
            <div className="text-[9px] text-text-secondary">Tier 3</div>
            <div className="font-orbitron text-xs text-purple">{tier3Count}</div>
            <div className="text-[9px] text-purple/70">5%</div>
          </div>
        </div>

        <div className="text-[10px] text-text-muted text-center">
          Share your link. Earn when friends mine & play. Up to 3 levels deep.
        </div>
      </div>

      {/* Referral Friends List */}
      {referralStats.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-orbitron text-xs text-text-secondary uppercase tracking-wider px-1">Your Friends</h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {referralStats.map((ref, i) => (
              <div key={ref.id || i} className="glass-card p-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold font-orbitron px-1.5 py-0.5 rounded bg-surface text-text-secondary">T{ref.tier}</span>
                  <span className="text-xs font-sora text-text-secondary">{ref.referred?.username || 'Anonymous'}</span>
                </div>
                <div className="font-orbitron text-xs text-gold">+{formatTMC(parseFloat(ref.total_earned) || 0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div className="space-y-2">
        <div className="flex gap-1 p-1 bg-surface rounded-xl">
          {[{ id: 'miners', label: 'Top Miners', icon: '⛏️' }, { id: 'bettors', label: 'Top Bettors', icon: '🎰' }, { id: 'winners', label: 'Top Winners', icon: '🏆' }].map(tab => (
            <button key={tab.id} onClick={() => setRankTab(tab.id)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${rankTab === tab.id ? 'bg-gold/20 text-gold border border-gold/30' : 'text-text-secondary'}`}><span className="mr-1">{tab.icon}</span>{tab.label}</button>
          ))}
        </div>

        {loading && <div className="text-center text-xs text-text-muted py-4">Loading leaderboard...</div>}

        <div className="space-y-2">
          {currentLeaders.map((leader, i) => {
            const league = getLeagueFromMined(parseFloat(leader.total_mined_ever) || 0);
            const score = parseFloat(leader[scoreField]) || 0;
            return (
              <div key={leader.id || i} className={`glass-card p-3 flex items-center justify-between ${leader.username === user.username ? 'border-gold/30 bg-gold/5' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-orbitron ${i === 0 ? 'bg-gold/20 text-gold' : i === 1 ? 'bg-gray-400/20 text-gray-300' : i === 2 ? 'bg-orange-700/20 text-orange-400' : 'text-text-muted'}`}>{i + 1}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{getLeagueIcon(league.name)}</span>
                    <div>
                      <div className="text-sm font-sora font-medium">{leader.username}</div>
                      <div className="text-[10px]" style={{ color: getLeagueColor(league.name) }}>{league.name}</div>
                    </div>
                  </div>
                </div>
                <div className="font-orbitron text-sm text-gold">{formatTMC(score)}</div>
              </div>
            );
          })}
        </div>

        <div className="glass-card-gold p-3 flex items-center justify-between sticky bottom-2">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-gold/20 text-gold flex items-center justify-center text-xs font-bold font-orbitron">?</div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🥉</span>
              <div>
                <div className="text-sm font-sora font-medium text-gold">{user.username} (You)</div>
                <div className="text-[10px] text-text-secondary">Bronze</div>
              </div>
            </div>
          </div>
          <div className="font-orbitron text-sm text-gold">{formatTMC(user.totalMined)}</div>
        </div>
      </div>
    </div>
  );
}