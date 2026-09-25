# **Last update:** 25/09/2026

Public portfolio clone of the private original repo [`Fantasy-Futebol`](https://github.com/FranciscoSimas/Fantasy-Futebol). Same codebase snapshot, no git history.

# ⚽ Predz

**Guess. Compete. Win.**

Web app for football predictions among friends. Create or join tournaments tied to real competitions, make score picks, and climb the ranking.

The product brand is **Predz**. The original private GitHub repo is still named `Fantasy-Futebol`.

## 📖 About

I started from a private World Cup prediction site I built with friends, then turned it into a real product: own domain, paid football API, email setup, automated match sync and a full web app. Predz is paused for now (I want it ready before big seasons), but the codebase and infra are live and I plan to continue later (including a Play Store app).

Login and data live on Supabase. Production runs on Vercel at [predz.app](https://predz.app). Football data is synced with a Go program on GitHub Actions.

## ✨ Main Features

- 🔐 Auth (email/password + Google, confirm and password reset)
- 🏆 Create and join tournaments (public or private with invite code)
- 🎯 Match predictions shared across tournaments of the same competition
- 📊 Live ranking and scoring (result and exact score)
- ⭐ Special bets (champion, top scorer, and related modules)
- 👀 Spectator mode (watch without predicting)
- ⏱️ Knockout extra time / penalties support (matchday UI)
- 🛠️ Platform admin tools (including manual match overrides)
- 🌍 Portuguese and English
- 📱 Mobile first layout
- 📧 Support inbox wired to professional email (Resend)

## 🛠️ Technologies Used

### Frontend
- TanStack Start + TanStack Router
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- shadcn/ui
- TanStack Query
- React Hook Form + Zod

### Backend and data
- Supabase (Auth, PostgreSQL, RLS, Realtime)
- SQL migrations and RPCs for scoring, locks and leaderboards

### Sync and automation
- Go sync service (`sync/`)
- GitHub Actions (daily import + matchday dispatch)
- Supabase `pg_cron` orchestrator (poll only when matches are live)

### Hosting and email
- Vercel (`predz.app` production, `dev` branch for testing)
- Resend (auth mail + inbound support)

## 📁 Project Structure

```
Predz-P/
├── public/                 # Brand assets, robots, sitemap
├── src/
│   ├── components/         # UI and feature components
│   ├── hooks/
│   ├── integrations/       # Supabase clients
│   ├── lib/                # Scoring, i18n, helpers
│   └── routes/             # TanStack file routes (app + auth + API)
├── supabase/migrations/    # Schema, RLS, orchestrator, scoring
├── sync/                   # Go football data sync
├── .github/workflows/      # Sync CI and scheduled jobs
├── .env.example
└── package.json
```

## 🔄 Football sync (high level)

| Job | What it does |
|---|---|
| Daily | Teams, fixtures, squads, top scorers |
| Matchday | Updates live scores only when something changed |
| Go CI | Tests the sync package on push |

Main provider: API-Football. Optional legacy: football-data.org.

## 📌 Current status

Usable soft launch / beta level. Core product works (auth, tournaments, picks, ranking, sync). Paused before wider marketing. Next ideas: more competitions, knockout bracket UI, Capacitor Android app.

## 🤝 Contributing

This is a personal product. Suggestions are welcome, but I am not looking for active contributors right now.

## 📄 License

Personal and educational use of the code in this repo. Football data and club brands belong to their owners. Predz is an independent project.

## 🔗 Links

- **Live app:** https://predz.app
- **This public clone:** https://github.com/FranciscoSimas/Predz-P
- **Private original:** https://github.com/FranciscoSimas/Fantasy-Futebol
- **Portuguese README:** [README_PT.md](README_PT.md)
