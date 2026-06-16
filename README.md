# PictureWorks Inventory

Multi-platform inventory & asset-borrowing system. **Version 1.1.** (Production builds.)

Each component lives in its own top-level folder:

```
pictureworksinventory/
├── ios/                  iOS app (SwiftUI) — Inventory.xcodeproj
├── android/              Android app (Jetpack Compose, Gradle)
├── web/                  Web SPA (index.html + app.js + screens.js)
│   └── gateway/          standalone Node web server (serves the SPA)
├── backend/              Node.js API service
├── docker/               Containerised backend (Dockerfile + qpdf, for Render/any host)
└── cloudflare-worker/    Cloudflare Worker fronting the web/api
```

## Components

| Folder | Stack | Build / run |
|--------|-------|-------------|
| `ios/` | SwiftUI | Open `ios/Inventory.xcodeproj` in Xcode |
| `android/` | Kotlin / Compose | `cd android && ./gradlew :app:assembleDebug` |
| `web/` | Vanilla JS SPA | Static `index.html` + `app.js` + `screens.js`; served by `cloudflare-worker/` or `web/gateway/` |
| `backend/` | Node 20 | `cd backend && npm install && npm start`; MongoDB (`MONGODB_URI`) or JSON fallback |
| `docker/` | Docker | Self-contained image (installs `qpdf` for ACF PDF encryption) |
| `cloudflare-worker/` | CF Worker | `wrangler deploy`; serves the SPA from the edge + proxies `/api/*` |

## Configuration

Secrets are **never** committed — copy each `*.env.example` to `.env` and fill it
in. Backend reads `MONGODB_URI`, `MONGODB_DB`, `CRON_SECRET`, optional
`TLS_CERT_PATH`/`TLS_KEY_PATH`. See `docker/README.md` for deployment.

## Version

`1.1` across all clients (iOS `MARKETING_VERSION 1.1` build 3, Android
`versionName 1.1` code 2). Tagged `1.1`.
