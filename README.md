# TonMine Frontend

Telegram Mini App — Pi-Style Mining + Crypto Casino on TON Blockchain

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start dev server
npm run dev

# 3. Open http://localhost:3000 in your browser
```

## Project Structure

```
tonmine-frontend/
├── index.html              # Entry HTML with Google Fonts
├── package.json            # Dependencies
├── vite.config.js          # Vite config
├── tailwind.config.js      # Tailwind with custom theme
├── postcss.config.js       # PostCSS setup
└── src/
    ├── main.jsx            # React entry point
    ├── index.css           # Global styles + animations
    └── App.jsx             # Complete app (all components)
```

## Features Included

- **Mine Tab** — Animated mining orb, energy system, daily bonus, upgrades, leagues
- **Casino Tab** — Crash (always-running), Dice, Limbo games
- **Wallet Tab** — TON↔TMC swap, transaction history, mock TON Connect
- **Ranks Tab** — Leaderboards + 3-tier referral system
- **Design** — Glass morphism, Orbitron/Sora fonts, gold/cyan accents, all animations

## Fixes Applied (v1.1)

1. **Scroll & Overflow** — Body now uses `overflow-auto`, main content scrolls properly both vertically and horizontally when needed
2. **Centered Controls** — Manual/Auto/Advanced tabs are now properly centered with equal spacing
3. **Screenshot Button** — Camera icon button on the crash chart to capture and download game results (BC.Game style)
4. **Auto-Bet Settings** — Full BC.Game style: On Win (Reset/Increase by %), On Loss (Reset/Increase by %), Stop on Win, Stop on Loss
5. **Responsive Layout** — History row and round bets are scrollable, no content gets cut off

## Tech Stack

- React 18 + Vite
- Tailwind CSS
- Lucide React (icons)
- No external image dependencies (emoji + SVG only)

## Notes

- This is a frontend prototype with client-side state (localStorage)
- Backend integration (Node.js + Express + Supabase + Socket.io) coming next
- TON Connect 2.0 and Telegram Web App auth will be added in backend phase
