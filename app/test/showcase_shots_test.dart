/// Showcase stills: DexBot's real desktop window, drawn by the client package
/// against a scripted server, for showing the product before it is deployed.
/// Every Bot, vault and number here is illustrative.
///
///   flutter test test/showcase_shots_test.dart --dart-define=SHOTS=`dir`
///
/// Without `SHOTS` every scene is skipped: they draw, they do not assert.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:dexbot_app/brand.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frockbot_client/brand.dart';
import 'package:frockbot_client/client/bot_sessions.dart';
import 'package:frockbot_client/client/transport.dart';
import 'package:frockbot_client/shell/app_shell.dart';
import 'package:frockbot_client/theme/frock_theme.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'app_test.dart' show MemoryStore;

const _out = String.fromEnvironment('SHOTS');
const _scale = int.fromEnvironment('SHOTS_SCALE', defaultValue: 2);
final _boundary = GlobalKey();

/// Paths the shell asked for that the script doesn't answer, to fill in.
final unanswered = <String>{};

Future<void> _loadFonts() async {
  final inter = FontLoader(interFontFamily);
  for (final weight in [400, 500, 600, 700]) {
    inter.addFont(
      rootBundle.load(
        'packages/frockbot_client/assets/fonts/inter-latin-$weight.ttf',
      ),
    );
  }
  await inter.load();
  await (FontLoader(
    'MaterialIcons',
  )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
}

/* ── The script ──────────────────────────────────────────────────────── */

typedef _Bot = ({
  String id,
  String character,
  String name,
  String primary,
  String when,
  String last,
  int unread,
});

const List<_Bot> _bots = [
  (
    id: 'dex',
    character: 'dex',
    name: 'Dex',
    primary: '#4d9edc',
    when: '2026-09-28T09:40:30.000Z',
    last: 'Want me to draft it? You’d approve it in your wallet.',
    unread: 0,
  ),
  (
    id: 'ranges',
    character: 'kai',
    name: 'Range Scout',
    primary: '#e245a5',
    when: '2026-09-27T23:12:00.000Z',
    last: 'AiLM moved ETH/USDC to 2,410–2,690. Back in range.',
    unread: 2,
  ),
  (
    id: 'vaults',
    character: 'juno',
    name: 'Vault Watch',
    primary: '#0eb873',
    when: '2026-09-28T08:05:00.000Z',
    last: 'All three vaults harvested. Nothing below 5% APR.',
    unread: 0,
  ),
  (
    id: 'harvest',
    character: 'leo',
    name: 'Harvest Log',
    primary: '#e9af19',
    when: '2026-09-27T22:00:00.000Z',
    last: 'Weekly summary: 168 harvests, \$0.41 average gas share.',
    unread: 0,
  ),
];

const _userName = 'Sam Carter';

Map<String, Object?> _run(
  String runId,
  String at,
  String input,
  List<String> replies,
) => {
  'schemaVersion': 3,
  'runId': runId,
  'input': input,
  'status': 'completed',
  'admittedAt': at,
  'events': [
    for (var i = 0; i < replies.length; i++)
      {
        'type': 'send/to-user',
        'payload': {'type': 'text', 'text': replies[i]},
        'ordinal': i,
      },
  ],
  'outcome': {'type': 'completed', 'text': ''},
};

final Map<String, List<Map<String, Object?>>> _turns = {
  'dex': [
    _run(
      'run-1',
      '2026-09-28T09:32:00.000Z',
      'How did my vaults do this week?',
      [
        'Up **\$412.80** across your three vaults this week, all auto-compounded.\n\n'
            '- **ETH/USDC · AiLM**: +\$296.10 on \$18,400 (21.4% APR)\n'
            '- **Stable Trio**: +\$71.20 on \$12,000 (7.8% APR)\n'
            '- **DEX/ETH farm mix**: +\$45.50 on \$3,150 (38.9% APR)\n\n'
            'AiLM moved the ETH/USDC range twice, on Tuesday and Friday, after ETH '
            'broke out of the old band. It spent 94% of the week in range.',
      ],
    ),
    _run(
      'run-2',
      '2026-09-28T09:40:00.000Z',
      'Should I move some of Stable Trio into the ETH/USDC vault?',
      [
        'It would lift your blended APR from about **17.1% to 18.9%** if you '
            'moved 20% (\$2,400). The trade-off is exposure: ETH/USDC is a '
            'volatile pair, and a sharp move can leave it out of range until '
            'AiLM recalibrates at the next harvest.\n\n'
            'Want me to draft it? You’d approve the withdrawal and the deposit '
            'in your wallet. I never hold your keys.',
      ],
    ),
  ],
  'ranges': [
    _run(
      'run-1',
      '2026-09-26T23:00:00.000Z',
      'Keep an eye on my ETH/USDC AiLM range and tell me when it moves.',
      [
        'On it. I’ll check after every harvest and message you here when '
            'AiLM moves the range or the price leaves it.',
      ],
    ),
    _run('run-2', '2026-09-27T23:12:00.000Z', 'Anything change overnight?', [
      '**ETH/USDC left its range at 06:48.** ETH climbed past 2,640, the top '
          'of the old band, and the position stopped earning fees.',
      'AiLM recalibrated at the 09:00 harvest and moved it to **2,410–2,690**. '
          'It’s back in range and earning again. Out-of-range time today: '
          '2 h 12 min.\n\nNothing for you to do.',
    ]),
  ],
  'vaults': [
    _run(
      'run-1',
      '2026-09-28T08:05:00.000Z',
      'Tell me if any of my vaults drops below 5% APR.',
      [
        'Watching all three. I check after every harvest and I’ll message you here.',
      ],
    ),
  ],
};

/// Routines as FrockBot's own projection renders them, from
/// `tool/showcase_routines.ts`.
final Map<String, Object?> _routines =
    (jsonDecode(File('test/showcase/routines.json').readAsStringSync()) as Map)
        .cast<String, Object?>();

/* ── The server ──────────────────────────────────────────────────────── */

class _ScriptedServer extends NativeApi {
  _ScriptedServer(super.store);

  Map<String, Object?> _unread(_Bot bot) => {
    'schemaVersion': 1,
    'botId': bot.id,
    'count': bot.unread,
    'capped': false,
    'unread': bot.unread > 0,
    'manuallyUnread': false,
    'notificationsEnabled': true,
    'lastActivityCursor': 'message-00000000000000000009',
    'lastSeenCursor': bot.unread > 0
        ? 'message-00000000000000000007'
        : 'message-00000000000000000009',
    'lastMessageId': '${bot.id}:send:0',
    'lastMessage': {
      'schemaVersion': 1,
      'text': bot.last,
      'at': bot.when,
      'role': 'assistant',
    },
    'lastActivityAt': bot.when,
    'lastViewedAt': bot.when,
  };

  @override
  Future<Object?> request(
    String path, {
    Object? body,
    int limit = 512000,
    bool authenticated = true,
  }) async {
    switch (path) {
      case '/api/bots':
        return {
          'schemaVersion': 1,
          'revision': 1,
          'bots': [
            for (final bot in _bots)
              {
                'schemaVersion': 1,
                'botId': bot.id,
                'registeredAt': '2026-09-01T00:00:00.000Z',
                'initialName': bot.name,
                'avatar': {
                  'schemaVersion': 1,
                  'characterId': bot.character,
                  'primary': bot.primary,
                },
              },
          ],
        };
      case '/api/bots/lifecycles':
        return {'schemaVersion': 1, 'lifecycles': const []};
      case '/api/settings/application':
        return {
          'sections': [
            {
              'id': 'profile',
              'fields': [
                {'id': 'name', 'value': _userName},
              ],
            },
          ],
        };
      case '/api/bots/unread':
        return {
          'schemaVersion': 1,
          'unread': [for (final bot in _bots) _unread(bot)],
        };
    }
    final bot = RegExp(r'^/api/bots/([^/?]+)/([^?]+)').firstMatch(path);
    final routines = _routines[bot?.group(1)] as Map?;
    switch (bot?.group(2)) {
      case 'routines' when path.endsWith('?as=document'):
        if (routines != null) return routines['document'];
      case 'routines/inbox':
        if (routines != null) return routines['inbox'];
      // No Computer on this deployment: the card is simply not there.
      case 'computer':
        throw const RequestFailure('No Computer', 404);
    }
    final turns = RegExp(r'^/api/bots/([^/]+)/turns').firstMatch(path);
    if (turns != null) {
      return {
        'schemaVersion': 1,
        'runs': _turns[turns.group(1)] ?? const [],
        'page': {'truncated': false},
      };
    }
    unanswered.add(path);
    throw const FormatException('not in the script');
  }

  /// A live channel that has caught up: the conversation, then ready.
  @override
  Future<WebSocketChannel> socket(
    String botId, {
    String? cursor,
    String? epoch,
  }) async {
    final socket = _Socket();
    socket.frames
      ..add(
        jsonEncode({
          'schemaVersion': 1,
          'type': 'state/snapshot',
          'epoch': '1',
          'cursor': '0',
          'reason': 'initial',
          'conversation': {
            'schemaVersion': 1,
            'runs': _turns[botId] ?? const [],
            'page': {'truncated': false},
          },
        }),
      )
      ..add(
        jsonEncode({
          'schemaVersion': 1,
          'type': 'state/ready',
          'epoch': '1',
          'cursor': '0',
        }),
      );
    return socket;
  }
}

class _Sink implements WebSocketSink {
  final _Socket socket;
  _Sink(this.socket);
  @override
  Future<void> close([int? closeCode, String? closeReason]) =>
      socket.frames.close();
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Socket implements WebSocketChannel {
  final frames = StreamController<dynamic>();
  @override
  Stream<dynamic> get stream => frames.stream;
  @override
  late final WebSocketSink sink = _Sink(this);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/* ── Capture ─────────────────────────────────────────────────────────── */

Future<void> _settle(WidgetTester tester) async {
  for (var round = 0; round < 6; round++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 60)),
    );
    await tester.pump(const Duration(milliseconds: 400));
  }
}

Future<void> _capture(WidgetTester tester, String name) async {
  await _settle(tester);
  for (final element in find.byType(Image).evaluate()) {
    final image = (element.widget as Image).image;
    await tester.runAsync(() => precacheImage(image, element));
  }
  await _settle(tester);
  await tester.runAsync(() async {
    final boundary =
        _boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: _scale.toDouble());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('$_out/$name.png').writeAsBytes(bytes!.buffer.asUint8List());
  });
}

Future<void> _window(
  WidgetTester tester,
  String name, {
  required String open,
  Size size = const Size(1440, 900),
  String? panelPage,
}) async {
  debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final messenger = tester.binding.defaultBinaryMessenger;
  messenger.setMockMethodCallHandler(
    const MethodChannel('com.frockbot/badge'),
    (_) async => null,
  );
  final store = MemoryStore()..values['selection.showcase'] = open;
  final server = _ScriptedServer(store);
  final sessions = BotSessions(api: server, store: store);
  final links = ValueNotifier<String?>(null);
  await tester.pumpWidget(
    RepaintBoundary(
      key: _boundary,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: FrockTheme.theme(Brightness.dark),
        home: AppShell(
          api: server,
          store: store,
          sessions: sessions,
          userId: 'showcase',
          botLinks: links,
          onSignOut: () async {},
        ),
      ),
    ),
  );
  if (panelPage != null) {
    await _settle(tester);
    await tester.tap(find.text(panelPage).last);
    await tester.pump();
  }
  await _capture(tester, name);
  await tester.pumpWidget(const SizedBox());
  await tester.pump();
  sessions.clear();
  links.dispose();
  debugDefaultTargetPlatformOverride = null;
  messenger.setMockMethodCallHandler(
    const MethodChannel('com.frockbot/badge'),
    null,
  );
}

void main() {
  setUpAll(() async {
    installClientBrand(dexbotBrand);
    await _loadFonts();
    if (_out.isNotEmpty) Directory(_out).createSync(recursive: true);
  });
  tearDownAll(() {
    if (unanswered.isNotEmpty) {
      debugPrint('Unscripted paths: ${unanswered.toList()..sort()}');
    }
  });

  testWidgets('desktop, Dex open', (tester) async {
    await _window(tester, 'desktop-dex', open: 'dex');
  }, skip: _out.isEmpty);

  testWidgets('desktop, Range Scout open', (tester) async {
    await _window(
      tester,
      'desktop-range-scout',
      open: 'ranges',
      panelPage: 'All Routines',
    );
  }, skip: _out.isEmpty);
}
