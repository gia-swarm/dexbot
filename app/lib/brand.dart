/// DexBot's brand: the words, icon and characters that make FrockBot's client
/// package DexBot (ADR 0038). Everything the client shows as DexBot's own is
/// written here, so renaming the product is an edit to this file and to
/// `identity.xcconfig`, which holds the platform ids and launcher label.
///
/// Every value is a placeholder: the name until the product is named, and the
/// one character until real art exists.
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
  // No `signInProvider`: DexBot signs in through Privy, whose own page offers
  // the ways in, so the sign-in page says only "sign in".

  // A placeholder teal until DexBot has a palette. White type sits on `ink`
  // and `paper`, so each keeps 4.5:1 against white.
  accent: ClientAccent(
    ink: Color(0xff0f7a5a),
    paper: Color(0xff0c6b4f),
    soft: Color(0xff8ff0c6),
    deep: Color(0xff064d38),
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
