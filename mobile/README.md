# Magpie native shell (Capacitor, remote-URL mode)

The store apps are a thin native shell around the live web app. The WebView
loads **https://app.magpielocal.com** (`server.url` in `capacitor.config.json`),
so the ONE web codebase stays the product: content and feature updates ship
through normal web deploys with no store resubmission. The shell carries only
native pieces — push, share, camera, splash, deep links.

- **App ID:** `com.magpielocal.app` (no different registered ID exists in the
  app repo or the site repo — verified by search before scaffolding)
- **App name:** Magpie
- **Nothing here is submitted anywhere.** Store submission is Jeff's step,
  with his accounts, when he says go.

## Layout

```
mobile/
  capacitor.config.json   Shell config (remote URL, splash/status-bar/push knobs)
  package.json            @capacitor/* deps (core, cli, ios, android + plugins)
  www/index.html          Offline fallback page ONLY (not the product)
  assets/                 PROPOSED icon/splash masters (see "Visuals gate")
    icon-only.png           1024x1024 full-bleed master, built from the real icon
    icon-background.png     gradient-only (Android adaptive background)
    icon-foreground.png     original art (Android adaptive foreground)
    icon-source-512.png     untouched copy of public/assets/icon.png (provenance)
    splash.png              2732x2732 light splash master (plain default)
    splash-dark.png         2732x2732 dark splash master (plain default)
  bridge/
    magpie-native-bridge.js The bridge the WEB app loads (see web-side changes)
  deep-links/             Ready-to-drop (NOT deployed) universal/app link files
    apple-app-site-association
    assetlinks.json
  design-review/          Renders for Jeff's visual approval (phone-friendly)
    icon-sheet.png
    splash-light.png
    splash-dark.png
  ios/                    Xcode project (generated; builds only on macOS)
  android/                Gradle project (debug build: see "Android build")
```

## Visuals gate (Jeff, 2026-11-20 — binding)

**Every visual in this folder is PROPOSED, not final.** Jeff personally
reviews and approves the icon set and splash before anything is locked.
`design-review/icon-sheet.png`, `splash-light.png` and `splash-dark.png` are
the renders to show him.

Icon provenance: the master is the REAL current app icon,
`signl-app/public/assets/icon.png` — white bird on the blue→green gradient,
512×512 RGBA (byte-identical copies also live in `signl-site/assets/` and
`magpie-assets/`). No larger copy of THIS artwork exists: the one 1024×1024
file in the workspace (`signl-meta-app-icon-1024.png`) is a different, older
"g" mark on black and was NOT used. The 1024 master was made by upscaling the
original and compositing it over a gradient fitted from the icon's own
sampled colors, so iOS gets the full-bleed, alpha-free square it requires
with no artwork redrawn. If Jeff wants a crisper master, the fix is a
designer-exported 1024 from the original vector source, dropped over
`assets/icon-only.png`, then re-run `npx @capacitor/assets generate`.

## Design approval drop-in points

A separate design stream is building the entry experience (intro video, then
Sign in / Apply) and the splash/sign-in design. The intro is a **signed-out,
web-side** experience — the shell adds no intro and no forced delay:
`SplashScreen.launchShowDuration` is 300 ms with `launchAutoHide`, and the
bridge hides the splash again on page load, so **signed-in users open
straight into their dashboard**.

When the approved design lands, only these change — no rework:

| Approved-design piece | Replace / set |
|---|---|
| Splash artwork (light) | `assets/splash.png` (2732×2732), re-run assets generate |
| Splash artwork (dark) | `assets/splash-dark.png` (2732×2732), re-run assets generate |
| Splash background color | `SplashScreen.backgroundColor` + top-level `backgroundColor` in `capacitor.config.json`; Android `android/app/src/main/res/values/colors.xml` / splash theme after generate |
| Splash show duration / fade | `SplashScreen.launchShowDuration`, `launchFadeOutDuration` in `capacitor.config.json` |
| Status bar look | `StatusBar.style` in `capacitor.config.json` + `initStatusBar()` in the bridge |
| Icon (if redesigned) | `assets/icon-only.png` (+ foreground/background), re-run assets generate |

Until then the defaults stay plain: white background, real logo, real icon.

## Plugins wired

Installed in the native projects (via `cap sync`): `@capacitor/push-notifications`,
`@capacitor/share`, `@capacitor/camera`, `@capacitor/app`,
`@capacitor/splash-screen`, `@capacitor/status-bar`.

The remote page cannot `import` plugin JS (no build step, and the page is
served from the web deploy). It doesn't need to: Capacitor injects its bridge
into every WebView page — including remote-URL pages — and creates lazy
proxies at `window.Capacitor.Plugins.<Name>` for every plugin installed in
the native app. `bridge/magpie-native-bridge.js` wraps those proxies in one
stable API (`window.MagpieNative`: `isNative`, `platform`, `share()`,
`takePhoto()`, `initPush()`, `hideSplash()`), no-ops safely in a desktop
browser, forwards deep links (`appUrlOpen`) and push taps to the SPA via
`window.magpieNativeRoute(path)` when the app defines it, and dispatches
`magpie:deep-link` / `magpie:push-open` / `magpie:push-received` /
`magpie:app-state` / `magpie:back-button` CustomEvents.

## Web-side changes needed (Brenda batches these — NOT done here)

1. **Bridge script:** copy `bridge/magpie-native-bridge.js` to
   `public/native-bridge.js` and add
   `<script src="/native-bridge.js" defer></script>` to `public/index.html`.
   Then, in `public/app.js`: call `MagpieNative.initPush()` after sign-in;
   define `window.magpieNativeRoute(path)` to route deep links/push taps;
   optionally route share buttons through `MagpieNative.share()` and photo
   uploads through `MagpieNative.takePhoto()`.
2. **Push-token endpoint:** `POST /api/devices/push-token` (session-auth,
   body `{ token, platform }`) does not exist yet. The bridge already sends
   there and keeps the token in `localStorage`, re-sending on every
   foreground, so tokens are not lost before the endpoint ships. Sending
   actual pushes additionally needs APNs/FCM credentials (below).
3. **`.well-known` deployment:** serve `deep-links/apple-app-site-association`
   at `https://app.magpielocal.com/.well-known/apple-app-site-association`
   (content type `application/json`, no redirect) and
   `deep-links/assetlinks.json` at
   `https://app.magpielocal.com/.well-known/assetlinks.json`. On Netlify:
   put both under `public/.well-known/` and add exact-path header rules if
   needed. Placeholders must be replaced first (Team ID, SHA-256 — below).
4. **Service worker:** the existing `public/sw.js` is fine as-is; it never
   caches `/api/*`. No change needed for the shell.

## Deep links

Prepared, **not deployed** (see web-side change 3):

- iOS: `deep-links/apple-app-site-association` claims `/claim*`, `/c/*`,
  `/roster/*`, `/founding-claim`, `/invite/*`, `/r/*` on
  `app.magpielocal.com`. The Xcode project carries the
  `applinks:app.magpielocal.com` associated-domain entitlement
  (`ios/App/App/App.entitlements`).
- Android: `deep-links/assetlinks.json` for package `com.magpielocal.app`;
  the manifest (`android/app/src/main/AndroidManifest.xml`) has
  `autoVerify` intent filters for the same host + paths.

Both files contain clearly marked placeholders that only Jeff can fill.

## Building

Prereqs: Node 20+ (this repo used Node 24). Android: JDK 17/21 + Android SDK
(command-line tools are fine). iOS: **macOS + Xcode — cannot be built on this
Linux VM**; the Xcode project here is generated and configured only.

```bash
cd mobile
npm install
npx cap sync

# icons/splash (after any assets/ change)
npx @capacitor/assets generate --iconBackgroundColor '#0141FB' --iconBackgroundColorDark '#0141FB' --splashBackgroundColor '#FFFFFF' --splashBackgroundColorDark '#111111'
npx cap sync

# Android debug APK (Linux/Windows/macOS)
cd android && ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk

# iOS (macOS only)
npx cap open ios   # then Archive in Xcode with Jeff's signing team
```

Local toolchain used for the Android check on this VM lives in
`~/workspace/toolchain/` (user-local JDK + Android SDK, free tools only).

## Needed from Jeff before submission

1. **Apple Team ID** (10-character) — replaces `NEEDS_JEFFS_TEAM_ID` in
   `deep-links/apple-app-site-association` and selects the signing team in
   Xcode.
2. **Android signing**: the upload keystore (Play App Signing) — its SHA-256
   cert fingerprint replaces `NEEDS_SIGNING_CERT_SHA256_FINGERPRINT` in
   `deep-links/assetlinks.json`. (For Play App Signing, use the fingerprint
   of the *app signing* key from Play Console, not the upload key.)
3. **Firebase project** (free tier) for Android push: `google-services.json`
   → `android/app/`. For iOS push through FCM, `GoogleService-Info.plist` →
   `ios/App/App/`. (Native APNs without Firebase is possible but FCM is the
   standard Capacitor path.)
4. **APNs key** (.p8) + Key ID from his Apple Developer account, uploaded to
   Firebase (or wired to whatever push sender the backend uses).
5. **Visual approval** of `design-review/` (icon sheet + splashes) — the
   visuals gate above; nothing visual is final until he approves.
6. Store listing assets/decisions (screenshots, descriptions, privacy
   labels) — covered by the separate store-pack workstream, not this shell.

## Android build

**Attempted on this Linux VM (2026-11-20); blocked by the sandbox, not by the
project.** A user-local toolchain was installed under `~/workspace/toolchain/`
and verified piece by piece: Temurin JDK 21.0.13.1 (`java -version` OK),
Android SDK platform-tools + `platforms;android-36` + `build-tools;36.0.0`
(the versions `variables.gradle`/AGP 8.13 ask for; sdkmanager itself cannot
use this sandbox's network, so the component zips were fetched with curl —
the same files sdkmanager downloads — and laid out in the standard SDK
structure), and Gradle 8.14.3 (`gradle --version` OK).

`gradle assembleDebug` then stops before compilation: the Gradle client
cannot talk to its build daemon. Root cause, proven with a minimal Java
socket test: this sandbox denies direct TCP connections from Java processes
(the connection is answered with a policy message naming the
`other_tcp` permission — Muse settings → Permissions → Direct network
protocols). The daemon handshake and Gradle's own dependency downloads both
need that socket access, so no APK could be produced in this environment.
Nothing in the failure implicates the project: dependency resolution and
compilation were never reached.

To finish the proof on any normal machine (or here after that one permission
is set to Ask): `cd mobile/android && ./gradlew assembleDebug` with JDK 21
and an Android SDK on `PATH`/`sdk.dir` — expected output
`app/build/outputs/apk/debug/app-debug.apk`.
