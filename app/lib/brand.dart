/// DexBot's brand: the words, icon and characters that make FrockBot's client
/// package DexBot (ADR 0038). Everything the client shows as DexBot's own is
/// written here, so renaming the product is an edit to this file and to
/// `identity.xcconfig`, which holds the platform ids and launcher label.
///
/// The icon and the one character are placeholders until real art exists.
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
  characters: [
    // Placeholder art drawn by `tool/placeholder_art.py`, which prints the
    // ink box below.
    CharacterDefinition(
      'dex',
      'Dex',
      Color(0xff3ddc97),
      Color(0xff1f9e67),
      Color(0xfff0fff8),
      ink: CharacterInk(
        canvasWidth: 457,
        canvasHeight: 615,
        left: 43,
        top: 95,
        width: 371,
        height: 437,
      ),
      // No Rive file: Dex is its still everywhere, and the client never
      // loads the Rive runtime for a brand whose characters are all stills.
      still: 'assets/characters/dex.png',
      voice: 'Kore',
    ),
  ],
);
