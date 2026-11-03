/**
 * "Locked until ready". The deployment is usable only when every check passes.
 * The state is derived from each request's verified identity plus an API
 * inspection of the protecting proxy — never from a config switch — so turning
 * protection off later automatically locks the deployment again.
 */
export type ReadinessState = 'no_access' | 'oauth_disabled' | 'policy_too_broad' | 'ready';

export interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  /** Actionable, non-sensitive detail. */
  detail?: string;
}

export interface ReadinessReport {
  state: ReadinessState;
  checks: ReadinessCheck[];
  checkedAt: string;
}

/** Result of inspecting the access proxy's configuration through its API. */
export interface AccessInspection {
  /** Could the app protecting this deployment be found and read? */
  appFound: boolean;
  managedOAuthEnabled: boolean;
  /** Reasons the policy set is too broad; empty when it is tight. */
  broadPolicyReasons: string[];
  /** Non-sensitive error, e.g. missing API permission. */
  error?: string;
}

/** Inspects the access proxy (e.g. Cloudflare Access) — platform specific. */
export interface AccessInspector {
  inspect(): Promise<AccessInspection>;
}

export const PUBLIC_EMAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'qq.com',
  '163.com',
  '126.com',
  'foxmail.com',
  'sina.com',
  'hey.com',
  'fastmail.com',
  'tutanota.com',
];

export function evaluateReadiness(input: {
  configured: boolean;
  identityOk: boolean;
  identityReason?: string;
  inspection: AccessInspection | null;
  now?: Date;
}): ReadinessReport {
  const checks: ReadinessCheck[] = [];
  const checkedAt = (input.now ?? new Date()).toISOString();

  checks.push({
    id: 'access_config',
    label: 'Access team domain and AUD are set as secrets',
    ok: input.configured,
    ...(input.configured ? {} : { detail: 'Set ACCESS_TEAM_DOMAIN and ACCESS_AUD.' }),
  });
  checks.push({
    id: 'access_jwt',
    label: 'Request carries a valid Access JWT',
    ok: input.configured && input.identityOk,
    ...(input.identityOk ? {} : { detail: input.identityReason ?? 'No valid Cf-Access-Jwt-Assertion header.' }),
  });
  if (!input.configured || !input.identityOk) {
    return { state: 'no_access', checks, checkedAt };
  }

  const insp = input.inspection;
  const oauthOk = Boolean(insp?.appFound && insp.managedOAuthEnabled);
  checks.push({
    id: 'managed_oauth',
    label: 'Managed OAuth is enabled on the Access application',
    ok: oauthOk,
    ...(oauthOk
      ? {}
      : {
          detail:
            insp?.error ??
            (insp?.appFound === false ? 'Access application not found for ACCESS_AUD.' : 'Enable Managed OAuth on the Access application.'),
        }),
  });
  if (!oauthOk) return { state: 'oauth_disabled', checks, checkedAt };

  const broad = insp!.broadPolicyReasons;
  checks.push({
    id: 'policy',
    label: 'Access policy only allows specific people',
    ok: broad.length === 0,
    ...(broad.length === 0 ? {} : { detail: broad.join(' ') }),
  });
  if (broad.length > 0) return { state: 'policy_too_broad', checks, checkedAt };

  return { state: 'ready', checks, checkedAt };
}
