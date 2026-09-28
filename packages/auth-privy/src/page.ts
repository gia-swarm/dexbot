/**
 * The sign-in page this Package serves from `/api/auth/privy/*`.
 *
 * A static document, a stylesheet and one script, all from this origin, so the
 * policy can forbid inline code outright. Everything the script needs — the
 * Privy app id, where to go afterwards — rides in `data-` attributes.
 */

export const ROUTE_PREFIX_V1 = "/api/auth/privy";
export const SIGN_IN_PATH_V1 = `${ROUTE_PREFIX_V1}/sign-in`;
export const SIGN_IN_SCRIPT_PATH_V1 = `${ROUTE_PREFIX_V1}/sign-in.js`;
export const SIGN_IN_STYLE_PATH_V1 = `${ROUTE_PREFIX_V1}/sign-in.css`;
export const SESSION_PATH_V1 = `${ROUTE_PREFIX_V1}/session`;
/** The one host the bundled SDK talks to. Discord is reached by navigation. */
export const PRIVY_API_ORIGIN_V1 = "https://auth.privy.io";

/** The bundled sign-in script, and the hash its URL is versioned by. */
export interface SignInScriptV1 {
  readonly source: string;
  readonly hash: string;
}

export const SIGN_IN_PAGE_CSP_V1 = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  `connect-src 'self' ${PRIVY_API_ORIGIN_V1}`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Where a finished sign-in may send the browser: a path on this origin.
 *
 * Anything that resolves elsewhere — another host, a protocol-relative
 * `//host`, a `javascript:` URL — becomes `/`, since an open redirect after
 * sign-in is a phishing page's best friend.
 */
export function safeReturnToV1(
  returnTo: string | null | undefined,
  origin: string,
): string {
  if (!returnTo) return "/";
  let url: URL;
  try {
    url = new URL(returnTo, origin);
  } catch {
    return "/";
  }
  if (url.origin !== origin) return "/";
  // Back to the sign-in routes would only loop.
  if (url.pathname.startsWith(`${ROUTE_PREFIX_V1}/`)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function signInPageHtmlV1(options: {
  productName: string;
  appId: string;
  returnTo: string;
  signedOut: boolean;
  scriptHash: string;
}): string {
  const script = `${SIGN_IN_SCRIPT_PATH_V1}?v=${encodeURIComponent(options.scriptHash)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Sign in to ${escapeHtml(options.productName)}</title>
<link rel="stylesheet" href="${SIGN_IN_STYLE_PATH_V1}">
<script type="module" src="${escapeHtml(script)}"></script>
</head>
<body data-app-id="${escapeHtml(options.appId)}" data-return-to="${escapeHtml(options.returnTo)}" data-session-path="${SESSION_PATH_V1}"${options.signedOut ? ' data-signed-out=""' : ""}>
<main>
<h1>Sign in to ${escapeHtml(options.productName)}</h1>
<button type="button" id="discord" hidden>Continue with Discord</button>
<p id="status" role="status" aria-live="polite">Loading…</p>
<noscript><p>Signing in needs JavaScript.</p></noscript>
</main>
</body>
</html>
`;
}

export const SIGN_IN_STYLE_V1 = `:root{color-scheme:light dark;--fg:#16161a;--bg:#fafafa;--muted:#5c5c66;--line:#c9c9d1;--accent:#3b4cca;--on-accent:#fff}
@media (prefers-color-scheme:dark){:root{--fg:#ececf1;--bg:#121216;--muted:#a4a4b0;--line:#3a3a44;--accent:#8a97ff;--on-accent:#0b0b10}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:100%;max-width:22rem;padding:2rem 1rem}
h1{font-size:1.5rem;margin:0 0 1.5rem}
button{width:100%;font:inherit;font-weight:600;padding:.625rem .75rem;border:0;border-radius:.5rem;background:var(--accent);color:var(--on-accent);cursor:pointer}
button:disabled{opacity:.6;cursor:progress}
#status{color:var(--muted);min-height:1.5em}
`;
