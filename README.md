# ViralKing AI

Turn ideas, product photos and existing videos into branded social content.

## Stack
- Next.js (App Router) on Vercel
- Supabase: auth, Postgres (row-level security per user), private `media` storage bucket
- AI (coming in step 2): self-hosted open-weight models on rented GPUs

## Run locally
```bash
cp .env.example .env.local
npm install
npm run dev
```

Database schema lives in `supabase/migrations/`.
