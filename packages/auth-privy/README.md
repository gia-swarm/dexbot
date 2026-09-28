# @dexbot/auth-privy

DexBot's sign-in: a FrockBot auth Package (`AuthPackageV1`, [ADR 0038 §3](https://github.com/timoconnellaus/frockbot/blob/main/docs/adr/0038-white-label-deployments.md)) over Privy email login. Stateless, like FrockBot's Access Package: nothing is stored, and the User id is a hash of the Privy DID (`privy-<32 hex>`).

## How it works

1. `startSignIn(request, returnTo)` redirects to `/api/auth/privy/sign-in?returnTo=<path>`. `returnTo` is reduced to a path on the request's origin, so FrockBot's native authorize door works unchanged and nothing redirects off-site.
2. That page (static HTML, one stylesheet, one script, all same-origin under a no-inline CSP) runs Privy's vanilla browser SDK, `@privy-io/js-sdk-core`: email, one-time code.
3. The page posts Privy's **access token** and **identity token** to `POST /api/auth/privy/session`. Both are verified (ES256, `iss: privy.io`, `aud: PRIVY_APP_ID`, expiry, same `sub`). The access token carries no email, so the verified email comes from the identity token's `linked_accounts`; an identity without a verified email account is refused.
4. The Package sets its own `__Host-privy-session` cookie (HMAC-SHA256 with `PRIVY_SESSION_SECRET`, 7 days), which `getSession` reads. `/sign-out` clears it and sends the browser to the sign-in page, which also ends Privy's browser session.

## Configuration

| Name | What |
| --- | --- |
| `PRIVY_APP_ID` | The Privy app id. |
| `PRIVY_VERIFICATION_KEY` | The app's verification key from the Privy dashboard (SPKI PEM; escaped `\n` is fine). Secret by convention, though it is a public key. |
| `PRIVY_SESSION_SECRET` | 32+ random characters. Rotating it signs everybody out. |
| `NATIVE_TOKEN_SECRET` | The native sign-in door's signing key, as on FrockBot's Access build. |

In the Privy dashboard: enable email login, turn on **User management → Authentication → Advanced → Return user data in an identity token**, and add each deployment origin to the app's allowed domains.

## Development

```sh
bun run build      # bundles client/sign-in.ts into src/generated/ (gitignored)
bun run typecheck
bun run test
```

`src/auth-package.privy.ts` is the chooser module a deployment profile names; it exports `AUTH_PACKAGE_V1` and `AuthPackageEnvironmentV1`.

The contract comes from `@frockbot/core/contracts`, pinned to the same release as every other `@frockbot/*` package.
