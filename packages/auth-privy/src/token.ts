/**
 * Privy's tokens, verified here rather than trusted.
 *
 * Privy signs two JWTs for a signed-in browser, both ES256 over the app's one
 * P-256 key, both with `iss: "privy.io"` and `aud` the app id:
 *
 * - the **access token** says who the person is (`sub`, their Privy DID) and
 *   that their Privy session is live (`sid`). It carries no email.
 * - the **identity token** carries the same `sub` and `linked_accounts`, a
 *   JSON string of the accounts Privy has verified for them. An email account
 *   appears there only once its one-time code was entered, which is what makes
 *   its address a verified email. The app must have "Return user data in an
 *   identity token" turned on for Privy to issue one.
 *
 * Web Crypto does the verification, so the Package brings no JWT library into
 * the Worker.
 */

/** Why a token was refused, for the Worker log. Never shown to a visitor. */
export class PrivyTokenError extends Error {
  override readonly name = "PrivyTokenError";
}

export const PRIVY_ISSUER_V1 = "privy.io";

/** The Privy app's verification key, as the dashboard shows it (SPKI PEM). */
export async function importPrivyVerificationKeyV1(
  pem: string,
): Promise<CryptoKey> {
  // A key pasted into a secret often arrives with its newlines escaped.
  const body = pem
    .replaceAll("\\n", "\n")
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) {
    throw new PrivyTokenError("verification key is not a PEM public key");
  }
  return crypto.subtle.importKey(
    "spki",
    Uint8Array.from(atob(body), (character) => character.charCodeAt(0)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

export function decodeBase64UrlV1(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new PrivyTokenError("token is not base64url");
  }
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0),
  );
}

function jsonSegment(segment: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(decodeBase64UrlV1(segment)));
  } catch (error) {
    if (error instanceof PrivyTokenError) throw error;
    throw new PrivyTokenError("token segment is not JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PrivyTokenError("token segment is not an object");
  }
  return value as Record<string, unknown>;
}

function audienceMatches(audience: unknown, expected: string): boolean {
  const claimed = Array.isArray(audience) ? audience : [audience];
  return claimed.some((value) => value === expected);
}

export interface PrivyVerificationV1 {
  readonly key: CryptoKey;
  /** The Privy app id; every token must name it as its audience. */
  readonly appId: string;
  readonly now?: () => number;
}

/**
 * The payload of a Privy-signed JWT, or a throw.
 *
 * Shape, algorithm, signature, audience, issuer, expiry and subject, in the
 * order a forged token fails them. The audience is what stops a token Privy
 * issued for another app from opening this one.
 */
async function verifyPrivyJwt(
  token: string,
  options: PrivyVerificationV1,
): Promise<Record<string, unknown> & { sub: string; exp: number }> {
  const now = options.now ?? Date.now;
  if (token.length > 8192) throw new PrivyTokenError("token is too long");
  const parts = token.split(".");
  if (parts.length !== 3) throw new PrivyTokenError("token is not a JWT");
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];
  const header = jsonSegment(encodedHeader);
  if (header.alg !== "ES256") {
    throw new PrivyTokenError(`token algorithm ${String(header.alg)}`);
  }
  // ES256 signs as raw r‖s, which is what Web Crypto's ECDSA verifies.
  const signature = decodeBase64UrlV1(encodedSignature);
  if (signature.length !== 64) {
    throw new PrivyTokenError("token signature is not ES256");
  }
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    options.key,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!verified) throw new PrivyTokenError("token signature does not verify");
  const payload = jsonSegment(encodedPayload);
  if (!audienceMatches(payload.aud, options.appId)) {
    throw new PrivyTokenError("token is for another Privy app");
  }
  if (payload.iss !== PRIVY_ISSUER_V1) {
    throw new PrivyTokenError("token is not from Privy");
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now()) {
    throw new PrivyTokenError("token has expired");
  }
  if (typeof payload.nbf === "number" && payload.nbf * 1000 > now()) {
    throw new PrivyTokenError("token is not valid yet");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new PrivyTokenError("token names no identity");
  }
  return payload as Record<string, unknown> & { sub: string; exp: number };
}

/** A verified Privy access token's claims. */
export interface PrivyAccessClaimsV1 {
  /** The Privy DID, stable for the person for the life of the app. */
  readonly subject: string;
  readonly expiresAt: number;
}

export async function verifyPrivyAccessTokenV1(
  token: string,
  options: PrivyVerificationV1,
): Promise<PrivyAccessClaimsV1> {
  const payload = await verifyPrivyJwt(token, options);
  // An identity token is signed by the same key for the same audience; `sid`
  // is what only an access token carries, so one cannot stand in for the other.
  if (typeof payload.sid !== "string" || payload.sid.length === 0) {
    throw new PrivyTokenError("token is not an access token");
  }
  return { subject: payload.sub, expiresAt: payload.exp * 1000 };
}

/** A verified Privy identity token's claims, reduced to what sign-in needs. */
export interface PrivyIdentityClaimsV1 {
  readonly subject: string;
  /** The email account Privy verified for this person. */
  readonly email: string;
}

/**
 * The verified email in an identity token's `linked_accounts`, or a throw.
 *
 * Privy writes each account compactly: an email one is
 * `{ type: "email", address, lv }`, `lv` being when it was last verified
 * (`@privy-io/node` maps it to `verified_at`, which is also accepted). An
 * account without a verification time is not taken as verified.
 */
function verifiedEmailOf(payload: Record<string, unknown>): string {
  if (typeof payload.linked_accounts !== "string") {
    throw new PrivyTokenError("token carries no linked accounts");
  }
  let accounts: unknown;
  try {
    accounts = JSON.parse(payload.linked_accounts);
  } catch {
    throw new PrivyTokenError("token's linked accounts are not JSON");
  }
  if (!Array.isArray(accounts)) {
    throw new PrivyTokenError("token's linked accounts are not a list");
  }
  for (const account of accounts as unknown[]) {
    if (!account || typeof account !== "object") continue;
    const { type, address, lv, verified_at } = account as Record<
      string,
      unknown
    >;
    if (type !== "email" || typeof address !== "string") continue;
    if (typeof lv !== "number" && typeof verified_at !== "number") continue;
    const email = address.trim();
    if (/^[^\s@]+@[^\s@]+$/.test(email)) return email;
  }
  throw new PrivyTokenError("token carries no verified email");
}

export async function verifyPrivyIdentityTokenV1(
  token: string,
  options: PrivyVerificationV1,
): Promise<PrivyIdentityClaimsV1> {
  const payload = await verifyPrivyJwt(token, options);
  return { subject: payload.sub, email: verifiedEmailOf(payload) };
}
