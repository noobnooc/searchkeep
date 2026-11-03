/**
 * Generic OIDC / JWT verification using only WebCrypto.
 *
 * Configured with three values (issuer, JWKS URL, audience) so the same code
 * verifies Cloudflare Access today and oauth2-proxy / Pomerium tomorrow.
 * Trust anchors always come from configuration — never from the token itself.
 */

export interface OidcVerifierOptions {
  issuer: string;
  jwksUrl: string;
  audience: string;
  /** Allowed clock skew in seconds. */
  clockToleranceSec?: number;
  /** How long fetched keys are trusted before refetching. */
  jwksTtlMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  [key: string]: unknown;
}

export type VerifyResult = { ok: true; claims: JwtClaims } | { ok: false; reason: string };

interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
}

interface CachedKeys {
  fetchedAt: number;
  keys: Map<string, CryptoKey>;
  raw: Jwk[];
}

const jwksCache = new Map<string, CachedKeys>();

function b64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>;
}

function algorithmFor(alg: string): { import: RsaHashedImportParams | EcKeyImportParams; verify: AlgorithmIdentifier | EcdsaParams } | null {
  switch (alg) {
    case 'RS256':
      return { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } };
    case 'RS384':
      return { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }, verify: { name: 'RSASSA-PKCS1-v1_5' } };
    case 'RS512':
      return { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }, verify: { name: 'RSASSA-PKCS1-v1_5' } };
    case 'ES256':
      return { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } };
    case 'ES384':
      return { import: { name: 'ECDSA', namedCurve: 'P-384' }, verify: { name: 'ECDSA', hash: 'SHA-384' } };
    default:
      return null;
  }
}

export class OidcVerifier {
  private readonly opts: Required<Omit<OidcVerifierOptions, 'fetch' | 'now'>> & Pick<OidcVerifierOptions, 'fetch' | 'now'>;

  constructor(opts: OidcVerifierOptions) {
    this.opts = { clockToleranceSec: 60, jwksTtlMs: 10 * 60_000, ...opts };
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private async loadKeys(force: boolean): Promise<CachedKeys> {
    const cached = jwksCache.get(this.opts.jwksUrl);
    if (cached && !force && this.now() - cached.fetchedAt < this.opts.jwksTtlMs) return cached;
    const f = this.opts.fetch ?? fetch;
    const res = await f(this.opts.jwksUrl, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const entry: CachedKeys = { fetchedAt: this.now(), keys: new Map(), raw: body.keys ?? [] };
    jwksCache.set(this.opts.jwksUrl, entry);
    return entry;
  }

  private async keyFor(entry: CachedKeys, kid: string | undefined, alg: string): Promise<CryptoKey | null> {
    const cacheKey = `${kid ?? ''}:${alg}`;
    const existing = entry.keys.get(cacheKey);
    if (existing) return existing;
    const algo = algorithmFor(alg);
    if (!algo) return null;
    const jwk = entry.raw.find((k) => (kid ? k.kid === kid : true) && (!k.alg || k.alg === alg));
    if (!jwk) return null;
    const { kid: _kid, alg: _alg, ...material } = jwk;
    const key = await crypto.subtle.importKey('jwk', { ...material, ext: true }, algo.import, false, ['verify']);
    entry.keys.set(cacheKey, key);
    return key;
  }

  async verify(token: string): Promise<VerifyResult> {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
    const [h, p, s] = parts as [string, string, string];
    let header: Record<string, unknown>;
    let claims: JwtClaims;
    try {
      header = decodeJson(h);
      claims = decodeJson(p) as JwtClaims;
    } catch {
      return { ok: false, reason: 'malformed token' };
    }
    const alg = typeof header.alg === 'string' ? header.alg : '';
    const algo = algorithmFor(alg);
    if (!algo) return { ok: false, reason: `unsupported alg "${alg}"` };
    const kid = typeof header.kid === 'string' ? header.kid : undefined;

    let entry = await this.loadKeys(false);
    let key = await this.keyFor(entry, kid, alg);
    if (!key) {
      // Key rotation: refetch once.
      entry = await this.loadKeys(true);
      key = await this.keyFor(entry, kid, alg);
    }
    if (!key) return { ok: false, reason: 'signing key not found in JWKS' };

    const data = new TextEncoder().encode(`${h}.${p}`);
    const valid = await crypto.subtle.verify(algo.verify, key, b64urlToBytes(s), data);
    if (!valid) return { ok: false, reason: 'bad signature' };

    const nowSec = Math.floor(this.now() / 1000);
    const tol = this.opts.clockToleranceSec;
    if (claims.iss !== this.opts.issuer) return { ok: false, reason: 'issuer mismatch' };
    const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!aud.includes(this.opts.audience)) return { ok: false, reason: 'audience mismatch' };
    if (typeof claims.exp !== 'number' || claims.exp + tol < nowSec) return { ok: false, reason: 'token expired' };
    if (typeof claims.nbf === 'number' && claims.nbf - tol > nowSec) return { ok: false, reason: 'token not yet valid' };
    return { ok: true, claims };
  }
}

/** Test helper: clears the module-level JWKS cache. */
export function clearJwksCache(): void {
  jwksCache.clear();
}
