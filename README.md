# PictureWorks Inventory

Multi-platform inventory & asset-borrowing system. **Version 1.1.** (Production builds.)

Each component lives in its own top-level folder:

```
pictureworksinventory/
├── ios/                  iOS app (SwiftUI) — Inventory.xcodeproj
├── android/              Android app (Jetpack Compose, Gradle)
├── backend/              Node.js API service
├── status-page/          React/Vite Cloudflare(HKG) backend status page
└── docker/               Containerised backend (Dockerfile + qpdf, for Render/any host)
```

## Components

| Folder | Stack | Build / run |
|--------|-------|-------------|
| `ios/` | SwiftUI | Open `ios/Inventory.xcodeproj` in Xcode |
| `android/` | Kotlin / Compose | `cd android && ./gradlew :app:assembleDebug` |
| `backend/` | Node 20 | `cd backend && npm install && npm start`; MongoDB (`MONGODB_URI`) or JSON fallback |
| `status-page/` | React / Vite / Tailwind | `cd status-page && npm install && npm run dev`; `npm run deploy:worker` deploys the built static status page to Cloudflare Workers Assets |
| `docker/` | Docker | Self-contained image (installs `qpdf` for ACF PDF encryption) |

## Configuration

Secrets are **never** committed — copy each `*.env.example` to `.env` and fill it
in. Backend reads `MONGODB_URI`, `MONGODB_DB`, `CRON_SECRET`, optional
`TLS_CERT_PATH`/`TLS_KEY_PATH`. See `docker/README.md` for deployment.

## Version

`1.1` across all clients (iOS `MARKETING_VERSION 1.1` build 3, Android
`versionName 1.1` code 2). Tagged `1.1`.
