/**
 * DELETE THIS FILE once `@frockbot/core` is published to npm.
 *
 * A stand-in for `@frockbot/core/contracts`, which `tsconfig.json` maps here
 * through `paths`. It re-declares, unchanged, the types this Package names from
 * FrockBot main's `core/contracts/auth-package.ts` — nothing more, and no
 * values: every import of it is `import type`, so nothing here reaches a
 * bundle. When the package is on npm, depend on `@frockbot/core` at the
 * release version, drop the `paths` entry and delete this file.
 *
 * One divergence, deliberate and temporary: FrockBot main closes
 * `AuthPackageIdV1` to `"better-auth" | "access"`, so a Package from another
 * repository cannot name itself. ADR 0038 step 3 ("External auth Packages")
 * has to open that union before this Package compiles against the published
 * contract; `"privy"` is added here only so it compiles until then.
 */

/** Who a request is, once sign-in has identified them. */
export interface AuthIdentityV1 {
  user: {
    id: string;
    email?: string;
    /** Whether the identity provider verified `email`; absent means no. */
    emailVerified?: boolean;
  };
}

/** Display hints for an already authenticated User. Never a credential. */
export interface AuthProfileV1 {
  name?: string;
  email?: string;
  emailVerified?: boolean;
  /** https profile photo from the identity provider, when it has one. */
  image?: string;
}

/** One identity an auth Package has stored, as it stored it. */
export interface AuthStoredIdentityV1 {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: string;
}

/** One auth Package, over one request. */
export interface AuthPackageV1 {
  profile?(userId: string): Promise<AuthProfileV1 | null>;
  storedIdentity?(userId: string): Promise<AuthStoredIdentityV1 | null>;
  listStoredIdentities?(limit: number): Promise<AuthStoredIdentityV1[]>;
  deleteStoredIdentity?(userId: string): Promise<void>;
  /** `/api/auth/*`: whatever sign-in routes this Package serves there. */
  handler(request: Request): Promise<Response>;
  /** The identity these request headers carry, or nobody. */
  getSession(headers: Headers): Promise<AuthIdentityV1 | null>;
  /** `GET /sign-out`: ends the session and says where the browser goes next. */
  signOut(request: Request, url: URL): Promise<Response>;
  /** Sends a browser that is nobody to sign in and come back to `returnTo`. */
  startSignIn(request: Request, returnTo: string): Promise<Response>;
}

/** What an auth Package is about to write, as the access authority reads it. */
export interface AuthIdentityCandidateV1 {
  email: string;
  emailVerified: boolean;
}

/** What an auth Package is given beyond `env`. */
export interface AuthPackageDependenciesV1 {
  readonly mayCreateIdentity?: (
    candidate: AuthIdentityCandidateV1,
  ) => Promise<boolean>;
}

/** One `env` string an auth Package reads, and what it is for. */
export interface AuthPackageSettingV1 {
  readonly name: string;
  /** What it is for, in one line, for the operator reading a failed deploy. */
  readonly why: string;
}

/** The secret the native sign-in door signs its codes and bearers with. */
export interface AuthPackageNativeSecretV1<
  EnvironmentV1,
> extends AuthPackageSettingV1 {
  /** That secret's value in this Worker's environment, if it has one. */
  read(environment: EnvironmentV1): string | undefined;
}

/** Who decides whether an identity may use the deployment. */
export type AuthPackageAdmissionV1 = "authority" | "package";

/** Which implementation of sign-in a deployment built. See the note above. */
export type AuthPackageIdV1 = "better-auth" | "access" | "privy";

/** One implementation of sign-in, as a deployment's choosing file names it. */
export interface AuthPackageBuildV1<EnvironmentV1> {
  readonly id: AuthPackageIdV1;
  readonly required: readonly AuthPackageSettingV1[];
  readonly admission: AuthPackageAdmissionV1;
  readonly nativeTokenSecret: AuthPackageNativeSecretV1<EnvironmentV1>;
  create(
    environment: EnvironmentV1,
    dependencies?: AuthPackageDependenciesV1,
  ): AuthPackageV1;
}
