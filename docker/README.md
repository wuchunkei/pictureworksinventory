# Inventory Borrowing API — Docker / Render deployment

Self-contained container build of the backend. Connects to MongoDB Atlas; the
ACF export uses `qpdf` (installed in the image).

## Deploy on Render

1. **New → Web Service**, connect the GitHub repo.
2. **Root Directory**: `docker`
3. **Runtime**: Docker (Render auto-detects the `Dockerfile`).
4. **Instance Type**: Free.
5. **Health Check Path**: `/api/health`
6. **Environment variables** (Settings → Environment):

   | Key | Value |
   |-----|-------|
   | `MONGODB_URI` | `mongodb+srv://…@<cluster>.mongodb.net/` |
   | `MONGODB_DB` | `pictureAir_inventory` (prod) |
   | `CRON_SECRET` | a long random string |
   | `API_PORT` | `10000` (optional; `PORT` is auto-injected) |

7. **MongoDB Atlas**: add `0.0.0.0/0` to the cluster's network allowlist
   (Render's egress IP is dynamic).

8. Deploy → you get `https://<name>.onrender.com`. Add `…/api` to the app's
   node catalog so the apps can select it.

## Keep-alive + alerts (free, external)

- **cron-job.org** — every 5 min: `GET https://<name>.onrender.com/api/health`
  (prevents the free instance from sleeping).
- **cron-job.org** — daily: `POST https://<name>.onrender.com/api/cron/daily-check`
  with header `X-Cron-Secret: <CRON_SECRET>` (runs the daily stock check).
- **UptimeRobot** — monitor `…/api/health`; alert `wuchunkei@outlook.com` after
  2 consecutive failures; recovery email on restore.

## Endpoints used here

- `GET  /api/health` — liveness (no auth).
- `POST /api/cron/daily-check` — runs the daily stock check; requires
  `X-Cron-Secret`.
