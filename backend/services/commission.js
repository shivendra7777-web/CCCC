import { supabase } from './supabase.js';

const TIER_RATES = { 1: 0.25, 2: 0.10, 3: 0.05 };

export async function payReferralCommissions(userId, activityType, amount) {
  // activityType: 'mining' | 'betting'
  // amount: the gross amount the user earned/spent

  try {
    // Get the user's referral chain
    const { data: user } = await supabase
      .from('users')
      .select('referred_by')
      .eq('id', userId)
      .single();

    if (!user?.referred_by) return; // No referrer

    // Build chain: user -> tier1 -> tier2 -> tier3
    const chain = [];
    let currentId = user.referred_by;
    let tier = 1;

    while (currentId && tier <= 3) {
      const { data: referrer } = await supabase
        .from('users')
        .select('id, balance, total_mined, referral_code, referred_by')
        .eq('id', currentId)
        .single();

      if (!referrer) break;

      chain.push({ id: referrer.id, tier, balance: referrer.balance, referred_by: referrer.referred_by });
      currentId = referrer.referred_by;
      tier++;
    }

    // Pay each tier
    for (const ref of chain) {
      const rate = TIER_RATES[ref.tier];
      const commission = parseFloat((amount * rate).toFixed(4));
      if (commission <= 0) continue;

      const newBalance = parseFloat((ref.balance + commission).toFixed(4));

      // Update referrer balance
      await supabase
        .from('users')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('id', ref.id);

      // Update referrals.total_earned
      await supabase
        .from('referrals')
        .update({ total_earned: supabase.rpc('increment', { x: commission }) }) // or fetch+update
        .eq('referrer_id', ref.id)
        .eq('referred_id', userId);

      // Log transaction
      await supabase.from('transactions').insert({
        user_id: ref.id,
        type: `referral_tier${ref.tier}`,
        direction: 'credit',
        amount: commission,
        balance_after: newBalance,
        referral_from_id: userId,
        metadata: { 
          note: `Tier ${ref.tier} commission from ${activityType}`,
          percentage: rate * 100,
          source_amount: amount
        }
      });
    }
  } catch (e) {
    console.error('Commission payout failed:', e);
  }
}

// Alternative: fetch+update pattern for total_earned (since RPC might not exist)
export async function updateReferralEarnings(referrerId, referredId, amount) {
  const { data: ref } = await supabase
    .from('referrals')
    .select('total_earned')
    .eq('referrer_id', referrerId)
    .eq('referred_id', referredId)
    .single();

  if (ref) {
    const newEarned = parseFloat((parseFloat(ref.total_earned) + amount).toFixed(4));
    await supabase
      .from('referrals')
      .update({ total_earned: newEarned })
      .eq('referrer_id', referrerId)
      .eq('referred_id', referredId);
  }
}
