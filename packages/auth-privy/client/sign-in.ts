/**
 * The sign-in page's one script: Discord through Privy, then hand the Worker
 * the tokens so it can set its own session cookie.
 *
 * Privy's OAuth flow leaves the page: the button sends the browser to Discord,
 * which comes back here with `privy_oauth_code` and `privy_oauth_state`, and
 * Privy trades those for its tokens. `returnTo` rides along in this page's own
 * URL, so it survives the round trip.
 *
 * Bundled with Privy's vanilla SDK (`@privy-io/js-sdk-core`) by
 * `scripts/build-sign-in.ts`. Everything it needs is in the body's `data-`
 * attributes, so the page carries no inline script.
 */
import Privy, { LocalStorage } from "@privy-io/js-sdk-core";

const FAILED = "Couldn't finish signing in. Please try again.";

const data = document.body.dataset;
const discord = document.getElementById("discord") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLParagraphElement;

function say(message: string): void {
  status.textContent = message;
}

function offer(message = ""): void {
  say(message);
  discord.disabled = false;
  discord.hidden = false;
}

const privy = new Privy({ appId: data.appId ?? "", storage: new LocalStorage() });

/** Trades Privy's tokens for the Worker's session, then goes back. */
async function finish(): Promise<void> {
  say("Signing in…");
  const [accessToken, identityToken] = await Promise.all([
    privy.getAccessToken(),
    privy.getIdentityToken(),
  ]);
  if (!accessToken || !identityToken) throw new Error("Privy issued no tokens");
  const response = await fetch(data.sessionPath ?? "", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken, identityToken, returnTo: data.returnTo }),
  });
  const answer: unknown = await response.json().catch(() => null);
  const location =
    answer && typeof answer === "object" && "location" in answer
      ? answer.location
      : undefined;
  if (!response.ok || typeof location !== "string") {
    throw new Error(`the session answered ${response.status}`);
  }
  window.location.assign(location);
}

/** Where Discord hands the browser back: this page, still carrying `returnTo`. */
function returnUrl(): string {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set("returnTo", data.returnTo ?? "/");
  return url.toString();
}

discord.addEventListener("click", async () => {
  discord.disabled = true;
  say("Opening Discord…");
  try {
    const { url } = await privy.auth.oauth.generateURL("discord", returnUrl());
    if (!url) throw new Error("Privy gave no Discord URL");
    window.location.assign(url);
  } catch (error) {
    console.error(error);
    offer("Couldn't reach Discord. Please try again.");
  }
});

try {
  await privy.initialize();
  const query = new URLSearchParams(window.location.search);
  const code = query.get("privy_oauth_code");
  const state = query.get("privy_oauth_state");
  if ("signedOut" in data) {
    // The Worker has cleared its cookie; end Privy's session too, or the next
    // visit here would sign the same person straight back in.
    await privy.auth.logout().catch((error: unknown) => console.error(error));
    offer("You're signed out.");
  } else if (code && state) {
    // Back from Discord. The code is single-use, so drop it from the address
    // before anything can fail and a reload try it again.
    window.history.replaceState(null, "", returnUrl());
    say("Signing in…");
    await privy.auth.oauth.loginWithCode(code, state, "discord");
    await finish();
  } else if (query.has("privy_oauth_error") || query.has("error")) {
    window.history.replaceState(null, "", returnUrl());
    offer("Discord sign-in was cancelled.");
  } else if (await privy.getAccessToken()) {
    // Still signed in to Privy from an earlier visit.
    await finish();
  } else {
    offer();
  }
} catch (error) {
  console.error(error);
  offer(FAILED);
}
