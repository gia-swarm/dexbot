import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
  MIN_SESSION_SECRET_LENGTH_V1,
  SESSION_COOKIE_V1,
  SESSION_TTL_MS_V1,
  createPrivyPackageV1,
  privyAuthPackageBuildV1,
  privyUserIdV1,
  safeReturnToV1,
  type PrivyEnvironmentV1,
} from "./index.js";
import { SIGN_IN_PAGE_CSP_V1 } from "./page.js";
import { openSessionV1, sealSessionV1, sessionKeyV1 } from "./session.js";
import {
  TEST_APP_ID,
  TEST_DID,
  TEST_EMAIL,
  TEST_NOW,
  accessClaims,
  identityClaims,
  testPrivyApp,
  type TestPrivyApp,
} from "./privy.fixture.js";

const ORIGIN = "https://dex.example";
const SECRET = "s".repeat(MIN_SESSION_SECRET_LENGTH_V1);
const SCRIPT = { source: "console.log('sign-in')", hash: "abc123" };

let app: TestPrivyApp;
let environment: PrivyEnvironmentV1;
let clock = TEST_NOW;
const now = () => clock;

beforeAll(async () => {
  app = await testPrivyApp();
  environment = {
    PRIVY_APP_ID: TEST_APP_ID,
    PRIVY_VERIFICATION_KEY: app.pem,
    PRIVY_SESSION_SECRET: SECRET,
    NATIVE_TOKEN_SECRET: "native",
  };
});

// Refusals are logged for the operator; keep the test output quiet.
spyOn(console, "error").mockImplementation(() => {});

function auth() {
  clock = TEST_NOW;
  return createPrivyPackageV1(environment, { signInScript: SCRIPT, now });
}

function sessionRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}/api/auth/privy/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function validBody(extra: Record<string, unknown> = {}) {
  return {
    accessToken: await app.sign(accessClaims()),
    identityToken: await app.sign(identityClaims()),
    ...extra,
  };
}

function cookieOf(response: Response): string {
  const header = response.headers.getSetCookie()[0] ?? "";
  return header.split(";")[0]!.slice(`${SESSION_COOKIE_V1}=`.length);
}

function withCookie(value: string): Headers {
  return new Headers({ cookie: `other=1; ${SESSION_COOKIE_V1}=${value}` });
}

describe("signing in", () => {
  test("a verified Privy sign-in sets a session getSession reads", async () => {
    const privy = auth();
    const response = await privy.handler(
      sessionRequest(await validBody({ returnTo: "/native/complete?request=abc" })),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ location: "/native/complete?request=abc" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const setCookie = response.headers.getSetCookie()[0]!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain(`Max-Age=${SESSION_TTL_MS_V1 / 1000}`);

    const identity = await privy.getSession(withCookie(cookieOf(response)));
    expect(identity).toEqual({
      user: { id: await privyUserIdV1(TEST_DID), email: TEST_EMAIL, emailVerified: true },
    });
  });

  test("the User id is stable, prefixed and URL-safe", async () => {
    const id = await privyUserIdV1(TEST_DID);
    expect(id).toMatch(/^privy-[0-9a-f]{32}$/);
    expect(await privyUserIdV1(TEST_DID)).toBe(id);
    expect(await privyUserIdV1("did:privy:someone-else")).not.toBe(id);
  });

  test("an absolute returnTo on this origin becomes a path", async () => {
    const response = await auth().handler(
      sessionRequest(await validBody({ returnTo: `${ORIGIN}/native/complete?request=x` })),
    );
    expect(await response.json()).toEqual({ location: "/native/complete?request=x" });
  });

  test("a returnTo elsewhere goes home instead", async () => {
    const response = await auth().handler(
      sessionRequest(await validBody({ returnTo: "https://evil.example/" })),
    );
    expect(await response.json()).toEqual({ location: "/" });
  });

  const refusals: [string, () => Promise<Record<string, unknown>>][] = [
    ["an expired access token", async () => validBody({
      accessToken: await app.sign(accessClaims({ exp: Math.floor(TEST_NOW / 1000) - 1 })),
    })],
    ["an access token for another app", async () => validBody({
      accessToken: await app.sign(accessClaims({ aud: "other-app" })),
    })],
    ["an access token from another issuer", async () => validBody({
      accessToken: await app.sign(accessClaims({ iss: "not-privy" })),
    })],
    ["a token signed by another key", async () => validBody({
      accessToken: await (await testPrivyApp()).sign(accessClaims()),
    })],
    ["an identity with no email", async () => validBody({
      identityToken: await app.sign(identityClaims({}, [{ type: "wallet", address: "0x1", lv: 1 }])),
    })],
    ["tokens for two different people", async () => validBody({
      identityToken: await app.sign(identityClaims({ sub: "did:privy:someone-else" })),
    })],
    ["an identity token in the access slot", async () => validBody({
      accessToken: await app.sign(identityClaims()),
    })],
  ];
  for (const [name, body] of refusals) {
    test(`${name} is refused and sets no cookie`, async () => {
      const response = await auth().handler(sessionRequest(await body()));
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await response.json()).toEqual({
        error: "Couldn't finish signing in. Please try again.",
      });
    });
  }

  test("a cross-site post is refused before any token is read", async () => {
    const privy = auth();
    for (const headers of [
      { origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site" },
      { origin: "" },
    ]) {
      const response = await privy.handler(sessionRequest(await validBody(), headers));
      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  test("a malformed body is refused", async () => {
    const privy = auth();
    expect((await privy.handler(sessionRequest("{nope"))).status).toBe(400);
    expect((await privy.handler(sessionRequest({ accessToken: "x" }))).status).toBe(400);
    expect(
      (await privy.handler(sessionRequest(await validBody(), { "content-type": "text/plain" })))
        .status,
    ).toBe(400);
    expect((await privy.handler(sessionRequest("x".repeat(40_000)))).status).toBe(400);
  });

  test("the session route only takes POST", async () => {
    const response = await auth().handler(new Request(`${ORIGIN}/api/auth/privy/session`));
    expect(response.status).toBe(405);
  });
});

describe("the session cookie", () => {
  async function signedIn() {
    const privy = auth();
    const response = await privy.handler(sessionRequest(await validBody()));
    return { privy, value: cookieOf(response) };
  }

  test("expires after its lifetime", async () => {
    const { privy, value } = await signedIn();
    clock = TEST_NOW + SESSION_TTL_MS_V1 - 1;
    expect(await privy.getSession(withCookie(value))).not.toBeNull();
    clock = TEST_NOW + SESSION_TTL_MS_V1;
    expect(await privy.getSession(withCookie(value))).toBeNull();
  });

  test("outlives the Privy access token it was minted from", async () => {
    const { privy, value } = await signedIn();
    clock = TEST_NOW + 2 * 3600 * 1000;
    expect(await privy.getSession(withCookie(value))).not.toBeNull();
  });

  test("a tampered payload is refused", async () => {
    const { privy, value } = await signedIn();
    const [format, body, signature] = value.split(".");
    const claims = JSON.parse(atob(body!.replaceAll("-", "+").replaceAll("_", "/")));
    const forged = btoa(JSON.stringify({ ...claims, u: "privy-attacker", e: "a@evil.example" }))
      .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    expect(await privy.getSession(withCookie(`${format}.${forged}.${signature}`))).toBeNull();
  });

  test("a tampered signature is refused", async () => {
    const { privy, value } = await signedIn();
    const flipped = value.slice(0, -2) + (value.endsWith("A") ? "BB" : "AA");
    expect(await privy.getSession(withCookie(flipped))).toBeNull();
    expect(await privy.getSession(withCookie(value.split(".").slice(0, 2).join(".")))).toBeNull();
  });

  test("a cookie signed with another secret is refused", async () => {
    const { value } = await signedIn();
    const other = createPrivyPackageV1(
      { ...environment, PRIVY_SESSION_SECRET: "t".repeat(40) },
      { signInScript: SCRIPT, now },
    );
    expect(await other.getSession(withCookie(value))).toBeNull();
  });

  test("an extended expiry cannot be forged", async () => {
    const key = await sessionKeyV1("u".repeat(40));
    const forged = await sealSessionV1(key, {
      userId: "privy-x",
      email: TEST_EMAIL,
      expiresAt: TEST_NOW + 10 * SESSION_TTL_MS_V1,
    });
    expect(await auth().getSession(withCookie(forged))).toBeNull();
    expect(await openSessionV1(key, forged, now)).not.toBeNull();
  });

  test("garbage and absence are nobody", async () => {
    const privy = auth();
    expect(await privy.getSession(new Headers())).toBeNull();
    for (const value of ["", "v1", "v1.a.b", "v2.a.b", "!!!.@@@.###", "x".repeat(5000)]) {
      expect(await privy.getSession(withCookie(value))).toBeNull();
    }
  });
});

describe("sign-in and sign-out redirects", () => {
  test("startSignIn sends the browser to the sign-in page with its returnTo", async () => {
    const response = await auth().startSignIn(
      new Request(`${ORIGIN}/native/authorize?request=abc`),
      `${ORIGIN}/native/complete?request=abc`,
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/api/auth/privy/sign-in");
    expect(location.searchParams.get("returnTo")).toBe("/native/complete?request=abc");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("startSignIn will not carry a foreign returnTo", async () => {
    const response = await auth().startSignIn(
      new Request(`${ORIGIN}/native/authorize`),
      "https://evil.example/steal",
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("returnTo")).toBe("/");
  });

  test("signOut clears the cookie and ends Privy's session on the page", async () => {
    const response = await auth().signOut(
      new Request(`${ORIGIN}/sign-out`),
      new URL(`${ORIGIN}/sign-out`),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/api/auth/privy/sign-in?signed-out`);
    const cleared = response.headers.getSetCookie()[0]!;
    expect(cleared).toStartWith(`${SESSION_COOKIE_V1}=;`);
    expect(cleared).toContain("Max-Age=0");
  });
});

describe("the sign-in page", () => {
  test("is served with a strict policy and its settings in data attributes", async () => {
    const response = await auth().handler(
      new Request(`${ORIGIN}/api/auth/privy/sign-in?returnTo=${encodeURIComponent('/x?a="><script>')}`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(SIGN_IN_PAGE_CSP_V1);
    expect(SIGN_IN_PAGE_CSP_V1).toContain("script-src 'self'");
    expect(SIGN_IN_PAGE_CSP_V1).not.toContain("unsafe");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    const html = await response.text();
    expect(html).toContain(`data-app-id="${TEST_APP_ID}"`);
    expect(html).toContain('data-return-to="/x?a=%22%3E%3Cscript%3E"');
    expect(html).toContain(`src="/api/auth/privy/sign-in.js?v=${SCRIPT.hash}"`);
    expect(html).not.toContain("data-signed-out");
    // No inline script or style for the policy to have to allow.
    expect(html).not.toMatch(/<script>|<script type="module">|<style|style=/);
  });

  test("escapes whatever reaches an attribute", async () => {
    const response = await auth().handler(
      new Request(`${ORIGIN}/api/auth/privy/sign-in?returnTo=${encodeURIComponent("/p#\"'<>&")}`),
    );
    const html = await response.text();
    expect(html).toContain('data-return-to="/p#%22\'%3C%3E&amp;"'.replace("'", "&#39;"));
  });

  test("a foreign returnTo on the page becomes home", async () => {
    const html = await (
      await auth().handler(
        new Request(`${ORIGIN}/api/auth/privy/sign-in?returnTo=//evil.example/x`),
      )
    ).text();
    expect(html).toContain('data-return-to="/"');
  });

  test("marks a signed-out visit", async () => {
    const html = await (
      await auth().handler(new Request(`${ORIGIN}/api/auth/privy/sign-in?signed-out`))
    ).text();
    expect(html).toContain("data-signed-out");
  });

  test("serves the script, cached forever only at its current version", async () => {
    const privy = auth();
    const current = await privy.handler(
      new Request(`${ORIGIN}/api/auth/privy/sign-in.js?v=${SCRIPT.hash}`),
    );
    expect(await current.text()).toBe(SCRIPT.source);
    expect(current.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(current.headers.get("cache-control")).toContain("immutable");
    const stale = await privy.handler(new Request(`${ORIGIN}/api/auth/privy/sign-in.js?v=old`));
    expect(stale.headers.get("cache-control")).toBe("no-cache");
  });

  test("serves the stylesheet", async () => {
    const response = await auth().handler(new Request(`${ORIGIN}/api/auth/privy/sign-in.css`));
    expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8");
  });

  test("anything else under /api/auth is not found", async () => {
    const privy = auth();
    expect((await privy.handler(new Request(`${ORIGIN}/api/auth/privy/nope`))).status).toBe(404);
    expect((await privy.handler(new Request(`${ORIGIN}/api/auth/sign-in/social`))).status).toBe(404);
    expect(
      (await privy.handler(new Request(`${ORIGIN}/api/auth/privy/sign-in`, { method: "POST" })))
        .status,
    ).toBe(405);
  });
});

describe("safeReturnToV1", () => {
  const cases: [string | null, string][] = [
    [null, "/"],
    ["", "/"],
    ["/", "/"],
    ["/native/settings?request=a#b", "/native/settings?request=a#b"],
    [`${ORIGIN}/x`, "/x"],
    ["https://evil.example/x", "/"],
    ["//evil.example/x", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["http://dex.example/x", "/"],
    ["/api/auth/privy/sign-in", "/"],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(safeReturnToV1(input, ORIGIN)).toBe(expected);
    });
  }
});

describe("configuration", () => {
  const missing: [string, Record<string, string | undefined>][] = [
    ["no app id", { PRIVY_APP_ID: undefined }],
    ["no verification key", { PRIVY_VERIFICATION_KEY: " " }],
    ["no session secret", { PRIVY_SESSION_SECRET: undefined }],
    ["a short session secret", { PRIVY_SESSION_SECRET: "short" }],
  ];
  for (const [name, change] of missing) {
    test(`${name} answers 503 on every route and knows nobody`, async () => {
      const privy = createPrivyPackageV1({ ...environment, ...change }, { signInScript: SCRIPT });
      const request = new Request(`${ORIGIN}/api/auth/privy/sign-in`);
      expect((await privy.handler(request)).status).toBe(503);
      expect((await privy.startSignIn(request, "/")).status).toBe(503);
      expect((await privy.signOut(request, new URL(request.url))).status).toBe(503);
      expect(await privy.getSession(withCookie("v1.a.b"))).toBeNull();
    });
  }

  test("a verification key that will not import fails sign-in, not the Worker", async () => {
    const privy = createPrivyPackageV1(
      { ...environment, PRIVY_VERIFICATION_KEY: "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----" },
      { signInScript: SCRIPT, now },
    );
    const response = await privy.handler(sessionRequest(await validBody()));
    expect(response.status).toBe(401);
  });
});

describe("the build", () => {
  const build = privyAuthPackageBuildV1(SCRIPT);

  test("declares itself as FrockBot's contract asks", () => {
    expect(build.id).toBe("privy");
    expect(build.admission).toBe("authority");
    expect(build.required.map((setting) => setting.name)).toEqual([
      "PRIVY_APP_ID",
      "PRIVY_VERIFICATION_KEY",
      "PRIVY_SESSION_SECRET",
      "NATIVE_TOKEN_SECRET",
    ]);
    for (const setting of build.required) expect(setting.why.length).toBeGreaterThan(10);
    expect(build.nativeTokenSecret.name).toBe("NATIVE_TOKEN_SECRET");
    expect(build.nativeTokenSecret.read(environment)).toBe("native");
  });

  test("stores nothing, so declares none of the stored-identity members", () => {
    const privy = build.create(environment);
    expect(privy.storedIdentity).toBeUndefined();
    expect(privy.listStoredIdentities).toBeUndefined();
    expect(privy.deleteStoredIdentity).toBeUndefined();
  });
});
