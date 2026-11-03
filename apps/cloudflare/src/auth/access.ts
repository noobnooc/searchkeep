/**
 * Cloudflare Access integration: verifies the Access JWT on every request
 * (header `Cf-Access-Jwt-Assertion`) and inspects the Access application via
 * the API to decide whether the deployment is ready. Trust anchors (team
 * domain and AUD) come only from Secrets — never from a received token.
 */
import {
  evaluateReadiness,
  OidcVerifier,
  PUBLIC_EMAIL_DOMAINS,
  safeMessage,
  type AccessInspection,
  type AuthResult,
  type ReadinessReport,
  type SearchkeepConfig,
} from '@searchkeep/core';
import { broadPolicyReasons, createCloudflareClient, managedOAuthEnabled, type AccessPolicy } from '@searchkeep/source-cloudflare';

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
const INSPECTION_TTL_MS = 5 * 60_000;

const verifiers = new Map<string, OidcVerifier>();
let inspectionCache: { key: string; at: number; value: AccessInspection } | null = null;

export function accessConfigured(config: SearchkeepConfig): boolean {
  return Boolean(config.access.teamDomain && config.access.aud);
}

function verifierFor(config: SearchkeepConfig): OidcVerifier {
  const team = config.access.teamDomain!;
  const aud = config.access.aud!;
  const key = `${team}|${aud}`;
  let v = verifiers.get(key);
  if (!v) {
    v = new OidcVerifier({ issuer: `https://${team}`, jwksUrl: `https://${team}/cdn-cgi/access/certs`, audience: aud });
    verifiers.set(key, v);
  }
  return v;
}

export async function authenticate(request: Request, config: SearchkeepConfig): Promise<AuthResult> {
  if (!accessConfigured(config)) return { ok: false, reason: 'ACCESS_TEAM_DOMAIN and ACCESS_AUD are not set.' };
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) return { ok: false, reason: 'No Cf-Access-Jwt-Assertion header: the request did not pass through Cloudflare Access.' };
  try {
    const res = await verifierFor(config).verify(token);
    if (!res.ok) return { ok: false, reason: `Access JWT rejected: ${res.reason}.` };
    const email = typeof res.claims.email === 'string' ? res.claims.email : null;
    const commonName = typeof res.claims.common_name === 'string' ? res.claims.common_name : null;
    return { ok: true, identity: { email: email ?? commonName, subject: res.claims.sub ?? null, provider: 'cloudflare-access' } };
  } catch (err) {
    return { ok: false, reason: `Access JWT could not be verified: ${safeMessage(err)}` };
  }
}

/** Reads the Access app (by AUD) and its policies through the Cloudflare API. Cached for a few minutes. */
export async function inspectAccess(
  config: SearchkeepConfig,
  opts: { refresh?: boolean; fetch?: typeof fetch } = {},
): Promise<AccessInspection> {
  const accountId = config.cloudflare.accountId;
  const token = config.cloudflare.apiToken;
  const aud = config.access.aud;
  if (!accountId || !token || !aud) {
    return {
      appFound: false,
      managedOAuthEnabled: false,
      broadPolicyReasons: [],
      error:
        'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (with Access: Apps and Policies Read) so Searchkeep can verify the Access setup.',
    };
  }
  const key = `${accountId}|${aud}|${token.slice(-6)}`;
  if (!opts.refresh && inspectionCache && inspectionCache.key === key && Date.now() - inspectionCache.at < INSPECTION_TTL_MS) {
    return inspectionCache.value;
  }
  const cf = createCloudflareClient({ apiToken: token, accountId, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  let value: AccessInspection;
  try {
    const found = await cf.findAccessAppByAud(accountId, aud);
    if (!found) {
      value = {
        appFound: false,
        managedOAuthEnabled: false,
        broadPolicyReasons: [],
        error: 'No Access application has the AUD in ACCESS_AUD.',
      };
    } else {
      const app = found.oauth_configuration === undefined || !found.policies ? await cf.getAccessApp(accountId, found.id) : found;
      let policies: AccessPolicy[] = [];
      const attached = app.policies ?? [];
      for (const p of attached) {
        if (p.decision && p.include) policies.push(p as AccessPolicy);
        else policies.push(await cf.getReusablePolicy(accountId, p.id));
      }
      if (attached.length === 0) policies = await cf.listAccessAppPolicies(accountId, app.id).catch(() => []);
      value = {
        appFound: true,
        managedOAuthEnabled: managedOAuthEnabled(app),
        broadPolicyReasons: broadPolicyReasons(policies, PUBLIC_EMAIL_DOMAINS),
      };
    }
  } catch (err) {
    value = {
      appFound: false,
      managedOAuthEnabled: false,
      broadPolicyReasons: [],
      error: `Could not read the Access application: ${safeMessage(err)}`,
    };
  }
  // Do not cache transient failures for long.
  inspectionCache = { key, at: value.error ? Date.now() - INSPECTION_TTL_MS + 30_000 : Date.now(), value };
  return value;
}

export async function readinessFor(auth: AuthResult, config: SearchkeepConfig, opts: { refresh?: boolean } = {}): Promise<ReadinessReport> {
  const configured = accessConfigured(config);
  const inspection = configured && auth.ok ? await inspectAccess(config, opts) : null;
  return evaluateReadiness({ configured, identityOk: auth.ok, ...(auth.ok ? {} : { identityReason: auth.reason }), inspection });
}

/** Test helper. */
export function resetAccessCaches(): void {
  verifiers.clear();
  inspectionCache = null;
}
