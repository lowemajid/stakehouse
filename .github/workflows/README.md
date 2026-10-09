# Workflow: Mobile CI (`mobile.yml`)

Pipeline for `apps/mobile` (Expo SDK 54 / React Native 0.81). Complements the
root [`ci.yml`](./ci.yml), which runs the full monorepo suite: the root
`tsconfig.json` **excludes** `apps/mobile`, so without this workflow the mobile
app would ship with no typecheck gate at all.

## Jobs

| Job             | Runs on                           | What it does                                                                                 |
| --------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| `mobile-checks` | every PR and every push to `main` | `npx tsc --noEmit -p apps/mobile`, `npx eslint apps/mobile`, `npx vitest run apps/mobile`    |
| `ios-config`    | every PR and every push to `main` | mobile typecheck plus `npx expo config --type public` — **validation only, no device build** |
| `android-apk`   | pushes to `main` (merges) only    | `expo prebuild -p android` + Gradle `assembleRelease`, uploaded as an Actions artifact       |

Superseded PR runs are cancelled automatically; `main` runs are never
cancelled, so every merge produces its APK artifact.

## iOS — why there is no device build (locked spec decision)

A iOS device or App Store build requires **macOS runners and an Apple
Developer account**, and neither exists in this environment. This is the
mobile decision locked in the platform spec (Blueprint `art_hao11AX3`,
§Mobile): iOS device/App Store builds are explicitly out of scope. What the
iOS job guarantees instead:

- the iOS target still typechecks (`tsc -p apps/mobile` covers iOS-shared code),
- the Expo app config (`app.json`) resolves cleanly for the `ios` platform.

In-browser QA of the mobile UI rides the **Expo web target**
(`react-native-web`), same as it does for web PRs; a device preview, when
wanted, is a development-time Expo Go tunnel — never a runtime dependency.

## Android — debug-signed release APK

On every merge to `main`, the `android-apk` job:

1. installs dependencies (`npm ci`) and JDK 17 (Temurin),
2. accepts Android SDK licenses so Gradle can fetch missing platform packages,
3. runs `npx expo prebuild -p android --no-install` to generate the native
   project from the committed app config,
4. runs `./gradlew assembleRelease`,
5. smoke-asserts the APK exists and uploads it as the
   `stakehouse-android-debug-apk` artifact of the run.

The APK is **debug-signed** with the keystore the Expo prebuild template
generates (`android/app/debug.keystore`) — the release build type's signing
config points at `signingConfigs.debug`. It is sideloadable for casual device
QA. No signing secrets are used or stored anywhere in this repo.

## Generated native directories are never committed

`apps/mobile/android/` and `apps/mobile/ios/` are produced by `expo prebuild`
at build time from `app.json` + the shared packages. They are regenerated
locally with:

```sh
cd apps/mobile && npx expo prebuild -p android --no-install
```

`prebuild` also adds the `android`/`ios` run scripts and the Android package
name to `apps/mobile/package.json` / `app.json` in your working tree — that
mutation is expected and should not be committed by hand.
