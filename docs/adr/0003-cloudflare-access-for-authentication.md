# 0003. Cloudflare Access does authentication

- Status: Accepted
- Date: 2026-11-03
- Deciders: @noobnooc

## Context

Searchkeep exposes private search data through a dashboard and an MCP endpoint on a public hostname.
MCP clients (Claude, Cursor, ChatGPT) authenticate with OAuth 2.1, PKCE and, ideally, dynamic client
registration. Writing and maintaining an OAuth authorization server inside a self-hosted project is
a large, security-critical surface, and every user would have to configure it. Users deploy on
Cloudflare already, and Cloudflare Access is available on the free Zero Trust plan.

## Options considered

1. **Built-in login and OAuth server** (for example with an OAuth provider library). Full control,
   but a lot of security-critical code, user management and secret handling in the project.
2. **Static bearer token** for MCP and a password for the dashboard. Simple, but tokens get pasted
   into configs and chats, cannot be scoped to a person and are not supported by every MCP client.
3. **Cloudflare Access** self-hosted application in front of the whole hostname, with **Managed
   OAuth** so Access acts as the OAuth 2.1 authorization server for MCP clients (PKCE and dynamic
   client registration). The Worker contains no OAuth logic and only verifies the Access JWT.

## Decision

Option 3.

- One Access self-hosted application covers the whole custom hostname. Its policy allows only the
  owner's email address or an explicit list of email addresses.
- Browsers log in through Access and keep the Access session cookie. MCP clients use Managed OAuth.
- **The Worker re-verifies the `Cf-Access-Jwt-Assertion` JWT on every request** (signature against
  the team domain's JWKS, `aud`, `iss`, `exp`). This protects against requests that bypass Access,
  for example through a `workers.dev` or preview URL.
- `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` come only from Worker Secrets. They are **never** learned
  from the first JWT the Worker sees; otherwise anyone could present a JWT issued by their own
  Access team through an unprotected URL.
- The verifier is a generic OIDC JWT check (issuer, JWKS URL, audience), so it can later work behind
  oauth2-proxy or Pomerium.
- **Locked until ready.** Readiness is computed from the request's JWT plus a Cloudflare API check of
  the Access application and its policies (token permission `Access: Apps and Policies Read`,
  cached for a few minutes, refreshed when the dashboard opens):

  | State              | Condition                                                            | Dashboard               | `/api` and `/mcp`     | Cron    |
  | ------------------ | -------------------------------------------------------------------- | ----------------------- | --------------------- | ------- |
  | `no_access`        | No valid JWT, or `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` missing         | Public setup guide only | 403 / explained error | No sync |
  | `oauth_disabled`   | JWT valid, but the app's `oauth_configuration.enabled` is not `true` | "Enable Managed OAuth"  | Refused               | No sync |
  | `policy_too_broad` | A policy allows everyone or a public email domain (gmail.com, ...)   | "Tighten your policy"   | Refused               | No sync |
  | `ready`            | All checks pass                                                      | Normal                  | Normal                | Syncs   |

- Cron requests carry no JWT. The cron syncs only after a `ready` flag has been recorded in D1 by a
  request that reached `ready`; any failed check clears the flag.
- The public `/setup` page shows only generic steps: no data, no configuration values, no source
  status, and no action that writes anything.

## Consequences

- No OAuth server, password storage or user table in the project.
- Users must create a Zero Trust organization once (a human step) and an Access application.
- If someone later turns off Access or loosens the policy, Searchkeep locks itself again.
- Managed OAuth requires MCP clients that support RFC 8707 resource indicators.
- Moving to another platform later means adding an authorization server for MCP, which is the most
  expensive part of a port. The generic OIDC verifier keeps the rest portable.
- Auth code is covered by CODEOWNERS and always needs human review.
