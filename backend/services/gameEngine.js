// Fair game outcome generation (server-side only)
// House edge: 1% on all games

export function generateCrashPoint() {
  const float = Math.random();
  if (float < 0.01) return 1.00; // 1% instant crash
  return Math.max(1.01, parseFloat((0.99 / (1 - float)).toFixed(2)));
}

export function generateDiceRoll() {
  return parseFloat((Math.random() * 100).toFixed(2));
}

export function generateLimboResult() {
  const float = Math.random();
  if (float < 0.01) return 1.00;
  return Math.max(1.01, parseFloat((0.99 / (1 - float)).toFixed(2)));
}

// Provably fair: hash-based (future upgrade)
export function hashServerSeed(seed) {
  // Placeholder for HMAC-SHA256 based provably fair
  return seed;
}
