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
6. Do the same with [`supabase/migrations/002_campaigns.sql`](./supabase/migrations/002_campaigns.sql).

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
   | `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` |

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

## Updating the app later

Any push to the `main` branch on GitHub automatically redeploys on Vercel.

## Routine data refresh

Export the latest OrderExport from your store admin → upload it in Data Center. That's the whole refresh process (the file can overlap previous exports safely).

## Troubleshooting

- **"Invalid email or password"** — user doesn't exist or wrong password. Admins can create users from the Users page.
- **Login works but pages are empty / permission errors** — migrations not run. Re-run Step 1.4–1.6.
- **Import fails immediately** — make sure you're logged in as admin or manager, and the file has the `Order number` column (the standard OrderExport format).
- **Vercel build fails** — check the 3 environment variables are set exactly as named above, then redeploy.
