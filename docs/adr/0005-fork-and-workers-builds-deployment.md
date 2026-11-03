# 0005. Deploy by fork and Workers Builds, no Deploy button

- Status: Accepted
- Date: 2026-11-03
- Deciders: @noobnooc

## Context

Every user runs their own copy of Searchkeep. Upgrades must be effortless (charter principle 3), and
user configuration must never end up in a public repository. A "Deploy to Cloudflare" button copies
the repository into a new, unlinked repository: it is easy once, but upgrades then require manual
merges, and the user's copy drifts from upstream.

## Options considered

1. **Deploy to Cloudflare button.** One click to start, but the created repository has no upstream
   link, so there is no "Sync fork"; upgrades are manual.
2. **Users run `wrangler deploy` from their own machine.** Needs a local toolchain and manual
   upgrades; hard for non-technical users.
3. **Fork plus Workers Builds.** The user forks `noobnooc/searchkeep` and connects the fork to
   Cloudflare Workers Builds. Upgrading is "Sync fork" on GitHub, after which Workers Builds rebuilds,
   applies migrations and deploys.

## Decision

Option 3. There is no Deploy button.

- Workers Builds settings: root directory `apps/cloudflare`, build command `pnpm run build`, deploy
  command `pnpm run deploy` (applies D1 migrations remotely, then `wrangler deploy`), watch paths
  `apps/cloudflare/**` and `packages/**`.
- `wrangler.jsonc` declares bindings by name only (D1 binding `DB`, `database_name: "searchkeep"`,
  no `database_id`); wrangler provisions the database on first deploy and the ID is stored only in
  Cloudflare. Nothing user-specific is ever committed, so syncing upstream never conflicts.
- All user configuration is in Worker Secrets; `keep_vars: true` protects any plain variables set in
  the dashboard from being overwritten on deploy.
- If the Workers Builds build token cannot apply D1 migrations remotely, the Worker applies pending
  migrations itself at startup, tracking them in the same `d1_migrations` table wrangler uses.
- [docs/deploy.md](../deploy.md) is written as an idempotent runbook that an agent can execute
  (fork via GitHub MCP, Workers Builds via the Builds API, Access via the Cloudflare API), with the
  few human-only steps marked.

## Consequences

- Upgrades are one click, and everyone who syncs gets upstream `main`. **`main` must always be
  deployable**, and every migration must be safe to run on any earlier release's database.
- Any change that needs manual user action must carry upgrade notes in the PR and in the CHANGELOG.
- Forks are public: docs and code must never suggest committing personal configuration.
- Users need a GitHub account and must authorize the Cloudflare GitHub App once (a human step).
