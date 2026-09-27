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
      // `ClientBrand` requires a Rive file, and Dex has none yet. No file is
      // bundled under this key: the client's load of it fails and it draws
      // the still in its place, as it does wherever Rive is unavailable.
      rive: 'assets/characters/dex.riv',
      still: 'assets/characters/dex.png',
      voice: 'Kore',
    ),
  ],
);
