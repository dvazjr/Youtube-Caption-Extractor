# YT Transcript

Extract the full transcript from any YouTube video. **100% free — no API keys needed.**

## Setup locally

```bash
git clone https://github.com/YOUR_USERNAME/yt-transcript
cd yt-transcript
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Deploy to Vercel (free)

### Option A — Vercel CLI
```bash
npx vercel
```

### Option B — GitHub import
1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Click **Deploy** — no environment variables needed

That's it. Vercel's free tier handles everything.

---

## How it works

1. Paste a YouTube URL
2. The frontend calls `/api/transcribe` on Vercel's serverless backend
3. The backend fetches YouTube's built-in caption data directly (no AI, no cost)
4. Clean text is returned and displayed instantly
