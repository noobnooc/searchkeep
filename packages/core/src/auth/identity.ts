/** The authenticated caller, as established by the Auth layer. */
export interface Identity {
  email: string | null;
  subject: string | null;
  /** Free-form origin, e.g. `cloudflare-access`. */
  provider: string;
}

export type AuthResult = { ok: true; identity: Identity } | { ok: false; reason: string };

/**
 * Platform-specific identity check (Cloudflare Access today). Implementations
 * must verify cryptographically; a header's mere presence is never enough.
 */
export interface Authenticator {
  authenticate(request: Request): Promise<AuthResult>;
}
