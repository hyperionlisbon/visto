# Visto — exercise correction app

Your daughter photographs exercises from her exercise book, the AI corrects them (Maths, Science, Portuguese, at her school year — 7.º ano), and you follow her progress.

- **Her view:** pick the subject, take up to 4 photos, get a full correction (score, what went well, what to practise, every exercise with the correct answer and an explanation). If she thinks the AI got something wrong, she taps 🚩 and you'll see it.
- **Your view:** a summary of the last 30 days (average, per subject, a chart of recent scores, the topics she gets wrong most often), corrections you haven't opened yet, her 🚩 flags, the photos, and a menu on each exercise to change the grade if the AI was wrong. You can also delete a correction.

The app is in European Portuguese. It installs on Android like a normal app (PWA) and runs on Vercel at no cost. The only cost is the Claude API, usually a few cents per correction, and it's capped by your spending limit.

---

## Setup (about 20 minutes, one time)

### 1. Claude API key and spending cap
1. Go to **console.anthropic.com** and sign in.
2. **Billing**: add a small amount of credit (e.g. €10).
3. **Settings → Limits**: set a **monthly spend limit** (e.g. €5). The app can never spend more than this.
4. **API Keys → Create key**, name it `visto`, and copy it somewhere safe for step 4.

### 2. GitHub
1. On github.com, create a new **private** repository called `visto`.
2. Click **uploading an existing file** and drag in everything from this folder (`api`, `public`, `dev`, `package.json`, `vercel.json`, `README.md`). Click **Commit changes**.

### 3. Vercel
1. On vercel.com: **Add New → Project**, then import the `visto` repository. Leave the settings as they are and click **Deploy**. (The first version shows errors until steps 3.2 and 4 are done. That's expected.)
2. In the project, open **Storage → Create Database → Upstash (Redis)**, choose the free plan and a European region (e.g. Frankfurt), and **Connect** it to the project. This creates `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.

### 4. Settings (Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the key from step 1 |
| `STUDENT_PASSWORD` | your daughter's password (at least 8 characters) |
| `PARENT_PASSWORD` | the parents' password (different, and stronger) |
| `SESSION_SECRET` | a long random text of at least 32 characters (e.g. from a password generator) |
| `SCHOOL_YEAR` | `7` (change to `8` next September, then Redeploy) |
| `DAILY_LIMIT` | *(optional)* corrections allowed per day, default `15` |
| `CLAUDE_MODEL` | *(optional)* default `claude-sonnet-5-5` |

Then go to **Deployments → ⋯ → Redeploy** so the settings take effect.

### 5. Install on the phones
Open the Vercel address (e.g. `visto-xxxx.vercel.app`) in **Chrome** on the Android phone, then **⋮ → Add to home screen → Install**. Log in once: she stays logged in for 90 days and you for 30.

---

## Security
- Two passwords. The one used decides whether you see the student view or the parent view. Only the parent password can change grades or delete corrections.
- Logins use a signed, HttpOnly cookie that only works on this site. After 8 wrong passwords, that device is blocked for 15 minutes.
- Photos and results are stored only in your own Upstash database. Photos are sent to the Claude API just to be corrected. The site asks search engines not to index it.
- To **log everyone out** (e.g. a lost phone), change `SESSION_SECRET` and redeploy. Change the passwords too if needed.
- The daily limit plus the monthly spend cap mean costs can't run away.

## Good to know
- The AI can make mistakes, especially with messy handwriting. Exercises it couldn't read clearly are marked ⚠️, and she can flag anything she disagrees with.
- Better photos give better corrections: the whole page, good light, no shadows, one page per photo.
- Testing on a computer: `node dev/server.js` runs a local copy with a fake database and a fake AI (student password `aluna123`, parent password `pais123`).
