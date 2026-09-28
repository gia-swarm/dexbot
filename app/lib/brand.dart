/// DexBot's brand: the words, icon and characters that make FrockBot's client
/// package DexBot (ADR 0038). Everything the client shows as DexBot's own is
/// written here, so renaming the product is an edit to this file and to
/// `identity.xcconfig`, which holds the platform ids and launcher label.
///
/// The app icon is a placeholder until real art exists.
library;

import 'package:flutter/painting.dart';
import 'package:frockbot_client/frockbot_client.dart';

const dexbotBrand = ClientBrand(
  productName: 'DexBot',
  builtInModelName: 'Dex AI',
  signInIcon: AssetImage('assets/branding/icon.png'),
  defaultCharacterId: 'dex',
  // The custom URL scheme the Mac and iPhone projects register for the
  // browser's sign-in and Connect returns, from `identity.xcconfig`'s
  // `DEXBOT_URL_SCHEME`; the Android debug manifest registers `dexbot-dev`.
  // The server brand's `nativeScheme` must name the same one.
  // test/app_test.dart fails if any of them disagree.
  nativeScheme: 'dexbot',
  // DexBot signs in with Discord only, through Privy.
  signInProvider: 'Discord',

  // dexfi.com's blues. The client puts white type on `ink` and `paper`, which
  // DexFi's main blue (#4D9EDC) can't carry at 4.5:1, so both are its darker
  // hover blue until a brand can name the client's full looks
  // (gia-swarm/dexbot#8). The server brand's looks are DexFi's own.
  accent: ClientAccent(
    ink: Color(0xff3674a5),
    paper: Color(0xff3674a5),
    soft: Color(0xff9ccbee),
    deep: Color(0xff0d2338),
  ),
  // No release channel: a plain build, whose updaters stay inert. DexBot has
  // no Shorebird app and no Sparkle feed.
  // DiceBear "Personas" by Draftbit (CC BY 4.0, credited in
  // assets/characters/CREDITS.md) on DiceBear's "Bold Pop" backgrounds, cut
  // round. `tool/characters.py` makes the stills and prints this list.
  characters: [
    CharacterDefinition(
      'dex',
      'Dex',
      Color(0xff4d96ff),
      Color(0xff376cb7),
      Color(0xffffffff),
      ink: _round,
      still: 'assets/characters/dex.png',
      voice: 'Kore',
    ),
    CharacterDefinition(
      'ivy',
      'Ivy',
      Color(0xff4d96ff),
      Color(0xff376cb7),
      Color(0xffffffff),
      ink: _round,
      still: 'assets/characters/ivy.png',
      voice: 'Aoede',
    ),
    CharacterDefinition(
      'kai',
      'Kai',
      Color(0xffff5d8f),
      Color(0xffb74266),
      Color(0xffffffff),
      ink: _round,
      still: 'assets/characters/kai.png',
      voice: 'Puck',
    ),
    CharacterDefinition(
      'eli',
      'Eli',
      Color(0xffb57bff),
      Color(0xff8258b7),
      Color(0xffffffff),
      ink: _round,
      still: 'assets/characters/eli.png',
      voice: 'Fenrir',
    ),
    CharacterDefinition(
      'gia',
      'Gia',
      Color(0xffb57bff),
      Color(0xff8258b7),
      Color(0xffffffff),
      ink: _round,
      still: 'assets/characters/gia.png',
      voice: 'Leda',
    ),
    CharacterDefinition(
      'nova',
      'Nova',
      Color(0xffffb703),
      Color(0xffb78302),
      Color(0xffffffff),
      ink: _round,
      still: 'assets/characters/nova.png',
      voice: 'Zephyr',
    ),
    CharacterDefinition(
      'leo',
      'Leo',
      Color(0xffffb703),
      Color(0xffb78302),
      Color(0xffffffff),
      ink: _round,
      still: 'assets/characters/leo.png',
      voice: 'Charon',
    ),
    CharacterDefinition(
      'juno',
      'Juno',
      Color(0xff43aa8b),
      Color(0xff307a64),
      Color(0xffffffff),
      ink: _round,
      still: 'assets/characters/juno.png',
      voice: 'Orus',
    ),
  ],
);

/// Every still is a 512 px circle that fills its canvas.
const _round = CharacterInk(
  canvasWidth: 512,
  canvasHeight: 512,
  left: 0,
  top: 0,
  width: 512,
  height: 512,
);
