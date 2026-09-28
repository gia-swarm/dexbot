import { expect, test } from "bun:test";
import { join } from "node:path";
import { decodeBrandV1 } from "@frockbot/core/contracts";
import { contrastRatioV1 } from "@frockbot/core/theme";
import { BRAND_V1 } from "./brand.ts";

test("FrockBot's decoder accepts the brand, contrast floor included", () => {
  expect(() => decodeBrandV1(BRAND_V1)).not.toThrow();
});

test("every look's accent reads as text on its own window", () => {
  // The floor checks text on the accent, not the accent on the page; links and
  // selected states need that too.
  for (const document of Object.values(BRAND_V1.looks)) {
    const { accent, window } = document.tokens.surfaces;
    expect(contrastRatioV1(accent, window)).toBeGreaterThanOrEqual(4.5);
  }
});

test("the page logo is the icon's bytes", async () => {
  const icon = await Bun.file(join(import.meta.dir, BRAND_V1.iconPng)).bytes();
  expect(BRAND_V1.pageLogo).toBe(
    `data:image/png;base64,${Buffer.from(icon).toString("base64")}`,
  );
});

test("the scheme matches the Flutter app's", async () => {
  const identity = await Bun.file(
    join(import.meta.dir, "../../../app/identity.xcconfig"),
  ).text();
  expect(identity).toMatch(
    new RegExp(`^DEXBOT_URL_SCHEME\\s*=\\s*${BRAND_V1.nativeScheme}\\s*$`, "m"),
  );
});
