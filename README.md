# Burwain membership app

Membership, renewals, payments, finance and email for the club. Built on Supabase.

- Spec: [Membership App spec](https://claude.ai/artifact/HdjVuJm3X2TirunfGKSbos)
- Database design: [docs/database.md](docs/database.md)
- App: [web/](web/) (Next.js). Copy `web/.env.example` to `web/.env.local`, then `npm install` and `npm run dev`.
- Tests run on GitHub for every pull request: database rules (`supabase/tests`) and the web app (lint, types, build, smoke tests).
