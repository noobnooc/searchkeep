## Summary

<!-- What does this change and why? Keep it short. -->

## Linked issue

Closes #

## Charter check

<!-- Tick each principle this change respects. Explain anything that touches one. Earlier principles win on conflict. See docs/charter.md. -->

- [ ] 1. User data stays in the user's own account (no telemetry, no project servers)
- [ ] 2. First-party data only (no backlinks, competitor data or rank scraping)
- [ ] 3. Self-hosted with zero operations (free tier, upgrade by Sync fork)
- [ ] 4. Read-only by default (external writes are opt-in)
- [ ] 5. Core does not depend on any platform (no Cloudflare types outside `apps/cloudflare` and `packages/store-d1`)
- [ ] 6. Docs stay idempotent and verifiable
- [ ] 7. Few dependencies (no new dependency, or justified below)

Notes:

## ADR impact

<!-- "None", or the ADRs this change relates to. A change that contradicts an accepted ADR needs a new ADR approved by a maintainer. -->

None

## Test evidence

<!-- Commands you ran and their results. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm --filter @searchkeep/store-d1 run db:check` (schema or migration changes)
- [ ] `pnpm --filter @searchkeep/cloudflare run size`

## Upgrade notes

<!--
REQUIRED if users must do anything by hand after syncing their fork (new secret, new token permission,
Access setting, re-running a deploy step). Say what, where (click path or command), when (before/after
syncing) and what happens if they skip it. Add the same notes to CHANGELOG.md under "Unreleased".
Write "None" otherwise.
-->

None

## Checklist

- [ ] `CHANGELOG.md` updated under `Unreleased` (including upgrade notes, if any)
- [ ] Docs updated where behavior changed (README, docs/deploy.md, tool descriptions, website facts in `apps/site/src/lib/content.ts`)
- [ ] Migrations are generated, forward-only and safe on the previous release's database
- [ ] No secrets, personal configuration or user data in the diff, logs or this description
- [ ] Touches CODEOWNERS-protected paths (charter, ADRs, `wrangler.jsonc`, migrations, auth, `.github/`, `.claude/skills/`): yes / no
