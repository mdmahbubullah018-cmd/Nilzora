# Nilzora

A premium single-vendor e-commerce platform for Bangladesh: a customer storefront, an admin and
moderator workspace, a React Native customer app, and the Express API and PostgreSQL schema behind
them.

Everything lives in one pnpm workspace. Customers pay cash on delivery; there is no online payment
integration.

## Workspace

| Path                                                   | What it is                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `apps/storefront`                                      | Customer website — Next.js App Router, Tailwind CSS v4 (`http://localhost:3000`) |
| `apps/admin`                                           | Admin and moderator workspace — Next.js (`http://localhost:3001`)                |
| `apps/api`                                             | Business API — Express 5, versioned under `/api/v1` (`http://localhost:4000`)    |
| `apps/mobile`                                          | Customer app — Expo SDK 58 / React Native 0.88 / Expo Router (Android-first)     |
| `packages/api-client`                                  | Typed HTTP client for the API, shared by the apps                                |
| `packages/contracts`                                   | Request/response schemas and shared types (Zod)                                  |
| `packages/validation`                                  | Validation schemas shared by the API and its clients                             |
| `packages/design-tokens`                               | Colour, type and spacing tokens for web and mobile                               |
| `packages/ui`                                          | Shared web components                                                            |
| `packages/web-session`                                 | Server-side session, cookie, CSRF and API-proxy helpers for the two Next.js apps |
| `packages/e2e`                                         | End-to-end scenarios (run separately, not part of `pnpm test`)                   |
| `packages/eslint-config`, `packages/typescript-config` | Shared lint and TypeScript configuration                                         |
| `supabase/`                                            | Local Supabase configuration, SQL migrations, database tests and seed data       |
| `assets/`                                              | Supplied brand artwork and app icons                                             |

The two Next.js apps never call the API from the browser: Server Actions and route handlers reach
the API server-to-server through `@nilzora/web-session`, so access tokens stay in `httpOnly`
cookies. The mobile app calls the API directly and keeps its tokens in the device keychain
(`expo-secure-store`).

## Prerequisites

- **Node.js 22** — see `.nvmrc` (the root `package.json` accepts `^22.18.0 || ^24.11.0`).
- **pnpm 11.28.6** — pinned by `packageManager` in the root `package.json`. If `pnpm` is not
  already on your PATH, install it through corepack: `corepack enable`.
- **Docker** — for the local Supabase stack (`pnpm db:*` scripts).
- **Android**: JDK 17+ (Android Studio's bundled JBR works), the Android SDK with
  `platform-tools`, and a device or emulator. Android builds on Windows run from this repository.
- **iOS**: not available on Windows. See [iOS](#ios) below.

## Install

```bash
pnpm install
```

The workspace deliberately uses pnpm's hoisted `nodeLinker` (see `pnpm-workspace.yaml`): React
Native's Android CMake builds exceed the Windows path limit with the isolated layout.

## Environment files

Every app reads its own local environment file. Copy the matching example and fill in your own
values; the examples contain placeholders only and are the only environment files that belong in
version control.

| App        | File                         | Example                        |
| ---------- | ---------------------------- | ------------------------------ |
| API        | `apps/api/.env`              | `apps/api/.env.example`        |
| Storefront | `apps/storefront/.env.local` | `apps/storefront/.env.example` |
| Admin      | `apps/admin/.env.local`      | `apps/admin/.env.example`      |
| Mobile     | `apps/mobile/.env`           | `apps/mobile/.env.example`     |

The API example documents every integration variable in comments (Supabase, email, R2, FCM,
couriers, 2FA). Optional integrations can stay unset: the app degrades to "unavailable" rather than
failing to start, and production-only requirements are reported by the API at start-up.

`apps/mobile/.env` holds public values only (`EXPO_PUBLIC_*`). For Android push notifications, also
point `GOOGLE_SERVICES_FILE` at a Firebase `google-services.json` that belongs to your own Firebase
project — it is never committed.

## Local database

```bash
pnpm db:start      # start the local Supabase stack (Docker)
pnpm db:migrate    # apply supabase/migrations to the local database
pnpm db:types      # regenerate apps/api/src/supabase/database.types.ts
pnpm db:test       # run the SQL test suites in supabase/tests
pnpm db:status     # show the local stack's URLs and keys
pnpm db:stop       # stop the local stack
```

`supabase/seed.sql` holds development data only.

### Writing a migration

1. Add a new file to `supabase/migrations` named `YYYYMMDDHHMMSS_short_description.sql`.
2. Never edit or reorder a migration that has already been applied anywhere.
3. Keep RLS and grants in the same migration as the table or function they protect, and add a test
   under `supabase/tests` when the behaviour is security-relevant.
4. Run `pnpm db:migrate`, then `pnpm db:test`, then `pnpm db:types`.

Never run these scripts against a hosted project by accident: they are local-only by default.

## Run the apps

```bash
pnpm dev            # API + storefront + admin together
pnpm dev:api        # API only            → http://localhost:4000
pnpm dev:storefront # storefront only     → http://localhost:3000
pnpm dev:admin      # admin only          → http://localhost:3001
pnpm dev:mobile     # Expo dev server for the app
```

The API also has `dev:local`, which loads `.env` and then `.env.local`.

## Mobile

```bash
pnpm dev:mobile                       # Expo dev server (Metro)
pnpm --filter @nilzora/mobile run android   # expo run:android
pnpm --filter @nilzora/mobile run build     # production JS export
```

### Android

`apps/mobile/android` is **generated** by Expo prebuild and is not committed. Generate it once,
then build the debug APK the project uses for device testing:

```bash
corepack pnpm --filter @nilzora/mobile exec expo prebuild --platform android
corepack pnpm --filter @nilzora/mobile run android:apk   # or: cd apps/mobile && pnpm android:apk
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

`android:apk` re-embeds `index.android.bundle` before the Gradle build, so the installed APK contains
the current JavaScript. A plain `gradlew :app:assembleDebug` reuses whatever bundle is already in
`android/app/src/debug/assets`.

Native customisations that must survive prebuild live in `apps/mobile/plugins` and are registered in
`apps/mobile/app.config.ts`; do not edit the generated Gradle files by hand.

**Release signing.** Debug builds use the template's debug key. A release build (`assembleRelease`,
`bundleRelease`) refuses to run until these variables are present in the build environment:

```
NILZORA_ANDROID_KEYSTORE_PATH       absolute path to the private upload keystore
NILZORA_ANDROID_KEYSTORE_PASSWORD
NILZORA_ANDROID_KEY_ALIAS
NILZORA_ANDROID_KEY_PASSWORD
```

No keystore or password is committed. No release build has been configured or uploaded yet.

### iOS

There is no committed `ios/` project, and iOS has never been built or verified. The screens, API
client, cart, checkout and COD flow are shared React Native code, but these still need a macOS
machine with Xcode:

- `expo prebuild --platform ios` and a CocoaPods install;
- an Apple Developer account, certificates, provisioning profiles and an App Store Connect app;
- APNs credentials for push notifications (`expo-notifications` is configured for Android/FCM
  today);
- an iOS URL-scheme plugin entry for Google Sign-In, which is currently Android-only;
- voice search, which is an Android-only native module (`apps/mobile/modules/nilzora-speech`) and is
  intentionally hidden where the module is unavailable.

Treat iOS as work in progress, not a store-ready build.

## Quality checks

```bash
pnpm lint          # eslint across every workspace
pnpm typecheck     # tsc (and Next typegen) across every workspace
pnpm test          # unit and component tests across every workspace
pnpm build         # production builds: API, storefront, admin, mobile JS export
pnpm format:check  # prettier
pnpm check         # format:check + lint + typecheck + test
```

Focused runs:

```bash
pnpm --filter @nilzora/mobile test
pnpm --filter @nilzora/storefront test
pnpm --filter @nilzora/admin test
pnpm --filter @nilzora/api test
```

Tests that need the local stack are separate and are not part of `pnpm test`:

```bash
pnpm test:integration   # API integration tests (needs `pnpm db:start`)
pnpm test:e2e           # end-to-end scenarios in packages/e2e
```

`apps/api/src/tests/secret-boundary.test.ts` fails the build if a client-side app or shared package
references Supabase server credentials or imports the API package. Keep it that way.

## Versioning

The mobile app's version lives in one place, `apps/mobile/app.json`:

| Field                      | Rule                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `expo.version`             | Customer-facing `MAJOR.MINOR.PATCH`, shared by Android and iOS for the same release |
| `expo.android.versionCode` | Integer, increased for **every** Android upload                                     |
| `expo.ios.buildNumber`     | String integer, increased for **every** iOS upload to App Store Connect             |

A prebuild writes these into Android's `versionName`/`versionCode` (verified) and into the iOS
project's `CFBundleShortVersionString`/`CFBundleVersion` (not yet generated on this machine); editing
the generated Gradle or Xcode files has no lasting effect. Android and iOS build numbers may differ,
and the web apps, API and packages are not forced to match the app version.

CI is `.github/workflows/ci.yml`: install with the pinned pnpm, verify the lockfile, format, lint,
typecheck, test and build.

## Security reminders

- Never commit `.env`, `.env.local`, keystores, provisioning profiles, Firebase service-account
  files or `google-services.json`. `.gitignore` covers them; keep it that way.
- Server-only secrets (`SUPABASE_SECRET_KEY`, `DATABASE_URL`, R2 and SMTP credentials, FCM private
  keys, `TWO_FACTOR_ENCRYPTION_KEY`) belong in the API environment only. Never in a
  `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*` variable.
- The API is the authority for prices, stock, discounts, totals and permissions; clients only
  display what it returns.
- Do not apply migrations to a hosted database or deploy anything as part of a routine code change.
