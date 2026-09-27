/**
 * Sign-in as DexBot does it: Privy email login, and nothing stored anywhere.
 *
 * FrockBot's auth contract (`AuthPackageV1`, ADR 0038 §3) implemented outside
 * FrockBot. The shape follows FrockBot's Access Package: stateless, a token
 * verified with Web Crypto, a User id hashed from the provider's subject. What
 * Privy adds is a sign-in page, since nothing sits in front of the Worker to
 * sign people in for it:
 *
 * 1. `startSignIn` sends the browser to `/api/auth/privy/sign-in`.
 * 2. The page runs Privy's browser SDK: an email, a one-time code, and Privy
 *    hands the browser an access token and an identity token.
 * 3. The page posts both to `/api/auth/privy/session`. The Package verifies
 *    them, takes the verified email from the identity token, and sets its own
 *    signed session cookie.
 * 4. `getSession` reads that cookie on every request after.
 *
 * Every User it admits has a verified email, so FrockBot's email-keyed
 * admission applies unchanged (`admission: "authority"`).
 */
import type {
  AuthIdentityV1,
  AuthPackageBuildV1,
  AuthPackageV1,
} from "@frockbot/core/contracts";
import {
  PRIVY_API_ORIGIN_V1,
  ROUTE_PREFIX_V1,
  SESSION_PATH_V1,
  SIGN_IN_PAGE_CSP_V1,
  SIGN_IN_PATH_V1,
  SIGN_IN_SCRIPT_PATH_V1,
  SIGN_IN_STYLE_PATH_V1,
  SIGN_IN_STYLE_V1,
  safeReturnToV1,
  signInPageHtmlV1,
  type SignInScriptV1,
} from "./page.js";
import {
  SESSION_TTL_MS_V1,
  openSessionV1,
  sealSessionV1,
  sessionCookieHeaderV1,
  sessionCookieOfV1,
  sessionKeyV1,
} from "./session.js";
import {
  importPrivyVerificationKeyV1,
  verifyPrivyAccessTokenV1,
  verifyPrivyIdentityTokenV1,
} from "./token.js";

export { safeReturnToV1, type SignInScriptV1 } from "./page.js";
export { SESSION_COOKIE_V1, SESSION_TTL_MS_V1 } from "./session.js";
export {
  PrivyTokenError,
  verifyPrivyAccessTokenV1,
  verifyPrivyIdentityTokenV1,
} from "./token.js";

export interface PrivyEnvironmentV1 {
  /** The Privy app id; every Privy token must name it as its audience. */
  PRIVY_APP_ID?: string;
  /** The app's verification key from the Privy dashboard, as SPKI PEM. */
  PRIVY_VERIFICATION_KEY?: string;
  /** Signs this Package's session cookie. At least 32 characters. */
  PRIVY_SESSION_SECRET?: string;
  /** What the native sign-in door signs its codes and bearers with. */
  NATIVE_TOKEN_SECRET?: string;
}

/** The shortest `PRIVY_SESSION_SECRET` this Package will sign with. */
export const MIN_SESSION_SECRET_LENGTH_V1 = 32;

const NO_STORE: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
};

const SIGN_IN_FAILED = "Couldn't finish signing in. Please try again.";

function signInFailed(status = 400, message = SIGN_IN_FAILED): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

/**
 * The User id for a Privy identity.
 *
 * Derived from the Privy DID, which Privy keeps stable for a person, so the
 * same person reaches the same User on every sign-in without anything being
 * stored. Hashed, as FrockBot's `accessUserIdV1` hashes Access's subject,
 * because a User id names a Durable Object and appears in a URL, and a DID is
 * not bound to that shape.
 */
export async function privyUserIdV1(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`dexbot-privy-identity-v1:${subject}`),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `privy-${hex.slice(0, 32)}`;
}

function unconfigured(): AuthPackageV1 {
  const refuse = () =>
    Promise.resolve(
      Response.json(
        { error: "authentication is not configured" },
        { status: 503, headers: NO_STORE },
      ),
    );
  return {
    handler: refuse,
    getSession: () => Promise.resolve(null),
    signOut: refuse,
    startSignIn: refuse,
  };
}

function logRefusal(what: string, error: unknown): void {
  // A refused token is an unauthenticated request, not an outage: the reason
  // goes to the operator, and the visitor is told only that it failed.
  console.error(
    `Privy ${what} refused: ${error instanceof Error ? error.message : String(error)}`,
  );
}

async function readSessionRequest(
  request: Request,
): Promise<{ accessToken: string; identityToken: string; returnTo?: string }> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new Error("body is not JSON");
  }
  const text = await request.text();
  if (text.length > 32_768) throw new Error("body is too large");
  const body: unknown = JSON.parse(text);
  if (!body || typeof body !== "object") throw new Error("body is not a map");
  const { accessToken, identityToken, returnTo } = body as Record<
    string,
    unknown
  >;
  if (typeof accessToken !== "string" || typeof identityToken !== "string") {
    throw new Error("body carries no tokens");
  }
  return {
    accessToken,
    identityToken,
    ...(typeof returnTo === "string" ? { returnTo } : {}),
  };
}

/** Whether a state-changing request came from this origin's own page. */
function sameOrigin(request: Request, origin: string): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  return request.headers.get("origin") === origin;
}

export interface PrivyPackageOptionsV1 {
  /** The bundled sign-in script the page loads. */
  readonly signInScript: SignInScriptV1;
  readonly now?: () => number;
  /** How long a session lasts; seven days unless a test says otherwise. */
  readonly sessionTtlMs?: number;
}

export function createPrivyPackageV1(
  environment: PrivyEnvironmentV1,
  options: PrivyPackageOptionsV1,
): AuthPackageV1 {
  const appId = environment.PRIVY_APP_ID?.trim();
  const verificationKey = environment.PRIVY_VERIFICATION_KEY?.trim();
  const sessionSecret = environment.PRIVY_SESSION_SECRET;
  if (
    !appId ||
    !verificationKey ||
    !sessionSecret ||
    sessionSecret.length < MIN_SESSION_SECRET_LENGTH_V1
  )
    return unconfigured();
  const now = options.now ?? Date.now;
  const ttlMs = options.sessionTtlMs ?? SESSION_TTL_MS_V1;
  const { signInScript } = options;

  // Imported when first needed, once per isolate: a key that will not import
  // fails every sign-in, and the log says why each time.
  let privyKey: Promise<CryptoKey> | undefined;
  const getPrivyKey = () =>
    (privyKey ??= importPrivyVerificationKeyV1(verificationKey).catch(
      (error: unknown) => {
        privyKey = undefined;
        throw error;
      },
    ));
  let cookieKey: Promise<CryptoKey> | undefined;
  const getCookieKey = () => (cookieKey ??= sessionKeyV1(sessionSecret));

  async function mintSession(request: Request, origin: string) {
    if (!sameOrigin(request, origin)) return signInFailed(403);
    let body: Awaited<ReturnType<typeof readSessionRequest>>;
    try {
      body = await readSessionRequest(request);
    } catch (error) {
      logRefusal("session request", error);
      return signInFailed(400);
    }
    let email: string;
    let subject: string;
    try {
      const verification = { key: await getPrivyKey(), appId: appId!, now };
      const [access, identity] = await Promise.all([
        verifyPrivyAccessTokenV1(body.accessToken, verification),
        verifyPrivyIdentityTokenV1(body.identityToken, verification),
      ]);
      if (access.subject !== identity.subject) {
        throw new Error("access and identity tokens name different people");
      }
      subject = access.subject;
      email = identity.email;
    } catch (error) {
      logRefusal("sign-in", error);
      return signInFailed(401);
    }
    const value = await sealSessionV1(await getCookieKey(), {
      userId: await privyUserIdV1(subject),
      email,
      expiresAt: now() + ttlMs,
    });
    const headers = new Headers(NO_STORE);
    headers.append("set-cookie", sessionCookieHeaderV1(value, ttlMs / 1000));
    return Response.json(
      { location: safeReturnToV1(body.returnTo, origin) },
      { headers },
    );
  }

  return {
    handler: async (request) => {
      const url = new URL(request.url);
      const { pathname } = url;
      if (pathname === SESSION_PATH_V1) {
        if (request.method !== "POST") return signInFailed(405);
        return mintSession(request, url.origin);
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        return signInFailed(405);
      if (pathname === SIGN_IN_PATH_V1) {
        return new Response(
          signInPageHtmlV1({
            appId: appId!,
            returnTo: safeReturnToV1(
              url.searchParams.get("returnTo"),
              url.origin,
            ),
            signedOut: url.searchParams.has("signed-out"),
            scriptHash: signInScript.hash,
          }),
          {
            headers: {
              ...NO_STORE,
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": SIGN_IN_PAGE_CSP_V1,
              "x-content-type-options": "nosniff",
              "x-frame-options": "DENY",
            },
          },
        );
      }
      if (pathname === SIGN_IN_SCRIPT_PATH_V1) {
        // Versioned by content, so a matching URL may be cached forever.
        const current = url.searchParams.get("v") === signInScript.hash;
        return new Response(signInScript.source, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "x-content-type-options": "nosniff",
            "cache-control": current
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          },
        });
      }
      if (pathname === SIGN_IN_STYLE_PATH_V1) {
        return new Response(SIGN_IN_STYLE_V1, {
          headers: {
            "content-type": "text/css; charset=utf-8",
            "x-content-type-options": "nosniff",
            "cache-control": "public, max-age=3600",
          },
        });
      }
      return signInFailed(404, "Not found.");
    },
    getSession: async (headers): Promise<AuthIdentityV1 | null> => {
      const value = sessionCookieOfV1(headers);
      if (!value) return null;
      const session = await openSessionV1(await getCookieKey(), value, now);
      if (!session) return null;
      return {
        user: {
          id: session.userId,
          email: session.email,
          // Only an email Privy verified with a one-time code is sealed.
          emailVerified: true,
        },
      };
    },
    // The cookie is ours to clear; Privy's own session lives in the browser's
    // storage, so the sign-in page ends that one when it sees `signed-out`.
    signOut: (request) => {
      const origin = new URL(request.url).origin;
      const headers = new Headers(NO_STORE);
      headers.set("location", `${origin}${SIGN_IN_PATH_V1}?signed-out`);
      headers.append("set-cookie", sessionCookieHeaderV1(null, 0));
      return Promise.resolve(new Response(null, { status: 303, headers }));
    },
    startSignIn: (request, returnTo) => {
      const origin = new URL(request.url).origin;
      const target = new URL(SIGN_IN_PATH_V1, origin);
      target.searchParams.set("returnTo", safeReturnToV1(returnTo, origin));
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { ...NO_STORE, location: target.toString() },
        }),
      );
    },
  };
}

const NATIVE_TOKEN_SECRET_V1 = {
  name: "NATIVE_TOKEN_SECRET",
  why: "Signs the native sign-in codes and bearer tokens. Absent, the phone and Mac cannot sign in.",
} as const;

/** This Package as a deployment builds it, over a bundled sign-in script. */
export function privyAuthPackageBuildV1(
  signInScript: SignInScriptV1,
): AuthPackageBuildV1<PrivyEnvironmentV1> {
  return {
    id: "privy",
    required: [
      {
        name: "PRIVY_APP_ID",
        why: "The Privy app people sign in to. Absent, a token Privy issued for another app would be accepted.",
      },
      {
        name: "PRIVY_VERIFICATION_KEY",
        why: "The Privy app's public key (SPKI PEM from the dashboard) that signs every Privy token.",
      },
      {
        name: "PRIVY_SESSION_SECRET",
        why: `Signs the session cookie (${MIN_SESSION_SECRET_LENGTH_V1}+ characters). Changing it signs everybody out.`,
      },
      NATIVE_TOKEN_SECRET_V1,
    ],
    // Privy lets anybody with an email sign up, so it is not an allowlist:
    // the deployment's admission authority decides, keyed on the verified
    // email every identity here carries.
    admission: "authority",
    nativeTokenSecret: {
      ...NATIVE_TOKEN_SECRET_V1,
      read: (environment) => environment.NATIVE_TOKEN_SECRET,
    },
    // Nothing is stored, so there is no identity to look up by User id, none
    // to list and none to forget, and no identity row to ask admission about.
    create: (environment) => createPrivyPackageV1(environment, { signInScript }),
  };
}

export { PRIVY_API_ORIGIN_V1, ROUTE_PREFIX_V1 };
