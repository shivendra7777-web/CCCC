import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://localhost:3001/api';
const SUPABASE_URL = 'https://vrreeybsuhucjtgduiuw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZycmVleWJzdWh1Y2p0Z2R1aXV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0Mjc2MzEsImV4cCI6MjA5NzAwMzYzMX0.6C4BTHhF_eG20N5T6lXYql_zyG9T11EBQ_b4s_rybJQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

async function apiCall(endpoint, options = {}) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ========== BACKEND API ==========
export async function loginUser(payload) {
  return apiCall('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
}

export async function tapMine(userId) {
  return apiCall('/mining/tap', { method: 'POST', body: JSON.stringify({ userId }) });
}

export async function claimDaily(userId) {
  return apiCall('/mining/claim', { method: 'POST', body: JSON.stringify({ userId }) });
}

export async function rollDice(userId, amount, target, direction) {
  return apiCall('/game/dice/roll', { method: 'POST', body: JSON.stringify({ userId, amount, target, direction }) });
}

export async function playLimbo(userId, amount, target) {
  return apiCall('/game/limbo/play', { method: 'POST', body: JSON.stringify({ userId, amount, target }) });
}

// ========== SUPABASE (for direct DB ops App.jsx still uses) ==========
export async function updateUser(userId, updates) {
  const { error } = await supabase.from('users').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', userId);
  if (error) throw error;
}

export async function addTransaction(txData) {
  const { data, error } = await supabase.from('transactions').insert([txData]).select().single();
  if (error) throw error;
  return data;
}

export async function placeBet(betData) {
  const { data, error } = await supabase.from('bets').insert([betData]).select().single();
  if (error) throw error;
  return data;
}

export async function updateBet(betId, updates) {
  const { error } = await supabase.from('bets').update(updates).eq('id', betId);
  if (error) throw error;
}

export async function addMiningTap(tapData) {
  const { data, error } = await supabase.from('mining_taps').insert([tapData]).select().single();
  if (error) throw error;
  return data;
}

export async function getLeaderboard(category, limit = 50) {
  return apiCall(`/referrals/leaderboard/${category}`);
}

export async function getReferralStats(userId) {
  return apiCall(`/referrals/stats/${userId}`);
}

export async function getUserByReferralCode(code) {
  const { data, error } = await supabase.from('users').select('id, username, referral_code, total_mined_ever').eq('referral_code', code).single();
  if (error) throw error;
  return data;
}

export async function createUserWithReferral(userData, referrerCode) {
  return apiCall('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      telegramId: userData.telegram_id,
      referralCode: referrerCode,
      username: userData.username,
      firstName: userData.first_name
    })
  });
}

export async function createUser(userData) {
  return apiCall('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      telegramId: userData.telegram_id,
      username: userData.username,
      firstName: userData.first_name
    })
  });
}