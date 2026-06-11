# PokéValue Scanner — PRD

## Overview
A mobile app for Pokémon TCG collectors to scan raw cards using the phone camera, recognize them with AI vision, grade their condition, and look up the live market value (TCGplayer + Cardmarket).

## Stack
- **Frontend:** Expo Router (React Native) — Firebase Web SDK auth
- **Backend:** FastAPI + MongoDB
- **AI:** Gemini 2.5 Flash via Emergent Universal Key (vision)
- **Pricing:** pokemontcg.io public API
- **Monetization:** Mock paywall (10 free scans → upgrade screen); ready to swap for RevenueCat in production builds

## Screens
1. **Auth** — Firebase email/password login + signup
2. **Dashboard (tabs/dashboard)** — Portfolio total + 2-column card grid
3. **Scan (tabs/scan)** — Full-bleed camera, framing brackets, laser sweep animation, scan counter pill
4. **Condition (modal)** — Per-aspect segmented controls + whitening/scratches toggles → grade summary
5. **Card Detail (modal)** — Hero card image, condition grade, estimated raw value, TCGplayer + Cardmarket prices
6. **Upgrade (tabs/upgrade)** — Pro plans (mock checkout, flips `is_pro` server-side)
7. **Paywall (modal)** — Shown when free quota exhausted

## Key Decisions
- **MOCKED:** Pro subscription — toggles `is_pro` in MongoDB, no real billing (RevenueCat will replace in production build)
- Free tier hard-capped at **10 scans / user**; counter is server-authoritative (`/api/scan/count`)
- AI vision returns JSON `{name, set, number}` enforced via system prompt
- Condition multiplier formula in `src/grading.ts` — averages 4 aspects, deducts for whitening/scratches
- Estimated value = `market_price × condition_multiplier`

## API Endpoints (`/api`)
- `POST /scan/analyze` → Gemini vision identification
- `GET /price` → pokemontcg.io lookup
- `POST /portfolio/save`, `GET /portfolio/{user_id}`, `DELETE /portfolio/{card_id}`
- `GET /scan/count/{user_id}`, `POST /scan/count/{user_id}`, `POST /scan/upgrade/{user_id}`

## Smart Business Enhancement (Conversion)
Server-side scan counter with a Pro upgrade screen positioned as a dedicated tab — every dashboard glance reminds free users of their remaining quota, lifting paid conversion vs. a hidden settings entry.
