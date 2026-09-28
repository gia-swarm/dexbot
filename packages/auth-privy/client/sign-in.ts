/**
 * The sign-in page's one script: Privy email login, then hand the Worker the
 * tokens so it can set its own session cookie.
 *
 * Bundled with Privy's vanilla SDK (`@privy-io/js-sdk-core`) by
 * `scripts/build-sign-in.ts`. Everything it needs is in the body's `data-`
 * attributes, so the page carries no inline script.
 */
import Privy, { LocalStorage } from "@privy-io/js-sdk-core";

const FAILED = "Couldn't finish signing in. Please try again.";

const data = document.body.dataset;
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const emailForm = element<HTMLFormElement>("email-form");
const codeForm = element<HTMLFormElement>("code-form");
const emailInput = element<HTMLInputElement>("email");
const codeInput = element<HTMLInputElement>("code");
const codeSent = element<HTMLParagraphElement>("code-sent");
const status = element<HTMLParagraphElement>("status");

function say(message: string): void {
  status.textContent = message;
}

function busy(form: HTMLFormElement, value: boolean): void {
  for (const control of form.querySelectorAll("button, input"))
    (control as HTMLButtonElement | HTMLInputElement).disabled = value;
}

function showEmail(): void {
  codeForm.hidden = true;
  emailForm.hidden = false;
  emailInput.focus();
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

emailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  busy(emailForm, true);
  try {
    await privy.auth.email.sendCode(email);
    codeSent.textContent = `We sent a code to ${email}.`;
    emailForm.hidden = true;
    codeForm.hidden = false;
    codeInput.value = "";
    codeInput.focus();
    say("");
  } catch (error) {
    console.error(error);
    say("Couldn't send a code to that email. Check it and try again.");
  } finally {
    busy(emailForm, false);
  }
});

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  busy(codeForm, true);
  try {
    await privy.auth.email.loginWithCode(
      emailInput.value.trim(),
      codeInput.value.trim(),
    );
    await finish();
  } catch (error) {
    console.error(error);
    say(FAILED);
    busy(codeForm, false);
  }
});

element<HTMLButtonElement>("restart").addEventListener("click", () => {
  say("");
  showEmail();
});

try {
  await privy.initialize();
  if ("signedOut" in data) {
    // The Worker has cleared its cookie; end Privy's session too, or the next
    // visit here would sign the same person straight back in.
    await privy.auth.logout().catch((error: unknown) => console.error(error));
    say("You're signed out.");
    showEmail();
  } else if (await privy.getAccessToken()) {
    // Still signed in to Privy from an earlier visit.
    await finish();
  } else {
    say("");
    showEmail();
  }
} catch (error) {
  console.error(error);
  say(FAILED);
  showEmail();
}
