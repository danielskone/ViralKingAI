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

## AI generation (self-hosted, open models)
The GPU worker in `worker/modal_app.py` runs on [Modal](https://modal.com) and uses:
- **Qwen2.5-7B-Instruct** (Apache 2.0) to write the hook, scenes and call to action
- **Wan 2.2 TI2V-5B** (Apache 2.0) for image-to-video and text-to-video clips (~5 s, 24 fps)

Setup:
```bash
pip install modal && modal setup
modal secret create viralking-secrets \
  SUPABASE_URL=https://zlpzfavcieiyfitviaoe.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service role key> \
  WORKER_SHARED_SECRET=<long random string>
modal deploy worker/modal_app.py
```
Then set `WORKER_SUBMIT_URL` (the `submit` endpoint URL Modal prints) and the same
`WORKER_SHARED_SECRET` as environment variables in Vercel.
