# Deployment Guide — Misr Hub

Total time: ~15 minutes. You need free accounts on [supabase.com](https://supabase.com) and [vercel.com](https://vercel.com) (sign in with your GitHub account **EngAtef**).

---

## Step 1 — Create the Supabase project (5 min)

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Name: `misr-hub`. Choose a strong database password (save it). Region: **Frankfurt (eu-central-1)** — closest to Egypt.
3. Wait ~2 minutes for the project to be created.

### Run the database migrations

4. In the left sidebar open **SQL Editor** → **New query**.
5. Copy the entire contents of [`supabase/migrations/001_init.sql`](./supabase/migrations/001_init.sql), paste, and click **Run**.
6. Do the same with [`supabase/migrations/002_campaigns.sql`](./supabase/migrations/002_campaigns.sql), then [`supabase/migrations/003_rfm.sql`](./supabase/migrations/003_rfm.sql).

### Create your first user (becomes admin automatically)

7. Go to **Authentication → Users → Add user → Create new user**.
8. Enter your email + password, and check **Auto Confirm User**.
   The first user ever created automatically gets the **admin** role.

### Disable public signups (important)

9. Go to **Authentication → Sign In / Up → disable "Allow new users to sign up"**.
   From now on, only admins create users (from the app's Users page).

### Get your API keys

10. Go to **Project Settings → API** and copy these 3 values:
    - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
    - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    - `service_role` `secret` key → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ keep secret

---

## Step 2 — Deploy to Vercel (5 min)

1. Go to <https://vercel.com/new> and sign in with GitHub.
2. Import the repository **EngAtef/misr-hub**.
3. Framework preset: **Next.js** (auto-detected). Leave build settings as default.
4. Open **Environment Variables** and add the 3 variables from Step 1.10:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` |

   (Already committed in `.env.production` for the current Supabase project, so this step is optional unless you point the app at a different database. `SUPABASE_SERVICE_ROLE_KEY` is only needed if you enable the weekly email reports.)

5. Click **Deploy**. After ~2 minutes you get your URL:
   `https://misr-hub.vercel.app` (you can rename it in Vercel → Settings → Domains, or attach your own domain like `hub.aladwaa.org`).

---

## Step 3 — First login & data import (5 min)

1. Open your Vercel URL → sign in with the user from Step 1.7.
2. Go to **مركز البيانات (Data Center)** → drag your `OrderExport_*.xlsx` file → **Start Import**.
   - ~20,000 orders take about 2–4 minutes (imported in chunks with a progress bar).
   - Re-uploading a newer export later is safe: existing orders are **updated**, new ones are **added**, nothing is ever deleted.
3. Go to **المستخدمون (Users)** to add your team:
   - **Manager** — can upload files and see everything.
   - **Viewer** — dashboards & reports only.

---

## Optional: weekly email reports (5 min)

The app can email a weekly performance summary (orders, revenue, trends vs previous week, top cities & products) every Monday 8am Cairo time.

1. Create a free account at <https://resend.com> → **API Keys** → create a key.
2. (Recommended) Verify your domain in Resend so emails come from e.g. `reports@aladwaa.org`. Without it, use the test sender.
3. In Vercel → your project → **Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `RESEND_API_KEY` | `re_...` from Resend |
   | `REPORT_RECIPIENTS` | `you@aladwaa.org, manager@aladwaa.org` |
   | `REPORT_FROM` | `Misr Hub <reports@yourdomain.org>` (optional) |
   | `CRON_SECRET` | any long random string (protects the endpoint) |

4. Redeploy. The schedule lives in `vercel.json` (`0 6 * * 1` = Mondays 06:00 UTC). To test immediately, open `/api/cron/report` while it's unprotected, or use Vercel's cron "Run" button.

Note: migration `003_rfm.sql` must also be run in the Supabase SQL Editor (same as the other two) — it powers the Customers segmentation page.

## Updating the app later

Any push to the `main` branch on GitHub automatically redeploys on Vercel.

## Routine data refresh

Export the latest OrderExport from your store admin → upload it in Data Center. That's the whole refresh process (the file can overlap previous exports safely).

## Troubleshooting

- **"Invalid email or password"** — user doesn't exist or wrong password. Admins can create users from the Users page.
- **Login works but pages are empty / permission errors** — migrations not run. Re-run Step 1.4–1.6.
- **Import fails immediately** — make sure you're logged in as admin or manager, and the file has the `Order number` column (the standard OrderExport format).
- **Vercel build fails** — check the 3 environment variables are set exactly as named above, then redeploy.
