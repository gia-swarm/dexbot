import { expect, test } from "bun:test";
import { AUTH_PACKAGE_V1 } from "./auth-package.privy.js";

test("the chooser exports the Privy build over the bundled sign-in script", async () => {
  expect(AUTH_PACKAGE_V1.id).toBe("privy");
  const privy = AUTH_PACKAGE_V1.create({
    PRIVY_APP_ID: "app",
    PRIVY_VERIFICATION_KEY: "key",
    PRIVY_SESSION_SECRET: "s".repeat(32),
  });
  const page = await (
    await privy.handler(new Request("https://dex.example/api/auth/privy/sign-in"))
  ).text();
  const src = /src="([^"]+)"/.exec(page)?.[1];
  expect(src).toStartWith("/api/auth/privy/sign-in.js?v=");
  const script = await privy.handler(new Request(`https://dex.example${src!.replaceAll("&amp;", "&")}`));
  expect(script.headers.get("cache-control")).toContain("immutable");
  // The real Privy SDK, not a placeholder.
  expect((await script.text()).length).toBeGreaterThan(100_000);
});
