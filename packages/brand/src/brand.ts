/**
 * DexBot's brand: what a person sees of the product on the server's side.
 *
 * The deployment profile names this module, and the generated wrangler config
 * aliases FrockBot's `#brand` seam to it (FrockBot ADR 0038 §2). This is the
 * one place the server says "DexBot".
 *
 * The looks follow dexfi.com, which is dark-only: `ink` is DexFi's own
 * palette and the default look, and `paper` and `studio` are a light
 * derivation of it. FrockBot's decoder holds each to its contrast floor.
 */
import type { BrandV1 } from "@frockbot/core/contracts";
import type { ThemeTokensV1 } from "@frockbot/core/theme";
import { DEXBOT_PAGE_LOGO_V1 } from "./page-logo.ts";

export const DEXBOT_INK_TOKENS_V1: ThemeTokensV1 = {
  surfaces: {
    window: "#111d28",
    surface: "#152231",
    raised: "#1c2d41",
    text: "#ffffff",
    muted: "#91a2af",
    line: "#25394f",
    accent: "#4d9edc",
    // DexFi puts white on this blue, which is under 3:1. Its page navy passes.
    onAccent: "#111d28",
  },
  type: "inter",
  bubbles: { bot: "raised", me: "tint" },
};

export const DEXBOT_PAPER_TOKENS_V1: ThemeTokensV1 = {
  surfaces: {
    window: "#f3f6f9",
    surface: "#ffffff",
    raised: "#e8eef4",
    text: "#111d28",
    muted: "#52606d",
    line: "#d3dde6",
    // DexFi's button hover blue: its lighter blue fails as text on white.
    accent: "#3674a5",
    onAccent: "#ffffff",
  },
  type: "inter",
  bubbles: { bot: "raised", me: "tint" },
};

export const BRAND_V1: BrandV1 = {
  schemaVersion: 1,
  productName: "DexBot",
  homepage: "https://dexfi.com",
  builtInModelName: "Dex AI",
  emailSenderName: "DexBot",
  iconPng: "./icon.png",
  pageLogo: DEXBOT_PAGE_LOGO_V1,
  nativeScheme: "dexbot",
  looks: {
    ink: { schemaVersion: 1, look: "ink", tokens: DEXBOT_INK_TOKENS_V1 },
    paper: { schemaVersion: 1, look: "paper", tokens: DEXBOT_PAPER_TOKENS_V1 },
    studio: {
      schemaVersion: 1,
      look: "studio",
      tokens: { ...DEXBOT_PAPER_TOKENS_V1, bubbles: { bot: "plain", me: "tint" } },
    },
  },
  // What's New carries FrockBot's release notes, which aren't DexBot's.
  whatsNew: false,
};
