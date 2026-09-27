# DexBot client

DexBot's Flutter application: FrockBot's client package, `frockbot_client`, run with DexBot's brand ([ADR 0038 §4](https://github.com/timoconnellaus/frockbot/blob/main/docs/adr/0038-white-label-deployments.md)). `lib/main.dart` calls `runFrockbot(dexbotBrand)` and nothing else; every screen comes from the package.

## What is DexBot's

| File | Holds |
| --- | --- |
| `lib/brand.dart` | The `ClientBrand`: product name, built-in model name, sign-in icon, the native URL scheme (`dexbot`), the accent, the character catalog and default character. No sign-in provider, so the sign-in page's wording is neutral, and no release channel, so the updaters stay inert. |
| `identity.xcconfig` | Android application id, Apple bundle id, the name under the launcher icon, the sign-in return scheme the Apple apps register, and the Universal Links host. Xcode includes it from `ios/` and `macos/`; Gradle reads the same keys. |
| `assets/` | The character still and the sign-in icon, drawn by `tool/placeholder_art.py`, which also writes every platform's app icon. |
| `android/`, `ios/`, `macos/`, `web/` | The platform projects, carried over from FrockBot's `apps/native` with DexBot's identity and without Shorebird, Sparkle's feed, Firebase registrations or FrockBot's Apple team. |

Every name, id, colour and picture here is a **placeholder**. To rename the product, edit `lib/brand.dart`, `identity.xcconfig`, and the name in `web/manifest.json` and `web/index.html`; `flutter test` fails if they disagree.

## The sign-in return scheme

A browser sign-in or Connect comes back to the iOS and macOS apps on a custom URL scheme, and to an Android debug build on `<scheme>-dev`. DexBot's is `dexbot`, and four places must agree on it: the brand's `nativeScheme` (`lib/brand.dart`), `DEXBOT_URL_SCHEME` in `identity.xcconfig` (which both Apple projects register), `android:scheme="dexbot-dev"` in `android/app/src/debug/AndroidManifest.xml`, and the server brand's `nativeScheme`, which DexBot's deployment must set to `"dexbot"`. `flutter test` checks the first three.

## The pin

`pubspec.yaml` depends on `frockbot_client` by git URL, path and a full commit SHA of FrockBot's `main`, because FrockBot has not tagged a release that carries the package yet. Move it to a release tag once one exists. The `webview_flutter_wkwebview` override comes from the same commit, and `pubspec.lock` starts from FrockBot's own lockfile so the transitive versions are the ones FrockBot tests.

## Build

Use Flutter **3.47.0 / Dart 3.13.0**, the SDK the client requires.

```sh
cd app
flutter pub get --enforce-lockfile
flutter analyze --no-pub
# The client names no deployment of its own; the suite passes one that reaches nothing.
flutter test --no-pub --dart-define=FROCKBOT_ORIGIN=https://tests.invalid
```

The web build talks to the origin that serves it, so it takes no origin:

```sh
flutter build web --release --no-pub
```

Every other build must name DexBot's deployment, or the client refuses it at its first request:

```sh
flutter build apk   --release --dart-define=FROCKBOT_ORIGIN=https://<dexbot deployment>
flutter build ios   --release --dart-define=FROCKBOT_ORIGIN=https://<dexbot deployment>
flutter build macos --release --dart-define=FROCKBOT_ORIGIN=https://<dexbot deployment>
```

Android also takes its App Link host from that origin. `--dart-define=FROCKBOT_LOCAL_DEV=true` points a build at a local stack on `http://127.0.0.1:8787` instead. The define names are the client's, which is why they say `FROCKBOT_`.

A standalone web build asks for the engine's fallback fonts under `fallback-fonts/` (`web/flutter_bootstrap.js`), which FrockBot's `build-flutter-web.ts` stages when it builds a deployment's web client; served on its own, those requests 404 and a glyph the bundled fonts lack goes undrawn.

## Not yet DexBot's

- **Art.** Dex is a generated placeholder still with no Rive file, so the client draws the still everywhere and never loads the Rive runtime. The accent is a placeholder teal.
- **Push.** There is no DexBot Firebase project. Without `android/app/google-services.json` or `ios/Runner/GoogleService-Info.plist` the app builds and runs with push off.
- **Signing.** Android release builds use the debug key, and the Apple projects name no team.
- **Development Apple builds.** FrockBot's Mac and iPhone projects can build a separate development app on `<scheme>-dev`. DexBot's projects carry no such variant, so a DexBot build with `FROCKBOT_IOS_DEV` or `FROCKBOT_DESKTOP_DEV` set would expect `dexbot-dev` returns that nothing registers.
- **What the client still writes.** Its native method channels are named `com.frockbot/…`, so the platform projects keep those; they are internal and never shown. What's New is not in `ClientBrand`: the feed comes from the server, so turning it off is DexBot's server brand's `whatsNew: false`.
