import { Router } from 'express';
import { supabase } from '../services/supabase.js';
import { generateCrashPoint, generateDiceRoll, generateLimboResult } from '../services/gameEngine.js';
import { payReferralCommissions, updateReferralEarnings } from '../services/commission.js';

const router = Router();

// ========== CRASH GAME ==========
const crashGames = new Map(); // roomId -> game state

router.post('/crash/bet', async (req, res) => {
  const { userId, amount, autoCashout } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('balance, total_wagered').eq('id', userId).single();
    if (!user || user.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const newBalance = parseFloat((user.balance - amount).toFixed(4));
    const newWagered = parseFloat((user.total_wagered + amount).toFixed(4));

    await supabase.from('users').update({ balance: newBalance, total_wagered: newWagered }).eq('id', userId);

    const { data: bet } = await supabase.from('bets').insert({
      user_id: userId,
      amount,
      auto_cashout: autoCashout || null,
      status: 'active',
      placed_at: new Date().toISOString()
    }).select().single();

    await supabase.from('transactions').insert({
      user_id: userId,
      type: 'bet_debit',
      direction: 'debit',
      amount,
      balance_after: newBalance,
      bet_id: bet.id,
      metadata: { note: 'Crash bet' }
    });

    res.json({ betId: bet.id, balance: newBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/crash/cashout', async (req, res) => {
  const { userId, betId, multiplier } = req.body;

  try {
    const { data: bet } = await supabase.from('bets').select('amount, status').eq('id', betId).eq('user_id', userId).single();
    if (!bet || bet.status !== 'active') {
      return res.status(400).json({ error: 'Bet not active' });
    }

    const winAmount = parseFloat((bet.amount * multiplier).toFixed(4));
    const profit = parseFloat((winAmount - bet.amount).toFixed(4));

    const { data: user } = await supabase.from('users').select('balance, total_won').eq('id', userId).single();
    const newBalance = parseFloat((user.balance + winAmount).toFixed(4));
    const newWon = parseFloat((user.total_won + profit).toFixed(4));

    await supabase.from('users').update({ balance: newBalance, total_won: newWon }).eq('id', userId);
    await supabase.from('bets').update({ status: 'cashed_out', cashed_out_at: multiplier, profit, settled_at: new Date().toISOString() }).eq('id', betId);

    await supabase.from('transactions').insert({
      user_id: userId,
      type: 'crash_cashout',
      direction: 'credit',
      amount: winAmount,
      balance_after: newBalance,
      bet_id: betId,
      metadata: { note: `Cashed @ ${multiplier.toFixed(2)}×`, multiplier }
    });

    // Pay referral commissions on the profit
    await payReferralCommissions(userId, 'betting', profit);

    res.json({ winAmount, profit, balance: newBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/crash/crash', async (req, res) => {
  const { betId, crashPoint } = req.body;

  try {
    const { data: bet } = await supabase.from('bets').select('user_id, amount').eq('id', betId).single();
    if (!bet) return res.status(404).json({ error: 'Bet not found' });

    const { data: user } = await supabase.from('users').select('total_lost').eq('id', bet.user_id).single();
    const newLost = parseFloat((user.total_lost + bet.amount).toFixed(4));

    await supabase.from('users').update({ total_lost: newLost }).eq('id', bet.user_id);
    await supabase.from('bets').update({ status: 'lost', result_value: crashPoint, profit: -bet.amount, settled_at: new Date().toISOString() }).eq('id', betId);

    await supabase.from('transactions').insert({
      user_id: bet.user_id,
      type: 'bet_debit',
      direction: 'debit',
      amount: bet.amount,
      balance_after: user.balance || 0,
      bet_id: betId,
      metadata: { note: `Crashed @ ${crashPoint.toFixed(2)}×`, crash_point: crashPoint }
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== DICE ==========
router.post('/dice/roll', async (req, res) => {
  const { userId, amount, target, direction } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('balance, total_wagered, total_won, total_lost').eq('id', userId).single();
    if (!user || user.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const newBalance = parseFloat((user.balance - amount).toFixed(4));
    const newWagered = parseFloat((user.total_wagered + amount).toFixed(4));

    const roll = generateDiceRoll();
    const winChance = Math.max(0.01, direction === 'over' ? 100 - target : target - 1);
    const multiplier = parseFloat((99 / winChance).toFixed(2));
    const isWin = direction === 'over' ? roll > target : roll < target;
    const winAmount = isWin ? parseFloat((amount * multiplier).toFixed(4)) : 0;
    const profit = isWin ? parseFloat((winAmount - amount).toFixed(4)) : -amount;

    const postBalance = isWin ? parseFloat((newBalance + winAmount).toFixed(4)) : newBalance;
    const newWon = isWin ? parseFloat((user.total_won + profit).toFixed(4)) : user.total_won;
    const newLost = isWin ? user.total_lost : parseFloat((user.total_lost + amount).toFixed(4));

    await supabase.from('users').update({
      balance: postBalance, total_wagered: newWagered,
      total_won: newWon, total_lost: newLost
    }).eq('id', userId);

    const { data: bet } = await supabase.from('bets').insert({
      user_id: userId, amount, target_value: target,
      dice_direction: direction, result_value: roll,
      status: isWin ? 'won' : 'lost', profit,
      placed_at: new Date().toISOString(),
      settled_at: new Date().toISOString()
    }).select().single();

    await supabase.from('transactions').insert({
      user_id: userId,
      type: isWin ? 'bet_credit' : 'bet_debit',
      direction: isWin ? 'credit' : 'debit',
      amount: isWin ? winAmount : amount,
      balance_after: postBalance,
      bet_id: bet.id,
      metadata: { note: `Dice ${roll} ${direction} ${target} @ ${multiplier}×`, roll, target, direction, multiplier }
    });

    if (isWin && profit > 0) {
      await payReferralCommissions(userId, 'betting', profit);
    }

    res.json({ roll, isWin, winAmount, multiplier, profit, balance: postBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== LIMBO ==========
router.post('/limbo/play', async (req, res) => {
  const { userId, amount, target } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('balance, total_wagered, total_won, total_lost').eq('id', userId).single();
    if (!user || user.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const newBalance = parseFloat((user.balance - amount).toFixed(4));
    const newWagered = parseFloat((user.total_wagered + amount).toFixed(4));

    const resultMult = generateLimboResult();
    const isWin = resultMult >= target;
    const winAmount = isWin ? parseFloat((amount * target).toFixed(4)) : 0;
    const profit = isWin ? parseFloat((winAmount - amount).toFixed(4)) : -amount;

    const postBalance = isWin ? parseFloat((newBalance + winAmount).toFixed(4)) : newBalance;
    const newWon = isWin ? parseFloat((user.total_won + profit).toFixed(4)) : user.total_won;
    const newLost = isWin ? user.total_lost : parseFloat((user.total_lost + amount).toFixed(4));

    await supabase.from('users').update({
      balance: postBalance, total_wagered: newWagered,
      total_won: newWon, total_lost: newLost
    }).eq('id', userId);

    const { data: bet } = await supabase.from('bets').insert({
      user_id: userId, amount, target_value: target,
      result_value: resultMult, status: isWin ? 'won' : 'lost',
      profit, placed_at: new Date().toISOString(),
      settled_at: new Date().toISOString()
    }).select().single();

    await supabase.from('transactions').insert({
      user_id: userId,
      type: isWin ? 'bet_credit' : 'bet_debit',
      direction: isWin ? 'credit' : 'debit',
      amount: isWin ? winAmount : amount,
      balance_after: postBalance,
      bet_id: bet.id,
      metadata: { note: `Limbo ${resultMult.toFixed(2)}× ${isWin ? '≥' : '<'} ${target}×`, result_mult: resultMult, target }
    });

    if (isWin && profit > 0) {
      await payReferralCommissions(userId, 'betting', profit);
    }

    res.json({ resultMult, isWin, winAmount, profit, balance: postBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
