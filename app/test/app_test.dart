import 'dart:convert';
import 'dart:io';

import 'package:dexbot_app/brand.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frockbot_client/app.dart';
import 'package:frockbot_client/brand.dart';
import 'package:frockbot_client/client/transport.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class MemoryStore implements LocalStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// The app_links plugin has no platform under test.
void withoutDeepLinks(WidgetTester tester) {
  final messenger = tester.binding.defaultBinaryMessenger;
  for (final channel in const [
    MethodChannel('com.llfbandit.app_links/events'),
    MethodChannel('com.llfbandit.app_links/messages'),
  ]) {
    messenger.setMockMethodCallHandler(channel, (_) async => null);
    addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
  }
}

/// Lets the offline requests fail and the sign-in page settle.
Future<void> settle(WidgetTester tester) async {
  for (var round = 0; round < 4; round++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
    await tester.pumpAndSettle();
  }
}

/// Every asset key an [Image] on screen is drawing.
Set<String> images(WidgetTester tester) => {
  for (final image in tester.widgetList<Image>(find.byType(Image)))
    if (image.image case final AssetImage asset) asset.assetName,
};

/// `KEY = value` lines of `identity.xcconfig`.
Map<String, String> identity() => {
  for (final line in File('identity.xcconfig').readAsLinesSync())
    if (line.split('//').first case final text when text.contains('='))
      text.split('=').first.trim(): text.split('=').last.trim(),
};

void main() {
  setUp(() => installClientBrand(dexbotBrand));

  testWidgets('the app is DexBot and never FrockBot', (tester) async {
    withoutDeepLinks(tester);
    final store = MemoryStore();
    final offline = NativeApi(
      store,
      client: MockClient((_) async => throw http.ClientException('offline')),
    );

    await tester.pumpWidget(FrockBotApp(store: store, api: offline));
    await settle(tester);

    expect(
      tester.widget<MaterialApp>(find.byType(MaterialApp)).title,
      'DexBot',
    );
    expect(find.byKey(const ValueKey('sign-in')), findsOneWidget);
    expect(find.text('DexBot'), findsOneWidget);
    expect(find.textContaining('Couldn’t reach DexBot'), findsOneWidget);
    expect(images(tester), {'assets/branding/icon.png'});
    expect(find.textContaining('FrockBot'), findsNothing);
    expect(find.textContaining('Frock'), findsNothing);
    expect(find.bySemanticsLabel(RegExp('Frock')), findsNothing);
  });

  test('the brand is a plain build with its own cast', () {
    expect(dexbotBrand.releaseChannel, isNull);
    expect(characterCatalogV1.keys, ['dex']);
    expect(defaultCharacterIdV1, 'dex');
    for (final character in dexbotBrand.characters) {
      expect(File(character.still).existsSync(), isTrue);
      expect(character.still, startsWith('assets/'));
    }
  });

  test('every platform names the product the brand names', () {
    final name = dexbotBrand.productName;
    expect(identity()['DEXBOT_APP_NAME'], name);
    final manifest =
        jsonDecode(File('web/manifest.json').readAsStringSync())
            as Map<String, dynamic>;
    expect(manifest['name'], name);
    expect(manifest['short_name'], name);
    expect(
      File('web/index.html').readAsStringSync(),
      contains('<title>$name</title>'),
    );
  });
}
