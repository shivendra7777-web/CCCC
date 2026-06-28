import { Router } from 'express';
import { supabase } from '../services/supabase.js';

const router = Router();

router.get('/stats/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const { data, error } = await supabase
      .from('referrals')
      .select('*, referred:users!referred_id(username, total_mined_ever, mining_level)')
      .eq('referrer_id', userId);

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/leaderboard/:category', async (req, res) => {
  const { category } = req.params;
  let orderField = 'total_mined_ever';
  if (category === 'bettors') orderField = 'total_wagered';
  if (category === 'winners') orderField = 'total_won';

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, username, total_mined_ever, total_wagered, total_won, mining_level, referral_code')
      .order(orderField, { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
