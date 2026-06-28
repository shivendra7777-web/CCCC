import { Router } from 'express';
import { supabase } from '../services/supabase.js';
import { payReferralCommissions } from '../services/commission.js';

const router = Router();

router.post('/tap', async (req, res) => {
  const { userId } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    const lastTap = user.last_daily_tap_at ? new Date(user.last_daily_tap_at) : new Date(0);
    const hoursSince = (now - lastTap) / 3600000;

    if (hoursSince < 24) {
      return res.status(400).json({ error: 'Tap not ready', nextTapIn: 24 - hoursSince });
    }

    const reward = parseFloat((user.mining_rate * 24).toFixed(4));
    const newBalance = parseFloat((user.balance + reward).toFixed(4));
    const newMined = parseFloat((user.total_mined + reward).toFixed(4));
    const newMinedEver = parseFloat((user.total_mined_ever + reward).toFixed(4));

    await supabase.from('users').update({
      balance: newBalance, total_mined: newMined,
      total_mined_ever: newMinedEver,
      last_daily_tap_at: now.toISOString()
    }).eq('id', userId);

    await supabase.from('mining_taps').insert({
      user_id: userId, tap_type: 'daily_24h',
      amount_earned: reward, streak_day: user.claim_streak || 1
    });

    await supabase.from('transactions').insert({
      user_id: userId, type: 'mining_daily',
      direction: 'credit', amount: reward,
      balance_after: newBalance,
      metadata: { note: 'Daily mining tap', reward }
    });

    // Pay referral commissions on mining
    await payReferralCommissions(userId, 'mining', reward);

    res.json({ reward, balance: newBalance, totalMined: newMined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/claim', async (req, res) => {
  const { userId } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    const lastClaim = user.last_claim_at ? new Date(user.last_claim_at) : new Date(0);
    const hoursSince = (now - lastClaim) / 3600000;

    if (hoursSince < 20) {
      return res.status(400).json({ error: 'Claim not ready' });
    }

    const streak = hoursSince > 48 ? 1 : (user.claim_streak || 0) + 1;
    const mult = streak >= 30 ? 10 : streak >= 7 ? 3 : 1;
    const reward = parseFloat((user.mining_rate * 24 * mult).toFixed(4));
    const newBalance = parseFloat((user.balance + reward).toFixed(4));
    const newMined = parseFloat((user.total_mined + reward).toFixed(4));
    const newMinedEver = parseFloat((user.total_mined_ever + reward).toFixed(4));

    await supabase.from('users').update({
      balance: newBalance, total_mined: newMined,
      total_mined_ever: newMinedEver,
      claim_streak: streak, last_claim_at: now.toISOString()
    }).eq('id', userId);

    await supabase.from('mining_taps').insert({
      user_id: userId, tap_type: 'passive_claim',
      amount_earned: reward, streak_day: streak
    });

    await supabase.from('transactions').insert({
      user_id: userId, type: 'mining_daily',
      direction: 'credit', amount: reward,
      balance_after: newBalance,
      metadata: { note: `Day ${streak} streak claim`, streak, multiplier: mult }
    });

    await payReferralCommissions(userId, 'mining', reward);

    res.json({ reward, streak, balance: newBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
