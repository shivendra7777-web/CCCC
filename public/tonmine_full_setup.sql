-- ============================================
-- TONMINE: FULL RESET + REBUILD + TEST DATA
-- Run this single script to wipe everything and start fresh
-- ============================================

-- ============================================
-- STEP 1: DROP EVERYTHING (if exists)
-- ============================================
DROP TABLE IF EXISTS leaderboard_snapshots CASCADE;
DROP TABLE IF EXISTS wallet_links CASCADE;
DROP TABLE IF EXISTS referrals CASCADE;
DROP TABLE IF EXISTS mining_taps CASCADE;
DROP TABLE IF EXISTS bets CASCADE;
DROP TABLE IF EXISTS game_rounds CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS tx_direction CASCADE;
DROP TYPE IF EXISTS tx_type CASCADE;
DROP TYPE IF EXISTS game_type CASCADE;
DROP TYPE IF EXISTS bet_status CASCADE;
DROP TYPE IF EXISTS dice_direction CASCADE;
DROP TYPE IF EXISTS tap_type CASCADE;
DROP TYPE IF EXISTS leaderboard_category CASCADE;

DROP FUNCTION IF EXISTS check_self_referral() CASCADE;

-- ============================================
-- STEP 2: CREATE CUSTOM TYPES
-- ============================================
CREATE TYPE tx_direction AS ENUM ('credit', 'debit');

CREATE TYPE tx_type AS ENUM (
    'mining_passive',
    'mining_daily',
    'mining_tap',
    'bet_debit',
    'bet_credit',
    'crash_cashout',
    'deposit',
    'withdrawal',
    'referral_tier1',
    'referral_tier2',
    'referral_tier3',
    'upgrade_unlock'
);

CREATE TYPE game_type AS ENUM ('crash', 'dice', 'limbo');
CREATE TYPE bet_status AS ENUM ('pending', 'active', 'cashed_out', 'won', 'lost');
CREATE TYPE dice_direction AS ENUM ('over', 'under');
CREATE TYPE tap_type AS ENUM ('daily_24h', 'passive_claim');
CREATE TYPE leaderboard_category AS ENUM ('miners', 'bettors', 'winners');

-- ============================================
-- STEP 3: CREATE TABLES
-- ============================================

-- 3.1 USERS
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id         BIGINT NOT NULL UNIQUE,
    username            VARCHAR(32),
    first_name          VARCHAR(64),
    last_name           VARCHAR(64),
    photo_url           TEXT,
    referral_code       VARCHAR(16) UNIQUE NOT NULL,
    referred_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    mining_rate         DECIMAL(12,4) NOT NULL DEFAULT 0.5,
    mining_level        INT NOT NULL DEFAULT 1,
    total_mined         DECIMAL(18,4) NOT NULL DEFAULT 0,
    total_mined_ever    DECIMAL(18,4) NOT NULL DEFAULT 0,
    total_wagered       DECIMAL(18,4) NOT NULL DEFAULT 0,
    total_won           DECIMAL(18,4) NOT NULL DEFAULT 0,
    total_lost          DECIMAL(18,4) NOT NULL DEFAULT 0,
    balance             DECIMAL(18,4) NOT NULL DEFAULT 0,
    energy              INT NOT NULL DEFAULT 100,
    max_energy          INT NOT NULL DEFAULT 100,
    last_energy_regen   TIMESTAMPTZ DEFAULT NOW(),
    claim_streak        INT NOT NULL DEFAULT 0,
    last_claim_at       TIMESTAMPTZ,
    last_daily_tap_at   TIMESTAMPTZ,
    ton_wallet_address  VARCHAR(66),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    last_active_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_referred_by ON users(referred_by);
CREATE INDEX idx_users_ton_wallet ON users(ton_wallet_address) WHERE ton_wallet_address IS NOT NULL;

-- 3.2 TRANSACTIONS
CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                tx_type NOT NULL,
    direction           tx_direction NOT NULL,
    amount              DECIMAL(18,4) NOT NULL,
    balance_after       DECIMAL(18,4) NOT NULL,
    bet_id              UUID,
    game_round_id       UUID,
    referral_from_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id, created_at DESC);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);

-- 3.3 GAME ROUNDS
CREATE TABLE game_rounds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_type           game_type NOT NULL,
    round_number        INT NOT NULL,
    server_seed_hash    VARCHAR(64) NOT NULL,
    server_seed         VARCHAR(64),
    client_seed         VARCHAR(64) NOT NULL DEFAULT '0000000000000000',
    nonce               INT NOT NULL DEFAULT 0,
    result_value        DECIMAL(18,4),
    crash_point         DECIMAL(18,4),
    status              VARCHAR(16) NOT NULL DEFAULT 'betting',
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_game_rounds_game_type ON game_rounds(game_type, round_number DESC);
CREATE INDEX idx_game_rounds_status ON game_rounds(status) WHERE status IN ('betting', 'flying');

-- 3.4 BETS
CREATE TABLE bets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_round_id       UUID REFERENCES game_rounds(id) ON DELETE SET NULL,
    amount              DECIMAL(18,4) NOT NULL,
    auto_cashout        DECIMAL(18,4),
    target_value        DECIMAL(18,4),
    dice_direction      dice_direction,
    cashed_out_at       DECIMAL(18,4),
    result_value        DECIMAL(18,4),
    status              bet_status NOT NULL DEFAULT 'pending',
    profit              DECIMAL(18,4) NOT NULL DEFAULT 0,
    placed_at           TIMESTAMPTZ DEFAULT NOW(),
    settled_at          TIMESTAMPTZ,
    is_auto_bet         BOOLEAN NOT NULL DEFAULT FALSE,
    auto_bet_round      INT
);

CREATE INDEX idx_bets_user_id ON bets(user_id, placed_at DESC);
CREATE INDEX idx_bets_game_round ON bets(game_round_id);
CREATE INDEX idx_bets_status ON bets(status) WHERE status = 'active';

-- 3.5 MINING TAPS
CREATE TABLE mining_taps (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tap_type            tap_type NOT NULL,
    amount_earned       DECIMAL(18,4) NOT NULL,
    streak_day          INT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mining_taps_user_id ON mining_taps(user_id, created_at DESC);

-- 3.6 REFERRALS (FIXED: composite unique key)
CREATE TABLE referrals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier                INT NOT NULL CHECK (tier BETWEEN 1 AND 3),
    total_earned        DECIMAL(18,4) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(referrer_id, referred_id)
);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id, tier);
CREATE INDEX idx_referrals_referred ON referrals(referred_id);

-- 3.7 WALLET LINKS
CREATE TABLE wallet_links (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    ton_address         VARCHAR(66) NOT NULL,
    ton_raw_address     VARCHAR(66),
    connected_at        TIMESTAMPTZ DEFAULT NOW(),
    last_verified_at    TIMESTAMPTZ,
    total_deposited     DECIMAL(18,4) NOT NULL DEFAULT 0,
    total_withdrawn     DECIMAL(18,4) NOT NULL DEFAULT 0
);

CREATE INDEX idx_wallet_links_address ON wallet_links(ton_address);

-- 3.8 LEADERBOARD SNAPSHOTS
CREATE TABLE leaderboard_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category            leaderboard_category NOT NULL,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rank                INT NOT NULL,
    score               DECIMAL(18,4) NOT NULL,
    snapshot_date       DATE NOT NULL,
    UNIQUE(category, user_id, snapshot_date)
);

CREATE INDEX idx_leaderboard_category ON leaderboard_snapshots(category, snapshot_date, rank);

-- ============================================
-- STEP 4: CONSTRAINTS & TRIGGERS
-- ============================================
ALTER TABLE users ADD CONSTRAINT check_balance_positive CHECK (balance >= 0);

CREATE OR REPLACE FUNCTION check_self_referral()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.referred_by = NEW.id THEN
        RAISE EXCEPTION 'Cannot refer yourself';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_self_referral
    BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION check_self_referral();

-- ============================================
-- STEP 5: ROW LEVEL SECURITY
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mining_taps ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own data" ON users FOR SELECT USING (true);
CREATE POLICY "Users read own transactions" ON transactions FOR SELECT USING (true);
CREATE POLICY "Users read own bets" ON bets FOR SELECT USING (true);

-- ============================================
-- STEP 6: INSERT TEST DATA
-- ============================================

-- 6.1 USERS
INSERT INTO users (telegram_id, username, first_name, referral_code, balance, mining_rate, mining_level, total_mined, total_mined_ever, total_wagered, total_won, total_lost, energy, claim_streak, ton_wallet_address) VALUES
(100001, 'CryptoKing', 'Crypto', 'KING001', 50000.00, 10.0, 5, 450000.00, 450000.00, 2500000.00, 890000.00, 120000.00, 100, 15, 'EQA1...King'),
(100002, 'TonWhale', 'Whale', 'WHALE02', 25000.00, 5.0, 4, 234000.00, 234000.00, 1200000.00, 450000.00, 80000.00, 100, 12, 'EQB2...Whale'),
(100003, 'MinerPro', 'Pro', 'PRO0003', 8000.00, 2.5, 3, 89000.00, 89000.00, 450000.00, 230000.00, 45000.00, 100, 8, 'EQC3...Pro'),
(100004, 'Satoshi', 'Sat', 'SATO004', 5000.00, 2.5, 3, 45000.00, 45000.00, 230000.00, 120000.00, 30000.00, 100, 6, NULL),
(100005, 'BlockDigger', 'Block', 'DIG005', 2000.00, 1.0, 2, 12000.00, 12000.00, 89000.00, 45000.00, 15000.00, 100, 4, NULL),
(100006, 'Newbie', 'New', 'NEWB006', 500.00, 0.5, 1, 500.00, 500.00, 5000.00, 2000.00, 3000.00, 100, 1, NULL),
(100007, 'LuckyStrike', 'Lucky', 'LUCK007', 15000.00, 2.5, 3, 67000.00, 67000.00, 890000.00, 890000.00, 20000.00, 100, 10, 'EQD7...Lucky'),
(100008, 'HighRoller', 'Roller', 'HIGH008', 30000.00, 5.0, 4, 120000.00, 120000.00, 2500000.00, 1200000.00, 50000.00, 100, 20, 'EQE8...Roller'),
(100009, 'CasinoPro', 'Casino', 'CAS009', 12000.00, 2.5, 3, 89000.00, 89000.00, 1200000.00, 670000.00, 35000.00, 100, 14, NULL),
(100010, 'RiskTaker', 'Risk', 'RISK010', 3000.00, 1.0, 2, 12000.00, 12000.00, 120000.00, 89000.00, 12000.00, 100, 5, NULL);

-- 6.2 UPDATE referred_by (UUIDs now exist)
UPDATE users SET referred_by = (SELECT id FROM users WHERE telegram_id = 100001) WHERE telegram_id = 100007;
UPDATE users SET referred_by = (SELECT id FROM users WHERE telegram_id = 100001) WHERE telegram_id = 100008;
UPDATE users SET referred_by = (SELECT id FROM users WHERE telegram_id = 100002) WHERE telegram_id = 100009;
UPDATE users SET referred_by = (SELECT id FROM users WHERE telegram_id = 100003) WHERE telegram_id = 100010;

-- 6.3 REFERRALS
INSERT INTO referrals (referrer_id, referred_id, tier, total_earned) VALUES
((SELECT id FROM users WHERE telegram_id = 100001), (SELECT id FROM users WHERE telegram_id = 100007), 1, 250.00),
((SELECT id FROM users WHERE telegram_id = 100001), (SELECT id FROM users WHERE telegram_id = 100008), 1, 500.00),
((SELECT id FROM users WHERE telegram_id = 100002), (SELECT id FROM users WHERE telegram_id = 100009), 1, 300.00),
((SELECT id FROM users WHERE telegram_id = 100003), (SELECT id FROM users WHERE telegram_id = 100010), 1, 150.00),
((SELECT id FROM users WHERE telegram_id = 100007), (SELECT id FROM users WHERE telegram_id = 100009), 2, 50.00),
((SELECT id FROM users WHERE telegram_id = 100001), (SELECT id FROM users WHERE telegram_id = 100010), 3, 25.00);

-- 6.4 GAME ROUNDS
INSERT INTO game_rounds (game_type, round_number, server_seed_hash, server_seed, result_value, crash_point, status, started_at, ended_at) VALUES
('crash', 1, 'a3f8c2d1...', 'secret1', 2.45, 2.45, 'crashed', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours' + INTERVAL '5 seconds'),
('crash', 2, 'b7e9a4f2...', 'secret2', 1.12, 1.12, 'crashed', NOW() - INTERVAL '1 hour 55 min', NOW() - INTERVAL '1 hour 55 min' + INTERVAL '2 seconds'),
('crash', 3, 'c1d0b5e8...', 'secret3', 5.67, 5.67, 'crashed', NOW() - INTERVAL '1 hour 50 min', NOW() - INTERVAL '1 hour 50 min' + INTERVAL '12 seconds'),
('crash', 4, 'd2e1c6f9...', 'secret4', 1.89, 1.89, 'crashed', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes' + INTERVAL '4 seconds'),
('crash', 5, 'e3f2d7a0...', NULL, NULL, NULL, 'betting', NOW(), NULL),
('dice', 1, 'hash_dice_1', 'secret_d1', 43.50, NULL, 'complete', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes'),
('dice', 2, 'hash_dice_2', 'secret_d2', 67.20, NULL, 'complete', NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '25 minutes'),
('dice', 3, 'hash_dice_3', NULL, NULL, NULL, 'betting', NOW(), NULL),
('limbo', 1, 'hash_limbo_1', 'secret_l1', 3.45, NULL, 'complete', NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '15 minutes'),
('limbo', 2, 'hash_limbo_2', 'secret_l2', 0.85, NULL, 'complete', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes'),
('limbo', 3, 'hash_limbo_3', NULL, NULL, NULL, 'betting', NOW(), NULL);

-- 6.5 BETS
INSERT INTO bets (user_id, game_round_id, amount, auto_cashout, target_value, dice_direction, cashed_out_at, result_value, status, profit, is_auto_bet) VALUES
((SELECT id FROM users WHERE telegram_id = 100001), (SELECT id FROM game_rounds WHERE round_number = 1 AND game_type = 'crash'), 100, 2.50, NULL, NULL, 2.45, 2.45, 'cashed_out', 145.00, FALSE),
((SELECT id FROM users WHERE telegram_id = 100002), (SELECT id FROM game_rounds WHERE round_number = 1 AND game_type = 'crash'), 50, 1.50, NULL, NULL, NULL, 2.45, 'won', 72.50, FALSE),
((SELECT id FROM users WHERE telegram_id = 100003), (SELECT id FROM game_rounds WHERE round_number = 2 AND game_type = 'crash'), 200, 3.00, NULL, NULL, NULL, 1.12, 'lost', -200.00, FALSE),
((SELECT id FROM users WHERE telegram_id = 100007), (SELECT id FROM game_rounds WHERE round_number = 3 AND game_type = 'crash'), 500, 5.00, NULL, NULL, 5.67, 5.67, 'cashed_out', 2335.00, FALSE),
((SELECT id FROM users WHERE telegram_id = 100008), (SELECT id FROM game_rounds WHERE round_number = 4 AND game_type = 'crash'), 1000, 2.00, NULL, NULL, 1.89, 1.89, 'cashed_out', 890.00, FALSE),
((SELECT id FROM users WHERE telegram_id = 100001), (SELECT id FROM game_rounds WHERE round_number = 1 AND game_type = 'dice'), 50, NULL, 50.00, 'over', NULL, 43.50, 'lost', -50.00, FALSE),
((SELECT id FROM users WHERE telegram_id = 100002), (SELECT id FROM game_rounds WHERE round_number = 2 AND game_type = 'dice'), 100, NULL, 60.00, 'under', NULL, 67.20, 'lost', -100.00, FALSE),
((SELECT id FROM users WHERE telegram_id = 100007), (SELECT id FROM game_rounds WHERE round_number = 1 AND game_type = 'dice'), 200, NULL, 40.00, 'over', NULL, 43.50, 'won', 396.00, FALSE),
((SELECT id FROM users WHERE telegram_id = 100003), (SELECT id FROM game_rounds WHERE round_number = 1 AND game_type = 'limbo'), 100, NULL, 2.00, NULL, NULL, 3.45, 'won', 200.00, FALSE),
((SELECT id FROM users WHERE telegram_id = 100009), (SELECT id FROM game_rounds WHERE round_number = 2 AND game_type = 'limbo'), 500, NULL, 1.50, NULL, NULL, 0.85, 'lost', -500.00, FALSE),
((SELECT id FROM users WHERE telegram_id = 100010), (SELECT id FROM game_rounds WHERE round_number = 1 AND game_type = 'limbo'), 50, NULL, 5.00, NULL, NULL, 3.45, 'lost', -50.00, FALSE);

-- 6.6 TRANSACTIONS
INSERT INTO transactions (user_id, type, direction, amount, balance_after, bet_id, metadata) VALUES
((SELECT id FROM users WHERE telegram_id = 100001), 'deposit', 'credit', 10000.00, 10000.00, NULL, '{"ton_amount": 10.0, "note": "Initial deposit"}'),
((SELECT id FROM users WHERE telegram_id = 100001), 'mining_passive', 'credit', 1250.00, 11250.00, NULL, '{"note": "Passive mining 7 days"}'),
((SELECT id FROM users WHERE telegram_id = 100001), 'bet_debit', 'debit', 100.00, 11150.00, (SELECT id FROM bets WHERE amount = 100 AND status = 'cashed_out' LIMIT 1), '{"note": "Crash bet round 1"}'),
((SELECT id FROM users WHERE telegram_id = 100001), 'crash_cashout', 'credit', 245.00, 11395.00, (SELECT id FROM bets WHERE amount = 100 AND status = 'cashed_out' LIMIT 1), '{"multiplier": 2.45, "note": "Cashed @ 2.45x"}'),
((SELECT id FROM users WHERE telegram_id = 100001), 'referral_tier1', 'credit', 250.00, 11645.00, NULL, '{"from_user": "LuckyStrike", "percentage": 25}'),
((SELECT id FROM users WHERE telegram_id = 100001), 'referral_tier1', 'credit', 500.00, 12145.00, NULL, '{"from_user": "HighRoller", "percentage": 25}'),
((SELECT id FROM users WHERE telegram_id = 100001), 'referral_tier3', 'credit', 25.00, 12170.00, NULL, '{"from_user": "RiskTaker", "percentage": 5}'),
((SELECT id FROM users WHERE telegram_id = 100002), 'deposit', 'credit', 5000.00, 5000.00, NULL, '{"ton_amount": 5.0}'),
((SELECT id FROM users WHERE telegram_id = 100002), 'mining_passive', 'credit', 600.00, 5600.00, NULL, '{"note": "Passive mining"}'),
((SELECT id FROM users WHERE telegram_id = 100002), 'bet_debit', 'debit', 50.00, 5550.00, NULL, '{"note": "Crash bet"}'),
((SELECT id FROM users WHERE telegram_id = 100002), 'bet_credit', 'credit', 122.50, 5672.50, NULL, '{"note": "Crash win"}'),
((SELECT id FROM users WHERE telegram_id = 100002), 'referral_tier1', 'credit', 300.00, 5972.50, NULL, '{"from_user": "CasinoPro", "percentage": 25}'),
((SELECT id FROM users WHERE telegram_id = 100007), 'deposit', 'credit', 2000.00, 2000.00, NULL, '{}'),
((SELECT id FROM users WHERE telegram_id = 100007), 'mining_passive', 'credit', 800.00, 2800.00, NULL, '{}'),
((SELECT id FROM users WHERE telegram_id = 100007), 'crash_cashout', 'credit', 2835.00, 5635.00, NULL, '{"multiplier": 5.67, "note": "Cashed @ 5.67x"}'),
((SELECT id FROM users WHERE telegram_id = 100007), 'bet_credit', 'credit', 396.00, 6031.00, NULL, '{"note": "Dice win"}'),
((SELECT id FROM users WHERE telegram_id = 100006), 'mining_daily', 'credit', 12.00, 12.00, NULL, '{"streak": 1, "note": "Day 1 claim"}'),
((SELECT id FROM users WHERE telegram_id = 100006), 'mining_passive', 'credit', 5.50, 17.50, NULL, '{"note": "Passive"}'),
((SELECT id FROM users WHERE telegram_id = 100006), 'bet_debit', 'debit', 10.00, 7.50, NULL, '{"note": "First bet"}'),
((SELECT id FROM users WHERE telegram_id = 100006), 'bet_debit', 'debit', 5.00, 2.50, NULL, '{"note": "Lost on crash"}');

-- 6.7 MINING TAPS
INSERT INTO mining_taps (user_id, tap_type, amount_earned, streak_day) VALUES
((SELECT id FROM users WHERE telegram_id = 100001), 'daily_24h', 240.00, 15),
((SELECT id FROM users WHERE telegram_id = 100002), 'daily_24h', 120.00, 12),
((SELECT id FROM users WHERE telegram_id = 100003), 'daily_24h', 60.00, 8),
((SELECT id FROM users WHERE telegram_id = 100001), 'passive_claim', 15.00, NULL),
((SELECT id FROM users WHERE telegram_id = 100002), 'passive_claim', 7.50, NULL),
((SELECT id FROM users WHERE telegram_id = 100006), 'daily_24h', 12.00, 1),
((SELECT id FROM users WHERE telegram_id = 100006), 'passive_claim', 0.50, NULL);

-- 6.8 WALLET LINKS
INSERT INTO wallet_links (user_id, ton_address, total_deposited, total_withdrawn) VALUES
((SELECT id FROM users WHERE telegram_id = 100001), 'EQA1...King', 10000.00, 0),
((SELECT id FROM users WHERE telegram_id = 100002), 'EQB2...Whale', 5000.00, 0),
((SELECT id FROM users WHERE telegram_id = 100007), 'EQD7...Lucky', 2000.00, 0),
((SELECT id FROM users WHERE telegram_id = 100008), 'EQE8...Roller', 8000.00, 2000.00);

-- 6.9 LEADERBOARD SNAPSHOTS
INSERT INTO leaderboard_snapshots (category, user_id, rank, score, snapshot_date) VALUES
('miners', (SELECT id FROM users WHERE telegram_id = 100001), 1, 450000.00, CURRENT_DATE),
('miners', (SELECT id FROM users WHERE telegram_id = 100002), 2, 234000.00, CURRENT_DATE),
('miners', (SELECT id FROM users WHERE telegram_id = 100003), 3, 89000.00, CURRENT_DATE),
('miners', (SELECT id FROM users WHERE telegram_id = 100004), 4, 45000.00, CURRENT_DATE),
('miners', (SELECT id FROM users WHERE telegram_id = 100007), 5, 67000.00, CURRENT_DATE),
('bettors', (SELECT id FROM users WHERE telegram_id = 100008), 1, 2500000.00, CURRENT_DATE),
('bettors', (SELECT id FROM users WHERE telegram_id = 100001), 2, 2500000.00, CURRENT_DATE),
('bettors', (SELECT id FROM users WHERE telegram_id = 100009), 3, 1200000.00, CURRENT_DATE),
('bettors', (SELECT id FROM users WHERE telegram_id = 100002), 4, 1200000.00, CURRENT_DATE),
('bettors', (SELECT id FROM users WHERE telegram_id = 100007), 5, 890000.00, CURRENT_DATE),
('winners', (SELECT id FROM users WHERE telegram_id = 100007), 1, 890000.00, CURRENT_DATE),
('winners', (SELECT id FROM users WHERE telegram_id = 100001), 2, 890000.00, CURRENT_DATE),
('winners', (SELECT id FROM users WHERE telegram_id = 100008), 3, 1200000.00, CURRENT_DATE),
('winners', (SELECT id FROM users WHERE telegram_id = 100002), 4, 450000.00, CURRENT_DATE),
('winners', (SELECT id FROM users WHERE telegram_id = 100003), 5, 230000.00, CURRENT_DATE);

-- ============================================
-- DONE! Everything is ready.
-- ============================================

-- Quick verification queries (uncomment to run):
-- SELECT username, balance, mining_rate FROM users ORDER BY balance DESC;
-- SELECT u.username, r.tier, r.total_earned FROM referrals r JOIN users u ON r.referred_id = u.id ORDER BY r.tier;
-- SELECT * FROM transactions WHERE user_id = (SELECT id FROM users WHERE telegram_id = 100001);
