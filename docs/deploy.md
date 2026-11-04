# Deploy Searchkeep

This runbook deploys Searchkeep into your own Cloudflare account. It is written so that an AI agent
can execute it directly and a non-technical person can follow it by hand.

- Every step is **idempotent**: running it again does no harm. If a step is already done, its
  **Verify** check passes and you move on.
- Every step ends with **Verify**. Do not continue until it passes.
- **[Human]** marks steps that only a person can do (accepting terms, authorizing apps, signing in
  to Google or Bing). An agent must stop at these steps, tell the person exactly what to do, and
  resume when they confirm.
- **[Agent or human]** steps have a dashboard path and a CLI or API alternative.
- Values in angle brackets are yours to substitute, for example `<your-domain>`.
- Never paste secrets into issues, pull requests, chat logs or commits. Your fork is public.

Time needed: about 30–45 minutes the first time.

## Overview

| #   | Step                                                                                    | Who                                                       |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0   | [Choose names and gather prerequisites](#0-choose-names-and-gather-prerequisites)       | Human                                                     |
| 1   | [Fork the repository](#1-fork-the-repository)                                           | Agent or human                                            |
| 2   | [Authorize the Cloudflare GitHub App](#2-authorize-the-cloudflare-github-app)           | **Human, once**                                           |
| 3   | [Create the Worker with Workers Builds](#3-create-the-worker-with-workers-builds)       | Agent or human                                            |
| 4   | [Add a custom domain](#4-add-a-custom-domain)                                           | Agent or human                                            |
| 5   | [Turn off workers.dev and preview URLs](#5-turn-off-workersdev-and-preview-urls)        | Agent or human                                            |
| 6   | [Create a Zero Trust organization](#6-create-a-zero-trust-organization)                 | **Human, once**                                           |
| 7   | [Create the Access application and policy](#7-create-the-access-application-and-policy) | Agent or human                                            |
| 8   | [Enable Managed OAuth](#8-enable-managed-oauth)                                         | Agent or human                                            |
| 9   | [Store the Access team domain and AUD](#9-store-the-access-team-domain-and-aud)         | Agent or human                                            |
| 10  | [Cloudflare account ID and API token](#10-cloudflare-account-id-and-api-token)          | Human (token), agent (secrets)                            |
| 11  | [Add your sites](#11-add-your-sites)                                                    | Human (dashboard) or agent (`SITES`)                      |
| 12  | [Google Search Console service account](#12-google-search-console-service-account)      | Human, or agent with gcloud; GSC user step is **Human**   |
| 13  | [Bing Webmaster Tools API key](#13-bing-webmaster-tools-api-key)                        | **Human** (key), agent (secret)                           |
| 14  | [Optional settings](#14-optional-settings)                                              | Agent or human                                            |
| 15  | [Connect an MCP client](#15-connect-an-mcp-client)                                      | Human (sign-in)                                           |
| 16  | [Verify readiness](#16-verify-readiness)                                                | Agent or human                                            |
| 17  | [Run the first sync](#17-run-the-first-sync)                                            | Automatic (cron), or human / agent with a browser session |

Then: [Troubleshooting](#troubleshooting) · [Upgrading](#upgrading) · [Uninstalling](#uninstalling)

## How to set a Worker Secret

Every configuration value is a Worker **Secret**. Nothing is stored in the repository. Several steps
below say "set secret `NAME`"; use either method.

**Dashboard:** Workers & Pages → `searchkeep` → **Settings** → **Variables and Secrets** → **Add** →
Type **Secret** → enter the name and value → **Deploy**. To change a value, edit the existing secret.

**CLI** (from a clone of your fork, after `pnpm install`):

```sh
cd apps/cloudflare
pnpm exec wrangler secret put NAME          # prompts for the value; nothing is echoed
```

Without a clone, use `npx wrangler@4 secret put NAME --name searchkeep`. `wrangler secret put`
also reads the value from standard input, for example `wrangler secret put SITES < sites.json`.
Run `wrangler login` first. (An agent without a browser can instead export its deployment token as
`CLOUDFLARE_API_TOKEN` and the account ID as `CLOUDFLARE_ACCOUNT_ID` in its shell for these
commands; that shell variable is unrelated to the read-only `CLOUDFLARE_API_TOKEN` secret of step
10.) CLI commands in the steps below assume you are in `apps/cloudflare` of your clone.

Setting a secret again overwrites it, so this is idempotent. Each change creates a new deployment of
the Worker within seconds.

**Verify:** `pnpm exec wrangler secret list` (or the dashboard list) shows the secret's **name**. Values
are never shown, which is expected.

### Configuration reference

| Secret                    | Required | Set in step | What                                                                                                            |
| ------------------------- | -------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN`      | yes      | 9           | Your Access team domain, for example `myteam.cloudflareaccess.com`                                              |
| `ACCESS_AUD`              | yes      | 9           | Application Audience (AUD) tag of the Access application                                                        |
| `CLOUDFLARE_ACCOUNT_ID`   | yes      | 10          | Your Cloudflare account ID                                                                                      |
| `CLOUDFLARE_API_TOKEN`    | yes      | 10          | Read-only API token (Account Analytics, Zone Analytics, Access: Apps and Policies); needed for the Access check |
| `SITES`                   | no       | 11          | JSON array describing your sites; optional, sites can be added in the dashboard instead                         |
| `GSC_CLIENT_EMAIL`        | for GSC  | 12          | `client_email` from the service account key JSON                                                                |
| `GSC_PRIVATE_KEY`         | for GSC  | 12          | `private_key` from the service account key JSON (real line breaks or literal `\n`)                              |
| `BING_API_KEY`            | for Bing | 13          | Bing Webmaster Tools API key (treat it as a password)                                                           |
| `BRAND_REGEX`             | optional | 14          | Default brand regex, matched case-insensitively, for example `acme\|acme\s?corp`                                |
| `ENABLE_WRITES`           | optional | 14          | `true` to enable `submit_sitemap` (requires GSC **Full** permission)                                            |
| `GSC_ROWS_PER_DAY`        | optional | 14          | Max query × page rows stored per day from GSC, 100–100000. Default `2500`                                       |
| `GSC_BACKFILL_MONTHS`     | optional | 14          | Months of GSC history to backfill, 0–16. Default `16`                                                           |
| `SYNC_DAILY_WRITE_BUDGET` | optional | 14          | Max rows the history backfill writes per UTC day. Default `80000` (D1 Free allows 100000)                       |
| `SYNC_MAX_CALLS_PER_RUN`  | optional | 14          | Max outbound API calls per sync pass, 5–900. Default `20`                                                       |

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are required even if you use no Cloudflare data:
they are how Searchkeep checks your Access setup. Values that do not parse (invalid JSON in `SITES`,
a bad regex) never crash the Worker; the dashboard's status page and `setup_status` list them as
configuration errors. Numbers outside a setting's range are clamped.

## 0. Choose names and gather prerequisites

**Who:** Human.

You need:

- A **Cloudflare account** (the Free plan is enough) with at least one domain (zone) active on
  Cloudflare. Searchkeep runs on a hostname in that zone, for example `searchkeep.example.com`.
  Sites you want AI crawler data for must be proxied through Cloudflare.
- A **GitHub account**.
- **Google Search Console** access to your properties, as an **Owner** (only owners can add users).
- **Bing Webmaster Tools** with your sites verified (optional but recommended; its AI Performance
  CSV export provides the "Cited" stage of the GEO funnel, see
  [Troubleshooting](#the-cited-step-of-the-geo-funnel-is-empty)).
- Optional, for agents or command-line use: `git`, Node.js 22, pnpm (the version in the root
  `package.json` `packageManager` field), the GitHub CLI `gh` or a GitHub MCP server, `curl`, `jq`,
  and `gcloud` for step 12. An agent working with Cloudflare needs either the Cloudflare MCP server
  (signed in as you) or a short-lived API token you create for the deployment with edit permissions
  for Workers Scripts, Workers CI (Builds), Access: Apps and Policies, and read access to your
  zones. Delete that token when you are done. It is separate from the read-only runtime token in
  step 10. The API examples below read it from the shell variable `CF_DEPLOY_TOKEN`
  (`read -rs CF_DEPLOY_TOKEN && export CF_DEPLOY_TOKEN`); with the Cloudflare MCP server, make the
  same requests through its tools instead.

Write down:

| Placeholder     | Example                            | Where it comes from                        |
| --------------- | ---------------------------------- | ------------------------------------------ |
| `<your-domain>` | `searchkeep.example.com`           | You choose; must not have a DNS record yet |
| `<zone>`        | `example.com`                      | The Cloudflare zone that contains it       |
| `<github-user>` | `octocat`                          | Your GitHub username                       |
| `<account-id>`  | `023e105f4ecef8ad9ca31a8372d0c353` | Step 10                                    |
| `<your-email>`  | `you@example.com`                  | The email address you sign in with         |

**Verify:** `<zone>` is listed as **Active** under **Domains** (or **Websites**) in the Cloudflare
dashboard, and `<your-domain>` has no existing DNS record in that zone.

## 1. Fork the repository

**Who:** Agent or human.

**Dashboard:** open <https://github.com/noobnooc/searchkeep> → **Fork** → owner `<github-user>`,
repository name `searchkeep`, keep "Copy the `main` branch only" checked → **Create fork**.

**CLI / agent:**

```sh
gh repo fork noobnooc/searchkeep --clone=false
```

With a GitHub MCP server, use its `fork_repository` tool with owner `noobnooc` and repo `searchkeep`.
If the fork already exists, GitHub returns the existing fork; that is fine.

Do not commit anything to your fork's `main`. All configuration goes into Worker Secrets, and keeping
`main` identical to upstream makes "Sync fork" conflict-free.

**Verify:**

```sh
gh repo view <github-user>/searchkeep --json parent --jq .parent.nameWithOwner
# prints: noobnooc/searchkeep
```

## 2. Authorize the Cloudflare GitHub App

**Who:** **[Human]**, once per GitHub account.

This happens inside the flow of step 3: when you choose **Import a repository** and **Connect
GitHub** for the first time, GitHub asks you to install the **Cloudflare Workers and Pages** app.
Choose **Only select repositories** → `<github-user>/searchkeep` → **Install & Authorize**.

If the app is already installed but cannot see the fork: GitHub → **Settings** → **Applications** →
**Installed GitHub Apps** → **Cloudflare Workers and Pages** → **Configure** → add
`<github-user>/searchkeep` under **Repository access** → **Save**.

**Verify:** on <https://github.com/settings/installations>, **Cloudflare Workers and Pages** lists
`<github-user>/searchkeep` (or "All repositories").

## 3. Create the Worker with Workers Builds

**Who:** Agent or human. The dashboard is the simplest path because it creates the Worker, the
repository connection and the build trigger in one go.

**Dashboard:**

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Import a repository**
   (or **Continue with GitHub**).
2. Select the GitHub account and `<github-user>/searchkeep`.
3. Configure the project:
   - **Project name:** `searchkeep` (must match the Worker name in `wrangler.jsonc`)
   - **Build command:** `pnpm run build`
   - **Deploy command:** `pnpm run deploy`
   - **Advanced settings** → **Root directory** (path): `apps/cloudflare`
4. **Create and deploy**. The first build installs dependencies, builds the dashboard into the
   Worker's static assets, deploys, and creates the D1 database `searchkeep` automatically (the
   repository only names the binding `DB`; the database ID is stored in your Cloudflare account,
   never in Git). The remote migration step is normally skipped on Workers Builds; see **About
   migrations** below.
5. Open the Worker → **Settings** → **Build**:
   - **Build watch paths** → **Include paths:** `apps/cloudflare/*`, `packages/*` and
     `pnpm-lock.yaml`
   - **Branch control:** production branch `main`; turn **off** builds for non-production branches.

**API alternative (agent):** the Workers Builds API needs the Worker to exist and the GitHub App
installation from step 2, so agents usually let the human do sub-steps 1–4 and then check or fix the
trigger by API (permission: Workers CI Write):

```sh
# Worker tag (external_script_id)
curl -s "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/scripts" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" | jq -r '.result[] | select(.id=="searchkeep") | .tag'

# Current trigger(s)
curl -s "https://api.cloudflare.com/client/v4/accounts/<account-id>/builds/workers/<script-tag>/triggers" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" | jq '.result'

# Fix a trigger in place
curl -s -X PATCH "https://api.cloudflare.com/client/v4/accounts/<account-id>/builds/triggers/<trigger-uuid>" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" -H "Content-Type: application/json" \
  --data '{"root_directory":"apps/cloudflare","build_command":"pnpm run build","deploy_command":"pnpm run deploy","branch_includes":["main"],"path_includes":["apps/cloudflare/*","packages/*","pnpm-lock.yaml"]}'
```

Creating everything by API uses `PUT .../builds/repos/connections`, `POST .../builds/tokens` and
`POST .../builds/triggers` with the same fields plus `external_script_id`, `repo_connection_uuid`,
`build_token_uuid`, `trigger_name`, `branch_excludes: []` and `path_excludes: []`.

**About migrations:** the deploy command (`apps/cloudflare/scripts/deploy.mjs`) tries to apply D1
migrations remotely, deploys, then tries the migrations once more, and never fails because of them.
The default Workers Builds build token has no D1 permission, so on Workers Builds the remote step is
skipped with a warning (`Remote migration skipped ...`). That is expected and fine: the Worker
applies any pending migrations itself on its first request and tracks them in the same
`d1_migrations` table wrangler uses, so the two paths never apply a migration twice. If you want the
build to migrate as well, add **D1 Edit** to the build token (optional).

The watch paths make a change to the Worker, its packages or its dependencies trigger a build, while
changes that only touch the docs or the website (`apps/site`) do not.

**Verify:**

- Workers & Pages → `searchkeep` → **Deployments** (or **Builds**) shows the latest build as
  **Success**.
- Storage & Databases → **D1** lists a database named `searchkeep`. CLI:
  `npx wrangler@4 d1 list` shows `searchkeep`. Its tables exist at the latest after the Worker's
  first request (step 4).
- The trigger shows root directory `apps/cloudflare`, build command `pnpm run build`, deploy command
  `pnpm run deploy` and all three include paths.

## 4. Add a custom domain

**Who:** Agent or human.

A custom domain is required: `wrangler.jsonc` turns off `workers.dev` and preview URLs and declares
no routes, so the custom domain is the only way to reach the Worker, and the Access application in
step 7 protects this hostname. Because you add the domain in the dashboard rather than in the
repository, it survives upgrades.

**Dashboard:** Workers & Pages → `searchkeep` → **Settings** → **Domains & Routes** → **Add** →
**Custom domain** → `<your-domain>` → **Add custom domain**. (In newer dashboards: the Worker's
**Domains** tab → **Add Domain**.) Cloudflare creates the DNS record and certificate.

**API (agent):** permission Workers Scripts Write.

```sh
ZONE_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=<zone>" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" | jq -r '.result[0].id')
curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/domains" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" -H "Content-Type: application/json" \
  --data "{\"hostname\":\"<your-domain>\",\"service\":\"searchkeep\",\"zone_id\":\"$ZONE_ID\",\"environment\":\"production\"}"
```

`PUT` attaches or re-attaches the domain, so it is safe to repeat.

**Verify** (the certificate can take a few minutes):

```sh
curl -s https://<your-domain>/healthz
# before step 7: {"ok":true}
# after step 7: a redirect or 401 from Access, which is also fine
```

Before step 7 the deployment is locked (`no_access`), and these checks confirm it:

```sh
curl -s https://<your-domain>/ | grep -o '<title>[^<]*'
# <title>Searchkeep is locked          (the public setup page)

curl -s -w ' %{http_code}\n' https://<your-domain>/api/status
# {"error":"Searchkeep is locked: Cloudflare Access is not protecting this request.","code":"locked","state":"no_access","setup":"/setup"} 403

curl -s -w ' %{http_code}\n' -X POST https://<your-domain>/mcp
# {"jsonrpc":"2.0","error":{"code":-32001,"message":"Searchkeep is locked: https://<your-domain> is not protected by Cloudflare Access yet. See https://<your-domain>/setup."},"id":null} 403
```

## 5. Turn off workers.dev and preview URLs

**Who:** Agent or human.

Searchkeep must be reachable only through `<your-domain>`, where Access protects it. (Even if another
URL were reachable, without a valid Access JWT for your application the Worker serves only
`/healthz`, `/robots.txt` and the public setup guide; this step removes the extra surface.) The
repository's `wrangler.jsonc` keeps both turned off on every deploy; this step confirms it.

**Dashboard:** Workers & Pages → `searchkeep` → **Settings** → **Domains & Routes** (or the
**Domains** tab) → **workers.dev** → **Disable**, and **Preview URLs** → **Disable**.

**API (agent):**

```sh
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/scripts/searchkeep/subdomain" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" -H "Content-Type: application/json" \
  --data '{"enabled":false,"previews_enabled":false}'
```

**Verify:**

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/scripts/searchkeep/subdomain" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" | jq '.result'
# {"enabled": false, "previews_enabled": false}
```

The dashboard shows both as disabled, and `https://searchkeep.<your-workers-subdomain>.workers.dev/healthz`
no longer returns `{"ok":true}`.

## 6. Create a Zero Trust organization

**Who:** **[Human]**, once per Cloudflare account. Skip if you already use Cloudflare Zero Trust.

1. Cloudflare dashboard → **Zero Trust**.
2. Choose a **team name** (this becomes `<team>.cloudflareaccess.com`).
3. Choose the **Free** plan and complete checkout. Cloudflare may ask for a payment method even for
   the Free plan.
4. Login methods: **One-time PIN** (a code sent to your email) works out of the box. You can add
   GitHub or Google later under **Settings** → **Authentication**.

**Verify:** Zero Trust → **Settings** shows your team domain `<team>.cloudflareaccess.com`. API
(agent, permission Access: Organizations, Identity Providers, and Groups Read):

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/<account-id>/access/organizations" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" | jq -r '.result.auth_domain'
# <team>.cloudflareaccess.com
```

## 7. Create the Access application and policy

**Who:** Agent or human.

The application must cover the **whole hostname**: no path, no bypass rules, no exceptions. The
policy must allow **only your email address** (or a short explicit list). Policies that include
Everyone, a public email domain such as `gmail.com`, any login method or identity provider, every
IP address (`/0`), a whole country or any service token, and policies with the **Bypass** or
**Service Auth** action, put Searchkeep into the `policy_too_broad` state and keep it locked.

**Dashboard:**

1. Zero Trust → **Access controls** → **Applications** (older dashboards: **Access** →
   **Applications**) → **Add an application** → **Self-hosted**.
2. **Application name:** `Searchkeep`.
3. **Add public hostname:** subdomain and domain so that the hostname equals `<your-domain>`; leave
   **Path** empty.
4. **Access policies** → **Create new policy**:
   - **Policy name:** `Searchkeep owner`
   - **Action:** **Allow**
   - **Include** → selector **Emails** → `<your-email>` (add more addresses only if they should see
     all of your data)
   - Save the policy and select it for the application.
5. Keep the default session duration (24 hours is fine) → **Save** / **Create**.

**API (agent):** permission Access: Apps and Policies Write. First check whether it already exists:

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/<account-id>/access/apps" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" \
  | jq '.result[] | select(any(.destinations[]?; .uri=="<your-domain>")) | {id, aud, name}'
```

If nothing is returned, create a reusable policy and the application:

```sh
POLICY_ID=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/<account-id>/access/policies" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" -H "Content-Type: application/json" \
  --data '{"name":"Searchkeep owner","decision":"allow","include":[{"email":{"email":"<your-email>"}}]}' \
  | jq -r '.result.id')

curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/<account-id>/access/apps" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" -H "Content-Type: application/json" \
  --data "{\"name\":\"Searchkeep\",\"type\":\"self_hosted\",\"destinations\":[{\"type\":\"public\",\"uri\":\"<your-domain>\"}],\"session_duration\":\"24h\",\"policies\":[{\"id\":\"$POLICY_ID\",\"precedence\":1}]}" \
  | jq '.result | {id, aud}'
```

If it exists, update it with `PUT .../access/apps/<app-id>` instead of creating a second one. Send
the full object returned by `GET .../access/apps/<app-id>` with your changes, so nothing is lost.

**Verify:**

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/healthz
# 302 (redirect to <team>.cloudflareaccess.com) or 401 — never 200
```

Opening `https://<your-domain>/` in a private browser window shows the Cloudflare Access login page.
After signing in with `<your-email>` you see the Searchkeep setup guide.

## 8. Enable Managed OAuth

**Who:** Agent or human.

Managed OAuth makes Access act as the OAuth 2.1 authorization server for MCP clients, with PKCE and
dynamic client registration, so clients register themselves and you never paste a client ID.

**Dashboard:** Zero Trust → **Access controls** → **Applications** → `Searchkeep` → **⋯** → **Edit** →
**Advanced settings** → turn on **Managed OAuth**. In its settings:

- Keep **dynamic client registration** on.
- Turn on **Allow localhost clients** and **Allow loopback clients** (used by Claude Code, Cursor and
  other local clients).
- If **Allowed redirect URIs** is restricted, add the callback URLs of the web clients you use, for
  example `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`.

→ **Save**.

**API (agent):** `GET .../access/apps/<app-id>`, set `oauth_configuration` as below on the returned
object, and `PUT` the whole object back:

```json
"oauth_configuration": {
  "enabled": true,
  "dynamic_client_registration": {
    "enabled": true,
    "allow_any_on_localhost": true,
    "allow_any_on_loopback": true
  }
}
```

**Verify:**

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/<account-id>/access/apps/<app-id>" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" | jq '.result.oauth_configuration.enabled'
# true

curl -s -o /dev/null -D - https://<your-domain>/mcp | grep -iE '^(HTTP|www-authenticate)'
# HTTP/2 401 and a www-authenticate header pointing to Access. A 302 means Managed OAuth is off.
```

## 9. Store the Access team domain and AUD

**Who:** Agent or human.

- **Team domain:** Zero Trust → **Settings** → team domain, for example `myteam.cloudflareaccess.com`
  (API: `.result.auth_domain` from step 6). Use the hostname only, without `https://`.
- **AUD tag:** Zero Trust → **Access controls** → **Applications** → `Searchkeep` → **Edit** →
  **Basic information** (or **Overview**) → **Application Audience (AUD) Tag** → copy. (API:
  `.result.aud` from step 7.)

Set secret `ACCESS_TEAM_DOMAIN` to the team domain and secret `ACCESS_AUD` to the AUD tag
([how](#how-to-set-a-worker-secret)).

Never derive these values from a JWT the Worker receives; they must come from your Access
configuration.

**Verify:** `wrangler secret list` shows `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Open
`https://<your-domain>/` and sign in: the dashboard no longer reports `no_access`. It may report
another state until the remaining steps are done.

## 10. Cloudflare account ID and API token

**Who:** **[Human]** creates the token (an agent can do it only with a token that is allowed to
create tokens; prefer the human path). Agent or human sets the secrets.

Both secrets are required even if you do not use Cloudflare as a data source: the Worker uses them to
read your Access application and policies. Without them it stays in `oauth_disabled`.

**Account ID:** Cloudflare dashboard → **Workers & Pages** → **Account details** in the side panel
(or the zone **Overview** page, **API** section) → **Account ID**. CLI: `npx wrangler@4 whoami`.

**Read-only API token:**

1. Cloudflare dashboard → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**
   → **Get started**.
2. **Token name:** `Searchkeep (read-only)`.
3. **Permissions:**
   - **Account** → **Account Analytics** → **Read**
   - **Zone** → **Analytics** → **Read**
   - **Account** → **Access: Apps and Policies** → **Read**
4. **Account Resources:** Include → your account. **Zone Resources:** Include → **All zones from an
   account** (your account), or the specific zones of your sites.
5. **Continue to summary** → **Create Token** → copy the token (it is shown once).

Set secret `CLOUDFLARE_ACCOUNT_ID` to the account ID and secret `CLOUDFLARE_API_TOKEN` to the token.

**Verify:**

```sh
curl -s https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer <token>" | jq -r '.result.status'
# active
```

and `wrangler secret list` shows both names.

## 11. Add your sites

**Who:** Human in the dashboard (recommended), or an agent through the `SITES` secret.

There are two ways to tell Searchkeep which sites to analyse. You can use both: sites from the
secret show up in the dashboard as read-only.

**Option A, dashboard (easiest).** After step 15, open the dashboard → **Settings** → **Sites** →
**Add site**. Enter the domain and press **Auto-fill**: Searchkeep looks the domain up in Search
Console, Bing Webmaster Tools and Cloudflare with the credentials you configured and fills in what
it finds. Every field also accepts a value you type yourself. Sites are stored in your D1 database;
edit or remove them on the same page. To pick Cloudflare zones and Web Analytics sites from a list,
give the API token two more read permissions (optional): **Zone: Read** and **Account Settings:
Read**.

**Option B, `SITES` secret (for agents and scripted setups).** Skip it if you use the dashboard.

`SITES` is a JSON array with one object per site:

```json
[
  {
    "id": "acme",
    "domain": "acme.com",
    "gscProperty": "sc-domain:acme.com",
    "bingSiteUrl": "https://acme.com/",
    "cloudflareZoneId": "023e105f4ecef8ad9ca31a8372d0c353",
    "webAnalyticsSiteTag": "abc123",
    "brandRegex": "acme"
  }
]
```

| Field                 | What                                                                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | Optional. Short, stable identifier (lowercase letters, digits, dashes). Derived from the domain when omitted (`www.acme.com` becomes `acme-com`). Do not change it later; stored data is keyed by it. |
| `domain`              | Required. The site's bare hostname, for example `acme.com` (no scheme, no path).                                                                                                                      |
| `gscProperty`         | The Search Console property: `sc-domain:acme.com` for a Domain property, or the exact URL such as `https://acme.com/` for a URL-prefix property.                                                      |
| `bingSiteUrl`         | The site URL exactly as registered in Bing Webmaster Tools, usually with a trailing slash.                                                                                                            |
| `cloudflareZoneId`    | The site's Cloudflare zone ID (for AI crawler data).                                                                                                                                                  |
| `webAnalyticsSiteTag` | The Cloudflare Web Analytics site tag (for AI referral visits and Web Vitals; also needs `CLOUDFLARE_ACCOUNT_ID`).                                                                                    |
| `brandRegex`          | Optional. Overrides `BRAND_REGEX` for this site.                                                                                                                                                      |

Leave out a source's field if you do not use that source for a site.

**Zone ID:** dashboard → select the domain → **Overview** → **API** section in the right column →
**Zone ID**. API: `curl -s "https://api.cloudflare.com/client/v4/zones?name=acme.com" -H "Authorization: Bearer $CF_DEPLOY_TOKEN" | jq -r '.result[0].id'`.

**Web Analytics site tag:** dashboard → **Analytics & Logs** → **Web Analytics** → select the site;
the site tag appears in the address bar as `siteTag~in=<tag>`. It is **not** the `token` value in
the JavaScript snippet. API (permission Account Settings Read):

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/<account-id>/rum/site_info/list" \
  -H "Authorization: Bearer $CF_DEPLOY_TOKEN" | jq '.result[] | {host, site_tag}'
```

Save the JSON in a file **outside** your clone (for example `~/searchkeep-sites.json`), check it, and
set it as a secret:

```sh
jq -e 'type=="array" and length>0 and all(.[]; .domain)' ~/searchkeep-sites.json
pnpm exec wrangler secret put SITES < ~/searchkeep-sites.json
```

In the dashboard, paste the JSON as the value of secret `SITES`.

**Verify:** after step 15, **Settings** → **Sites** lists every site (option A or B), the
`list_sites` tool returns them, and `setup_status` shows "At least one site is configured" as OK
with no configuration errors.

## 12. Google Search Console service account

**Who:** **[Human]** in the Google Cloud console, or an agent with an authenticated `gcloud`. Adding
the service account to Search Console is always **[Human]** (the Search Console API cannot manage
users).

### 12a. Create the service account and key

**Google Cloud console:**

1. <https://console.cloud.google.com/> → project picker → **New project** → name `searchkeep` →
   **Create** (or reuse an existing project).
2. **APIs & Services** → **Library** → search **Google Search Console API** → **Enable**.
3. **IAM & Admin** → **Service Accounts** → **Create service account** → name `searchkeep` →
   **Create and continue** → skip roles (no project roles are needed) → **Done**.
4. Open the service account → **Keys** → **Add key** → **Create new key** → **JSON** → **Create**. A
   key file downloads. Keep it private.

**gcloud (agent):**

```sh
PROJECT_ID=searchkeep-<random-suffix>        # globally unique; or reuse an existing project
gcloud projects create "$PROJECT_ID"          # skip if reusing
gcloud services enable searchconsole.googleapis.com --project "$PROJECT_ID"
gcloud iam service-accounts create searchkeep --display-name "Searchkeep" --project "$PROJECT_ID"
gcloud iam service-accounts keys create ~/searchkeep-gsc-key.json \
  --iam-account "searchkeep@$PROJECT_ID.iam.gserviceaccount.com"
```

`create` commands fail with "already exists" on a second run; that is fine. Avoid creating extra
keys: list them with `gcloud iam service-accounts keys list --iam-account ...`.

### 12b. Add the service account to Search Console

**[Human]**, for each property in `SITES`:

1. <https://search.google.com/search-console> → select the property.
2. **Settings** → **Users and permissions** → **Add user**.
3. Email: the `client_email` from the key file (`searchkeep@<project>.iam.gserviceaccount.com`).
4. Permission: **Restricted**. Use **Full** only if you will enable `submit_sitemap` (step 14).
5. **Add**.

### 12c. Store the credentials

```sh
jq -r .client_email ~/searchkeep-gsc-key.json | pnpm exec wrangler secret put GSC_CLIENT_EMAIL
jq -r .private_key  ~/searchkeep-gsc-key.json | pnpm exec wrangler secret put GSC_PRIVATE_KEY
```

In the dashboard, paste the `client_email` value into `GSC_CLIENT_EMAIL`, and the `private_key`
value (from `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----`) into `GSC_PRIVATE_KEY`.
Real line breaks and the literal `\n` sequences from the JSON file both work.

Then delete the local key file, or move it to a password manager: `rm ~/searchkeep-gsc-key.json`.

**Verify:** in Search Console, **Users and permissions** lists the service account email with
**Restricted** permission, and `wrangler secret list` shows both secret names. After step 15,
`setup_status` reports that the service account can read each GSC property.

## 13. Bing Webmaster Tools API key

**Who:** **[Human]** gets the key. Agent or human sets the secret.

1. <https://www.bing.com/webmasters> → sign in.
2. **Settings** (gear icon) → **API access** → **API Key** → **Generate API Key** (or copy the
   existing one). There is one key per user.
3. Set secret `BING_API_KEY` to the key.

The key can also submit URLs and remove sites, so treat it like a password. Searchkeep only reads.

**Verify:**

```sh
read -rs BING_KEY   # paste the key; it is not echoed and not saved in shell history
curl -s "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=$BING_KEY" | jq '.d[].Url'
unset BING_KEY
```

The output lists your sites, including each `bingSiteUrl` from `SITES`.

## 14. Optional settings

**Who:** Agent or human.

- **`BRAND_REGEX`**: a JavaScript regular expression source, matched case-insensitively, that
  identifies brand queries, for example `acme|acme\s?corp`. A site's `brandRegex` in `SITES`
  overrides it. Without it, the `brand` filter treats all queries as non-brand.
- **`ENABLE_WRITES`**: set to `true` to enable the `submit_sitemap` tool. Also change the service
  account's permission in Search Console to **Full** for the properties where you want to submit
  sitemaps. Leave it unset to stay read-only.
- **Sync budgets**: `GSC_ROWS_PER_DAY` (default `2500`), `GSC_BACKFILL_MONTHS` (default `16`),
  `SYNC_DAILY_WRITE_BUDGET` (default `80000`) and `SYNC_MAX_CALLS_PER_RUN` (default `20`). The
  defaults fit the free plans: D1 Free allows 100,000 rows written per day, and Workers Free allows
  10 ms of CPU per invocation. Change them only if you have a reason, for example a lower
  `GSC_ROWS_PER_DAY` when sync units keep being skipped (see
  [Troubleshooting](#sync-is-slow-or-units-are-skipped)).

**Verify:** `wrangler secret list` shows the names you set. `setup_status` reports whether writes are
enabled.

## 15. Connect an MCP client

**Who:** **[Human]** completes the Access sign-in in a browser; the rest can be done by an agent.

The MCP endpoint is `https://<your-domain>/mcp`. Clients must support Streamable HTTP and OAuth with
RFC 8707 resource indicators (current versions of Claude, Claude Code and Cursor do).

**Claude (claude.ai, desktop and mobile):** **Settings** → **Connectors** → **Add custom connector** →
name `Searchkeep`, URL `https://<your-domain>/mcp` → **Add** → **Connect**. A browser window shows the
Cloudflare Access login; sign in with `<your-email>`. (On Team and Enterprise plans an owner may need
to add the connector in organization settings first.)

**Claude Code:**

```sh
claude mcp add --transport http searchkeep https://<your-domain>/mcp
```

Then, inside Claude Code, run `/mcp`, select `searchkeep` and choose **Authenticate**. Your browser
opens the Access login.

**Cursor:** **Settings** → **MCP** → **Add new MCP server**, or add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "searchkeep": { "url": "https://<your-domain>/mcp" }
  }
}
```

Cursor opens the Access login when it first connects.

**Verify:** the client lists the Searchkeep tools: 12, including `setup_status`, or 13 with
`ENABLE_WRITES=true` (which adds `submit_sitemap`). If the client reports an OAuth or redirect
error, see [Troubleshooting](#mcp-client-cannot-connect). While the deployment is not `ready`, the
endpoint answers every request, including the tool list, with a JSON-RPC error that explains the
lock; fix it with step 16 and reconnect.

## 16. Verify readiness

**Who:** Agent or human.

Open `https://<your-domain>/` and look at the dashboard's **Settings** (status) page, which reads
`GET /api/status` and works in every state once you are signed in through Access. It shows the
readiness state, one line per readiness check, and any configuration errors. Once the deployment is
`ready`, ask your MCP client to call **`setup_status`** (or use the same page) for the full report:
each credential, live probes of the Cloudflare token, Search Console and Bing, the last sync, and
each site's sources and data coverage. Before `ready`, `/mcp` and every other `/api/*` route refuse
requests with an error that names the state.

| State              | Meaning                                         | Action                                      |
| ------------------ | ----------------------------------------------- | ------------------------------------------- |
| `ready`            | Everything required is configured               | Continue to step 17                         |
| `no_access`        | Access is not protecting this request correctly | [Fix `no_access`](#no_access)               |
| `oauth_disabled`   | Managed OAuth is off                            | [Fix `oauth_disabled`](#oauth_disabled)     |
| `policy_too_broad` | The Access policy lets too many people in       | [Fix `policy_too_broad`](#policy_too_broad) |

The Access configuration check is cached for up to five minutes; `GET /api/status?refresh=1` (from
an authenticated session) re-checks immediately.

The first authenticated request that sees `ready` (this `setup_status` call, or opening the
dashboard) records a ready flag in D1. The cron syncs only while that flag is set.

**Verify:** `setup_status` reports `ready`, and each configured source (GSC, Bing, Cloudflare) shows
no credential errors.

## 17. Run the first sync

**Who:** automatic. To start right away: **[Human]** in the dashboard, or an agent that has an
authenticated browser session.

The cron runs **every 15 minutes**. Once the ready flag is set (step 16), each pass first re-reads
the Access application through the API (and locks again if Access was turned off or loosened), then
does whatever sync work is due. To start right away instead of waiting for the next pass:

- **Dashboard:** open `https://<your-domain>/` → **Settings** → **Sync now**.
- **API:** `POST https://<your-domain>/api/sync` from an authenticated session (it is behind Access
  like every other route). For example, with `cloudflared` installed:
  `cloudflared access curl https://<your-domain>/api/sync -X POST` (it opens a browser to sign in).

How the sync works:

- Each pass does only what fits its budgets (`SYNC_MAX_CALLS_PER_RUN` API calls, a time budget, and
  `SYNC_DAILY_WRITE_BUDGET` rows per UTC day for the backfill), keeps its progress in D1 and resumes
  on the next pass. A run with status `partial` and "continues next run" is normal.
- **Daily increments first:** GSC re-pulls the last 4 days (its data lags 2–3 days) and fills gaps
  of up to 30 days; the GSC sitemap snapshot and Bing (traffic, queries, pages, crawl issues) are
  refreshed in full once a day; Cloudflare adds each missing day of AI crawler requests (30 days back
  on the first run) and Web Analytics with Web Vitals (90 days back on the first run).
- **Then the history backfill:** GSC history is backfilled one day at a time, newest first, back 16
  months (`GSC_BACKFILL_MONTHS`). On the free D1 write quota this takes days to weeks.
- A unit interrupted 3 times in a row (for example by the Workers Free CPU limit) is skipped, so the
  sync never gets stuck; the run reports it as an error.

**Verify:** `setup_status` (or the dashboard) shows a recent sync without errors, and `list_sites`
shows a date range for each connected dataset. Over the following days to weeks, the GSC range
reaches back 16 months.

You are done. Keep your fork in sync to get updates ([Upgrading](#upgrading)).

## Troubleshooting

Start with the dashboard's status page (`GET /api/status`, available in every state once you are
signed in), or `setup_status` once the deployment is `ready`: it names the failing check.

### `no_access`

The request did not carry a valid Access JWT for your application, or the Access secrets are
missing.

1. `wrangler secret list` shows `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. If not, do step 9.
2. `ACCESS_TEAM_DOMAIN` is just the hostname (`<team>.cloudflareaccess.com`), with no `https://`
   and no trailing slash.
3. `ACCESS_AUD` is the AUD tag of **this** application (the one whose hostname is `<your-domain>`),
   not of another Access application.
4. The Access application covers the whole hostname: the public hostname equals `<your-domain>` and
   the path is empty. There are no **Bypass** policies or path exceptions.
5. You are using `https://<your-domain>`, not a `workers.dev` or preview URL (step 5).
6. After fixing, reload the page. A secret change redeploys the Worker within seconds.

### `oauth_disabled`

The JWT is valid, but the Access application does not have Managed OAuth turned on, so MCP clients
cannot sign in.

1. Do step 8 and check `oauth_configuration.enabled` is `true`.
2. Check that `CLOUDFLARE_ACCOUNT_ID` is set and that `CLOUDFLARE_API_TOKEN` has **Access: Apps and
   Policies Read** and covers your account. Without them the Worker cannot read the Access
   configuration and stays locked; the check's detail says so.
3. Re-check with `GET /api/status?refresh=1`, or wait up to five minutes for the cached check to
   expire.

### `policy_too_broad`

A policy on the application lets in more than specific people. The check's detail names the policy
and the reason.

1. Zero Trust → **Access controls** → **Applications** → `Searchkeep` → **Policies**.
2. Remove any policy, rule or include that uses **Everyone**, the **Bypass** or **Service Auth**
   action, any login method, an IP range that matches every address (`0.0.0.0/0`, `::/0`), a whole
   country, any valid service token, or **Emails ending in** a public domain (gmail.com,
   outlook.com, hotmail.com, yahoo.com, icloud.com, proton.me, qq.com and similar). A policy with no
   include rules, or no Allow policy at all, also counts as too broad.
3. Keep one **Allow** policy that includes **Emails** with your address (or an explicit list).
4. Re-check with `GET /api/status?refresh=1`, or reload the dashboard after five minutes.

### Build fails in Workers Builds

- **Cannot find `wrangler.jsonc` or `package.json`:** the root directory must be `apps/cloudflare`.
- **Wrong pnpm version or lockfile errors:** do not change the lockfile in your fork; sync the fork so
  `pnpm-lock.yaml` matches upstream.
- **Worker name mismatch:** the Workers project name must be `searchkeep`.
- **The log says "Remote migration skipped" or the D1 migration step reports an authentication or
  permission error:** expected with the default build token. The deploy continues and the Worker
  applies pending migrations on its first request (see step 3). If the deploy itself failed, open an
  issue with the build log, with any secrets removed.
- **A sync of your fork did not trigger a build:** the change did not touch the watch paths
  (`apps/cloudflare/*`, `packages/*`, `pnpm-lock.yaml`), so there was nothing to deploy. Check the
  include paths if a code change did not build.

### Custom domain cannot be added

The hostname already has a DNS record (for example a CNAME). Delete that record or choose another
hostname. The zone must be active in the same Cloudflare account as the Worker.

### MCP client cannot connect

- **Redirect URI not allowed / invalid client:** in Managed OAuth settings, allow localhost and
  loopback clients, and add the client's callback URL to **Allowed redirect URIs** (step 8).
- **The client opens a login page it cannot complete, or reports a 302:** Managed OAuth is off
  (step 8).
- **Signed in but every tool fails:** the deployment is not `ready`; check the dashboard status.
- **Signed in with the wrong account:** the email you used is not in the policy. Sign out at
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/logout` and try again.
- The client must support Streamable HTTP and RFC 8707 resource indicators.

### Google Search Console errors

- **"User does not have sufficient permission for site":** the service account is not added to this
  property (step 12b), or `gscProperty` does not match the property exactly (`sc-domain:acme.com`
  for a Domain property, `https://acme.com/` with the trailing slash for a URL-prefix property).
- **Private key cannot be parsed:** set `GSC_PRIVATE_KEY` again using the `jq -r .private_key`
  command from step 12c so the line breaks are exact.
- **"Search Console API has not been used in project ... or it is disabled":** enable it (step 12a).
- **Key creation is blocked** with `iam.disableServiceAccountKeyCreation`: your Google Cloud
  organization forbids service account keys. Ask the organization admin for an exception for this
  project, or create the project outside the organization.
- **Recent days are missing:** GSC data is delayed by a few days; Searchkeep re-pulls the last 4 days
  on every sync. Query-level totals are lower than site totals because Google hides anonymized
  queries.

### Bing errors

- **`InvalidApiKey` or 401:** generate a new key (step 13) and set `BING_API_KEY` again.
- **Site not found:** `bingSiteUrl` must match the site URL in Bing Webmaster Tools exactly.
- Bing data is weekly, and every call returns all of it. Queries against Bing data are aligned to
  whole Monday–Sunday weeks.

### Cloudflare data is empty

- **AI crawler data:** the site must be proxied through Cloudflare (orange cloud), and the API token's
  zone resources must include its zone. On Free plans, crawlers are identified by user agent only.
  Cloudflare's GraphQL API keeps at least 31 days of HTTP request data, so the first sync goes back
  30 days; older crawler traffic cannot be recovered.
- **Web Analytics:** `webAnalyticsSiteTag` must be the site tag, not the snippet token, and
  `CLOUDFLARE_ACCOUNT_ID` must be set. Web Analytics keeps about six months; the first sync goes back
  90 days. Accounts with the EU data boundary enabled cannot query Web Analytics (RUM) data through
  the API.

### The "Cited" step of the GEO funnel is empty

Bing AI Performance (citations in Copilot and Bing AI answers) has no API; Microsoft says one is on
its backlog. Export the report as CSV in Bing Webmaster Tools and import it: dashboard →
**Settings** → **Import AI citations**, or

```sh
cloudflared access curl "https://<your-domain>/api/import/ai-citations?site=<id>&date=<YYYY-MM-DD>" \
  -X POST --data-binary @<export>.csv
```

Columns are detected by name: a URL or page column, a citations column, and an optional date column
(without one, every row gets `date`, today by default). The response reports how many rows were
imported and skipped.

### Sync is slow or units are skipped

- The GSC backfill writes up to `SYNC_DAILY_WRITE_BUDGET` rows per UTC day (80,000 by default, under
  D1 Free's 100,000), so the full 16 months take days to weeks. That is expected.
- A sync run that reports "Skipped ... after 3 interrupted attempts" hit a limit repeatedly, usually
  the 10 ms CPU limit of Workers Free. Lower `GSC_ROWS_PER_DAY` (step 14), or move to Workers Paid.
- "Nothing due." means the pass found no work; the next day's increments start after midnight UTC.
- If no runs appear at all, the ready flag is not set: open the dashboard (or call `setup_status`)
  once while the deployment is `ready`.

## Upgrading

Upstream `main` is always deployable. To upgrade:

1. Read [CHANGELOG.md](../CHANGELOG.md) for every version since your last sync. Do what the
   **Upgrade notes** say, if anything (for example a new secret), **before** or right after syncing,
   as the note says.
2. **[Agent or human]** sync your fork:
   - **Dashboard:** `https://github.com/<github-user>/searchkeep` → **Sync fork** → **Update branch**.
   - **CLI:** `gh repo sync <github-user>/searchkeep --source noobnooc/searchkeep --branch main`
3. Workers Builds rebuilds and deploys automatically when the sync touched the watch paths. The
   new Worker applies any new D1 migrations itself on its first request.

If GitHub offers only **Discard commits**, your fork's `main` has commits of its own. Searchkeep keeps
all configuration in secrets, so discarding is safe unless you changed code on purpose.

**Verify:** the new build shows **Success** under the Worker's **Deployments**, and `setup_status`
still reports `ready`.

**Rolling back:** Workers & Pages → `searchkeep` → **Deployments** → choose the previous version →
**Rollback**. Migrations are forward-only and designed to work with the previous release's code, so a
rollback of the code is safe; the database is not rolled back.

## Uninstalling

Delete, in any order: the Worker `searchkeep` (Workers & Pages → Settings → Delete), the D1 database
`searchkeep` (this deletes your history), the Access application and its policy, the custom domain's
DNS record if it remains, the API token `Searchkeep (read-only)`, the Google Cloud service account
key (or project), and the Bing API key if you no longer need it. Finally delete your fork on GitHub.
