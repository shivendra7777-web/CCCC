import { Router } from 'express';
import { supabase } from '../services/supabase.js';

const router = Router();

// Mock auth for local development
// In production: verify Telegram initData HMAC signature
router.post('/login', async (req, res) => {
  const { telegramId, referralCode, username, firstName } = req.body;

  if (!telegramId) {
    return res.status(400).json({ error: 'telegramId required' });
  }

  try {
    // Check if user exists
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return res.status(500).json({ error: error.message });
    }

    if (user) {
      // Update last_active_at
      await supabase
        .from('users')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', user.id);

      return res.json({ user, isNew: false });
    }

    // Create new user
    const newUserData = {
      telegram_id: telegramId,
      username: username || 'TonMiner',
      first_name: firstName || 'Player',
      referral_code: generateRefCode(),
      balance: 0,
      mining_rate: 0.5,
      mining_level: 1,
      total_mined: 0,
      total_mined_ever: 0,
      total_wagered: 0,
      total_won: 0,
      total_lost: 0,
      energy: 100,
      max_energy: 100,
    };

    let newUser;

    if (referralCode) {
      // Find referrer
      const { data: referrer } = await supabase
        .from('users')
        .select('id, referred_by')
        .eq('referral_code', referralCode)
        .single();

      if (referrer) {
        newUserData.referred_by = referrer.id;

        const { data: created, error: createErr } = await supabase
          .from('users')
          .insert([newUserData])
          .select()
          .single();

        if (createErr) throw createErr;
        newUser = created;

        // Create tier 1 referral
        await supabase.from('referrals').insert({
          referrer_id: referrer.id,
          referred_id: newUser.id,
          tier: 1,
          total_earned: 0
        });

        // Tier 2
        if (referrer.referred_by) {
          await supabase.from('referrals').insert({
            referrer_id: referrer.referred_by,
            referred_id: newUser.id,
            tier: 2,
            total_earned: 0
          });

          // Tier 3
          const { data: tier2 } = await supabase
            .from('users')
            .select('referred_by')
            .eq('id', referrer.referred_by)
            .single();

          if (tier2?.referred_by) {
            await supabase.from('referrals').insert({
              referrer_id: tier2.referred_by,
              referred_id: newUser.id,
              tier: 3,
              total_earned: 0
            });
          }
        }
      } else {
        // Invalid referral code, create without
        const { data: created, error: createErr } = await supabase
          .from('users')
          .insert([newUserData])
          .select()
          .single();
        if (createErr) throw createErr;
        newUser = created;
      }
    } else {
      const { data: created, error: createErr } = await supabase
        .from('users')
        .insert([newUserData])
        .select()
        .single();
      if (createErr) throw createErr;
      newUser = created;
    }

    res.json({ user: newUser, isNew: true });
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).json({ error: e.message });
  }
});

function generateRefCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

export default router;
