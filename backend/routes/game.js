import { Router } from 'express';
import { supabase } from '../services/supabase.js';
import { generateDiceRoll, generateLimboResult } from '../services/gameEngine.js';
import { payReferralCommissions } from '../services/commission.js';

const router = Router();

// ========== DICE ==========
router.post('/dice/roll', async (req, res) => {
  const { userId, amount, target, direction } = req.body;

  try {
    // 1. Instant game ke liye ek round banao
    let { data: activeRound } = await supabase.from('game_rounds')
      .select('id').eq('game_type', 'dice').eq('status', 'betting').single();
    
    if (!activeRound) {
      const { data: newRound } = await supabase.from('game_rounds').insert({
        game_type: 'dice', round_number: 1, server_seed_hash: 'dice_' + Date.now(),
        status: 'complete', started_at: new Date().toISOString(), ended_at: new Date().toISOString()
      }).select().single();
      activeRound = newRound;
    }

    // 2. Place Bet Securely (Wager track hoga, balance katega)
    const { data: betId, error: betError } = await supabase.rpc('place_bet_securely', {
      p_user_id: userId, p_game_round_id: activeRound.id, p_amount: amount,
      p_auto_cashout: null, p_target_value: target, p_dice_direction: direction
    });

    if (betError) return res.status(400).json({ error: betError.message });

    // 3. Generate Result & Calculate Win/Loss
    const roll = generateDiceRoll();
    const winChance = Math.max(0.01, direction === 'over' ? 100 - target : target - 1);
    const multiplier = parseFloat((99 / winChance).toFixed(2));
    const isWin = direction === 'over' ? roll > target : roll < target;
    const profit = isWin ? parseFloat((amount * multiplier - amount).toFixed(4)) : 0;

    // 4. Settle Bet Securely (Profit add hoga, total_won/lost update hoga)
    await supabase.rpc('settle_instant_bet', {
      p_bet_id: betId, p_is_win: isWin, p_profit_amount: profit, p_result_value: roll
    });

    // 5. Fetch final balance & Pay commissions
    const { data: user } = await supabase.from('users').select('balance').eq('id', userId).single();
    if (isWin && profit > 0) await payReferralCommissions(userId, 'betting', profit);

    res.json({ roll, isWin, winAmount: isWin ? amount * multiplier : 0, multiplier, profit: isWin ? profit : -amount, balance: user.balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== LIMBO ==========
router.post('/limbo/play', async (req, res) => {
  const { userId, amount, target } = req.body;

  try {
    // 1. Instant game ke liye ek round banao
    let { data: activeRound } = await supabase.from('game_rounds')
      .select('id').eq('game_type', 'limbo').eq('status', 'betting').single();
    
    if (!activeRound) {
      const { data: newRound } = await supabase.from('game_rounds').insert({
        game_type: 'limbo', round_number: 1, server_seed_hash: 'limbo_' + Date.now(),
        status: 'complete', started_at: new Date().toISOString(), ended_at: new Date().toISOString()
      }).select().single();
      activeRound = newRound;
    }

    // 2. Place Bet Securely
    const { data: betId, error: betError } = await supabase.rpc('place_bet_securely', {
      p_user_id: userId, p_game_round_id: activeRound.id, p_amount: amount,
      p_auto_cashout: null, p_target_value: target, p_dice_direction: null
    });

    if (betError) return res.status(400).json({ error: betError.message });

    // 3. Generate Result & Calculate Win/Loss
    const resultMult = generateLimboResult();
    const isWin = resultMult >= target;
    const profit = isWin ? parseFloat((amount * target - amount).toFixed(4)) : 0;

    // 4. Settle Bet Securely
    await supabase.rpc('settle_instant_bet', {
      p_bet_id: betId, p_is_win: isWin, p_profit_amount: profit, p_result_value: resultMult
    });

    // 5. Fetch final balance & Pay commissions
    const { data: user } = await supabase.from('users').select('balance').eq('id', userId).single();
    if (isWin && profit > 0) await payReferralCommissions(userId, 'betting', profit);

    res.json({ resultMult, isWin, winAmount: isWin ? amount * target : 0, profit: isWin ? profit : -amount, balance: user.balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;