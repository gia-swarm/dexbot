/** A stand-in Privy app for tests: a P-256 key pair and a token minter. */

const seconds = (ms: number) => Math.floor(ms / 1000);

export const TEST_APP_ID = "cm-test-app";
export const TEST_NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
export const TEST_EMAIL = "person@example.com";
export const TEST_DID = "did:privy:cm0123456789abcdef";
export const TEST_DISCORD_ID = "80351110224678912";

/** The Discord account every test person signs in with, in Privy's compact form. */
export function discordAccount(overrides: Record<string, unknown> = {}) {
  return {
    type: "discord_oauth",
    subject: TEST_DISCORD_ID,
    username: "person",
    lv: seconds(TEST_NOW) - 30,
    ...overrides,
  };
}

function base64Url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export interface TestPrivyApp {
  /** The verification key as the Privy dashboard shows it. */
  readonly pem: string;
  sign(
    payload: Record<string, unknown>,
    header?: Record<string, unknown>,
  ): Promise<string>;
}

export async function testPrivyApp(): Promise<TestPrivyApp> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const spki = new Uint8Array(
    (await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer,
  );
  const body = btoa(String.fromCharCode(...spki)).replace(/(.{64})/g, "$1\n");
  return {
    pem: `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`,
    async sign(payload, header = { alg: "ES256", typ: "JWT", kid: "test" }) {
      const signed = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        new TextEncoder().encode(signed),
      );
      return `${signed}.${base64Url(new Uint8Array(signature))}`;
    },
  };
}

/** Claims a real Privy access token carries. */
export function accessClaims(overrides: Record<string, unknown> = {}) {
  return {
    sid: "session-1",
    sub: TEST_DID,
    iss: "privy.io",
    aud: TEST_APP_ID,
    iat: seconds(TEST_NOW) - 60,
    exp: seconds(TEST_NOW) + 3600,
    ...overrides,
  };
}

/** Claims a real Privy identity token carries, in its compact account form. */
export function identityClaims(
  overrides: Record<string, unknown> = {},
  accounts: unknown[] = [discordAccount()],
) {
  return {
    sub: TEST_DID,
    iss: "privy.io",
    aud: TEST_APP_ID,
    iat: seconds(TEST_NOW) - 60,
    exp: seconds(TEST_NOW) + 3600,
    cr: String(seconds(TEST_NOW) - 86_400),
    linked_accounts: JSON.stringify(accounts),
    ...overrides,
  };
}
