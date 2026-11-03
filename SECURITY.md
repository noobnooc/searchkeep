# Security policy

## Reporting a vulnerability

Please **do not** open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub's private vulnerability reporting:
<https://github.com/noobnooc/searchkeep/security/advisories/new> (repository → **Security** →
**Report a vulnerability**).

Include what you found, how to reproduce it, the affected version or commit, and the impact you
expect. Do not include real credentials or other people's data; use placeholders.

What to expect:

- An acknowledgement within 3 working days.
- An assessment and a plan within 10 working days.
- A fix released on `main` and announced in the [CHANGELOG](CHANGELOG.md), with upgrade notes if
  users must act. We credit reporters who want to be credited.

Automated agents that maintain this repository never handle security reports. If an agent notices
something that looks like a vulnerability, it stops and notifies a maintainer privately rather than
describing it in an issue.

## Supported versions

Users run their own forks and upgrade by syncing with `main`. Security fixes go to `main` and are
not backported. Keep your fork in sync.

## Scope

In scope: the code in this repository, including the Worker, authentication and readiness checks,
MCP tools, the dashboard, sync jobs and the deployment instructions.

Out of scope: misconfiguration of an individual deployment that contradicts
[docs/deploy.md](docs/deploy.md), and vulnerabilities in Cloudflare, Google or Microsoft services
themselves (report those to the vendor).

## How Searchkeep handles credentials

- All credentials (`CLOUDFLARE_API_TOKEN`, `GSC_PRIVATE_KEY`, `BING_API_KEY` and the rest) are
  **Worker Secrets** in the user's own Cloudflare account. They are never stored in the repository,
  in D1 or in logs, and they are never sent anywhere except to the API they belong to.
- No telemetry: a deployment never contacts a server run by the project.
- Least privilege by default: the Cloudflare token is read-only; the GSC service account is a
  **Restricted** user unless the user enables sitemap submission; writes to external systems are off
  unless `ENABLE_WRITES` is `true`.
- The Bing API key can also submit URLs and remove sites. Treat it as a password.
- Access team domain and AUD come only from secrets and are never learned from incoming requests.
  Every request's Access JWT is verified in the Worker, and the deployment locks itself if Access,
  Managed OAuth or the policy are not set up correctly. The scheduled sync re-checks the Access
  application through the Cloudflare API before every pass and locks again if it was loosened.
- Local development mode (`SEARCHKEEP_DEV`, set by `pnpm dev`) skips Access only for requests to
  `localhost`, `127.0.0.1` or `[::1]`; requests to any other host are treated as production.
- External API access tokens are cached only in memory.

If you suspect a credential has leaked: revoke it at its source (Cloudflare API Tokens page, the
Google Cloud service account's **Keys** tab, Bing Webmaster Tools **API access**), create a new one,
and update the Worker Secret.
