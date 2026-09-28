import { beforeAll, describe, expect, test } from "bun:test";
import {
  PrivyTokenError,
  importPrivyVerificationKeyV1,
  verifyPrivyAccessTokenV1,
  verifyPrivyIdentityTokenV1,
  type PrivyVerificationV1,
} from "./token.js";
import {
  TEST_APP_ID,
  TEST_DID,
  TEST_DISCORD_ID,
  TEST_EMAIL,
  TEST_NOW,
  accessClaims,
  discordAccount,
  identityClaims,
  testPrivyApp,
  type TestPrivyApp,
} from "./privy.fixture.js";

let app: TestPrivyApp;
let verification: PrivyVerificationV1;

beforeAll(async () => {
  app = await testPrivyApp();
  verification = {
    key: await importPrivyVerificationKeyV1(app.pem),
    appId: TEST_APP_ID,
    now: () => TEST_NOW,
  };
});

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PrivyTokenError);
    return (error as Error).message;
  }
  throw new Error("the token was accepted");
}

describe("access tokens", () => {
  test("a valid token names its Privy DID", async () => {
    const claims = await verifyPrivyAccessTokenV1(
      await app.sign(accessClaims()),
      verification,
    );
    expect(claims.subject).toBe(TEST_DID);
    expect(claims.expiresAt).toBe(accessClaims().exp * 1000);
  });

  test("an array audience naming the app is accepted", async () => {
    const token = await app.sign(accessClaims({ aud: ["other", TEST_APP_ID] }));
    expect((await verifyPrivyAccessTokenV1(token, verification)).subject).toBe(TEST_DID);
  });

  test("the key imports with escaped newlines, as a pasted secret has", async () => {
    const key = await importPrivyVerificationKeyV1(app.pem.replaceAll("\n", "\\n"));
    const claims = await verifyPrivyAccessTokenV1(
      await app.sign(accessClaims()),
      { ...verification, key },
    );
    expect(claims.subject).toBe(TEST_DID);
  });

  test("an expired token is refused", async () => {
    const exp = Math.floor(TEST_NOW / 1000);
    expect(
      await refusal(verifyPrivyAccessTokenV1(await app.sign(accessClaims({ exp })), verification)),
    ).toBe("token has expired");
  });

  test("a token with no expiry is refused", async () => {
    expect(
      await refusal(
        verifyPrivyAccessTokenV1(await app.sign(accessClaims({ exp: undefined })), verification),
      ),
    ).toBe("token has expired");
  });

  test("a token that is not valid yet is refused", async () => {
    const nbf = Math.floor(TEST_NOW / 1000) + 600;
    expect(
      await refusal(verifyPrivyAccessTokenV1(await app.sign(accessClaims({ nbf })), verification)),
    ).toBe("token is not valid yet");
  });

  test("a token for another Privy app is refused", async () => {
    expect(
      await refusal(
        verifyPrivyAccessTokenV1(await app.sign(accessClaims({ aud: "someone-else" })), verification),
      ),
    ).toBe("token is for another Privy app");
  });

  test("a token from another issuer is refused", async () => {
    expect(
      await refusal(
        verifyPrivyAccessTokenV1(await app.sign(accessClaims({ iss: "evil.io" })), verification),
      ),
    ).toBe("token is not from Privy");
  });

  test("a token signed by another key is refused", async () => {
    const other = await testPrivyApp();
    expect(
      await refusal(verifyPrivyAccessTokenV1(await other.sign(accessClaims()), verification)),
    ).toBe("token signature does not verify");
  });

  test("a tampered payload is refused", async () => {
    const [header, , signature] = (await app.sign(accessClaims())).split(".");
    const forged = btoa(JSON.stringify(accessClaims({ sub: "did:privy:attacker" })))
      .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    expect(
      await refusal(verifyPrivyAccessTokenV1(`${header}.${forged}.${signature}`, verification)),
    ).toBe("token signature does not verify");
  });

  test("alg none and other algorithms are refused", async () => {
    for (const alg of ["none", "HS256", "RS256"]) {
      const token = await app.sign(accessClaims(), { alg, typ: "JWT" });
      expect(await refusal(verifyPrivyAccessTokenV1(token, verification))).toBe(
        `token algorithm ${alg}`,
      );
    }
  });

  test("an unsigned token is refused", async () => {
    const [header, payload] = (await app.sign(accessClaims())).split(".");
    expect(
      await refusal(verifyPrivyAccessTokenV1(`${header}.${payload}.`, verification)),
    ).toBe("token signature is not ES256");
  });

  test("garbage is refused", async () => {
    expect(await refusal(verifyPrivyAccessTokenV1("not-a-jwt", verification))).toBe(
      "token is not a JWT",
    );
    expect(await refusal(verifyPrivyAccessTokenV1("a.b.c", verification))).toBe(
      "token segment is not JSON",
    );
    expect(await refusal(verifyPrivyAccessTokenV1("x".repeat(9000), verification))).toBe(
      "token is too long",
    );
  });

  test("a token naming nobody is refused", async () => {
    expect(
      await refusal(verifyPrivyAccessTokenV1(await app.sign(accessClaims({ sub: "" })), verification)),
    ).toBe("token names no identity");
  });

  test("an identity token cannot stand in for an access token", async () => {
    expect(
      await refusal(verifyPrivyAccessTokenV1(await app.sign(identityClaims()), verification)),
    ).toBe("token is not an access token");
  });
});

describe("identity tokens", () => {
  const discord = { subject: TEST_DISCORD_ID, username: "person" };

  test("a Discord sign-in yields its account and no email", async () => {
    const claims = await verifyPrivyIdentityTokenV1(
      await app.sign(identityClaims()),
      verification,
    );
    expect(claims).toEqual({ subject: TEST_DID, discord });
  });

  test("an email Privy verified comes along", async () => {
    const token = await app.sign(
      identityClaims({}, [
        discordAccount(),
        { type: "email", address: " person@example.com ", verified_at: 1 },
      ]),
    );
    expect(await verifyPrivyIdentityTokenV1(token, verification)).toEqual({
      subject: TEST_DID,
      discord,
      email: TEST_EMAIL,
    });
  });

  test("Discord's own email never counts", async () => {
    // Privy leaves it out today; if it ever appeared, Discord may not have
    // verified it.
    const token = await app.sign(identityClaims({}, [discordAccount({ email: TEST_EMAIL })]));
    expect((await verifyPrivyIdentityTokenV1(token, verification)).email).toBeUndefined();
  });

  test("an unverified or malformed email is left out", async () => {
    for (const email of [
      { type: "email", address: TEST_EMAIL },
      { type: "email", address: "nobody", lv: 1 },
      { type: "google_oauth", email: TEST_EMAIL, subject: "1", lv: 1 },
    ]) {
      const token = await app.sign(identityClaims({}, [discordAccount(), email]));
      expect((await verifyPrivyIdentityTokenV1(token, verification)).email).toBeUndefined();
    }
  });

  test("a person with no Discord account is refused", async () => {
    for (const accounts of [
      [{ type: "wallet", address: "0xabc", chain_type: "ethereum", lv: 1 }],
      [{ type: "email", address: TEST_EMAIL, lv: 1 }],
      [discordAccount({ lv: undefined })],
      [discordAccount({ subject: "" })],
      [],
    ]) {
      const token = await app.sign(identityClaims({}, accounts));
      expect(await refusal(verifyPrivyIdentityTokenV1(token, verification))).toBe(
        "token carries no Discord account",
      );
    }
  });

  test("a token without linked accounts is refused", async () => {
    expect(
      await refusal(verifyPrivyIdentityTokenV1(await app.sign(accessClaims()), verification)),
    ).toBe("token carries no linked accounts");
    const broken = await app.sign(identityClaims({ linked_accounts: "{not json" }));
    expect(await refusal(verifyPrivyIdentityTokenV1(broken, verification))).toBe(
      "token's linked accounts are not JSON",
    );
    const notList = await app.sign(identityClaims({ linked_accounts: "{}" }));
    expect(await refusal(verifyPrivyIdentityTokenV1(notList, verification))).toBe(
      "token's linked accounts are not a list",
    );
  });

  test("an expired or foreign identity token is refused", async () => {
    const exp = Math.floor(TEST_NOW / 1000) - 1;
    expect(
      await refusal(verifyPrivyIdentityTokenV1(await app.sign(identityClaims({ exp })), verification)),
    ).toBe("token has expired");
    expect(
      await refusal(
        verifyPrivyIdentityTokenV1(await app.sign(identityClaims({ aud: "x" })), verification),
      ),
    ).toBe("token is for another Privy app");
  });
});

test("a key that is not PEM is refused", async () => {
  await expect(importPrivyVerificationKeyV1("not a key!")).rejects.toThrow(
    "verification key is not a PEM public key",
  );
});
