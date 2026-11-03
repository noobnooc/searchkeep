# Contributing to Searchkeep

Thanks for helping. Searchkeep is small on purpose, so please read the
[charter](docs/charter.md) before proposing features: it lists what we do, what we explicitly do not
do, and the principles that decide trade-offs.

## Before you start

- **Bugs:** open an issue with the "Bug report" form. Never include secrets, tokens, private keys or
  your analytics data.
- **Features:** open an issue with the "Feature request" form first and wait for a maintainer to
  respond. Features that conflict with the charter (backlinks, competitor data, rank tracking,
  telemetry, anything that sends data out of the user's account) will not be accepted.
- **Security issues:** do not open a public issue. See [SECURITY.md](SECURITY.md).
- **Larger changes** that touch an architecture decision need a new ADR; see
  [docs/adr/](docs/adr/README.md).

## Setup

Requirements: Node.js 22 and pnpm (use the version in the root `package.json` `packageManager`
field; `corepack enable` picks it up).

```sh
git clone https://github.com/<you>/searchkeep.git
cd searchkeep
pnpm install
pnpm build
pnpm test
```

To run the Worker locally:

```sh
pnpm --filter @searchkeep/cloudflare run db:migrate:local
pnpm dev
```

Local configuration goes in `apps/cloudflare/.dev.vars`, which is gitignored. Never commit real
credentials or site lists.

## Workflow

1. Fork the repository and create a branch from `main` (`fix/…`, `feat/…`, `docs/…`).
2. Make your change with tests. Keep pull requests focused: one issue, one PR.
3. Run the checks:

   ```sh
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   pnpm --filter @searchkeep/store-d1 run db:check     # if you touched the schema or migrations
   pnpm --filter @searchkeep/cloudflare run size
   ```

4. Add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
5. Open a pull request and fill in the template, including the charter check and, if users must do
   anything by hand after syncing, the **Upgrade notes**.

The `ci` check and a review from a code owner are required before merging. Maintainers merge; they
usually squash.

## Conventions

The full list is in [AGENTS.md](AGENTS.md) and applies to humans too. The short version:

- TypeScript strict, ES modules, prettier formatting.
- `packages/core` uses only Web standard APIs. No Cloudflare types outside `apps/cloudflare` and
  `packages/store-d1`. Analysis SQL lives only in `packages/store-*`.
- Few dependencies. Ask before adding one.
- Migrations are generated with `pnpm --filter @searchkeep/store-d1 run db:generate`, are
  forward-only, and must work on the previous release's database. Never edit a merged migration.
- Everything is in English.
- Commit messages: imperative mood, a short summary line, a body that explains why.

## Pull request checklist

- [ ] Linked issue, and the change stays within the [charter](docs/charter.md).
- [ ] Typecheck, lint, tests, build, `db:check` (if relevant) and size check pass.
- [ ] Tests cover the change.
- [ ] Docs updated where behavior changed.
- [ ] `CHANGELOG.md` updated; **Upgrade notes** in the PR and the changelog if users must act.
- [ ] No secrets, personal configuration or user data anywhere in the diff or the PR text.

## Working with AI agents

Agents working on this repository must follow [AGENTS.md](AGENTS.md). Automated maintenance runs use
the [maintain skill](.claude/skills/maintain/SKILL.md).

### Claude Code users: keep AGENTS.md loaded

This repository intentionally has **no `CLAUDE.md`**. Claude Code reads `AGENTS.md` when there is no
`CLAUDE.md`. But if you add a personal `CLAUDE.md` or `CLAUDE.local.md` anywhere in your working
directory or its parent directories, Claude Code reads those **instead of** `AGENTS.md`, and the
project's agent instructions silently stop applying.

If you want personal instructions, set Claude Code's **Project instructions** setting to
`claude-md-and-agents-md` so it reads both. `CLAUDE.md` and `CLAUDE.local.md` are gitignored; do not
commit them.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
