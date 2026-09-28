/**
 * This Package's own session: a signed cookie, and nothing stored.
 *
 * Privy's tokens live an hour and sit in the browser's storage where the
 * Worker cannot read them on a plain navigation, so once a sign-in has proven
 * who somebody is, the Package mints a cookie of its own: the User id, the
 * verified email and an expiry, HMAC-signed with `PRIVY_SESSION_SECRET`.
 * Changing that secret signs everybody out, and is the only revocation there is.
 */
import { decodeBase64UrlV1 } from "./token.js";

export const SESSION_COOKIE_V1 = "__Host-privy-session";
/** How long a session lasts after sign-in, before Privy is asked again. */
export const SESSION_TTL_MS_V1 = 7 * 24 * 60 * 60 * 1000;
const FORMAT = "v1";

export interface PrivySessionV1 {
  readonly userId: string;
  readonly email: string;
  readonly expiresAt: number;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function sessionKeyV1(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** The cookie's value for a session. */
export async function sealSessionV1(
  key: CryptoKey,
  session: PrivySessionV1,
): Promise<string> {
  const body = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        u: session.userId,
        e: session.email,
        x: session.expiresAt,
      }),
    ),
  );
  const signed = `${FORMAT}.${body}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${encodeBase64Url(new Uint8Array(signature))}`;
}

/** The session a cookie value carries, or nothing if it is forged or stale. */
export async function openSessionV1(
  key: CryptoKey,
  value: string,
  now: () => number = Date.now,
): Promise<PrivySessionV1 | null> {
  if (value.length > 4096) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== FORMAT) return null;
  const [format, body, signature] = parts as [string, string, string];
  try {
    // Web Crypto's HMAC verify compares in constant time.
    const verified = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64UrlV1(signature),
      new TextEncoder().encode(`${format}.${body}`),
    );
    if (!verified) return null;
    const claims: unknown = JSON.parse(
      new TextDecoder().decode(decodeBase64UrlV1(body)),
    );
    if (!claims || typeof claims !== "object") return null;
    const { u, e, x } = claims as Record<string, unknown>;
    if (typeof u !== "string" || typeof e !== "string") return null;
    if (typeof x !== "number" || x <= now()) return null;
    return { userId: u, email: e, expiresAt: x };
  } catch {
    return null;
  }
}

/** The raw session cookie these headers carry, if any. */
export function sessionCookieOfV1(headers: Headers): string | undefined {
  for (const pair of headers.get("cookie")?.split(";") ?? []) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== SESSION_COOKIE_V1) continue;
    const value = pair.slice(separator + 1).trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * `Set-Cookie` for a session, or for clearing one.
 *
 * `__Host-` pins it to this origin and path `/`, and `SameSite=Lax` still
 * sends it on the top-level navigation that brings a browser back to the
 * native authorize page.
 */
export function sessionCookieHeaderV1(
  value: string | null,
  maxAgeSeconds: number,
): string {
  return [
    `${SESSION_COOKIE_V1}=${value ?? ""}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${value === null ? 0 : Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join("; ");
}
