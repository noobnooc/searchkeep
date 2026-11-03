# Maintainer guide

One-time repository setup and recurring duties for maintainers of `noobnooc/searchkeep`.
Maintainers are the owners listed in [`.github/CODEOWNERS`](../.github/CODEOWNERS) and the
repository admins; initially that is @noobnooc.

The rules these settings enforce are described in [ADR 0007](adr/0007-agent-operations-via-github.md)
and [AGENTS.md](../AGENTS.md).

## 1. Create the agent's GitHub identity

The maintenance agent must use its own identity, never a maintainer's personal token. Choose one:

**Option A: GitHub App (recommended).**

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**.
2. Name: `searchkeep-agent` (or similar). Homepage: `https://searchkeep.dev`. Turn **off** webhooks.
3. **Repository permissions:** Contents **Read and write**, Issues **Read and write**, Pull requests
   **Read and write**, Metadata **Read** (mandatory). Optionally Actions **Read** and Checks **Read**
   so the agent can read CI logs. Everything else: **No access**.
4. **Where can this GitHub App be installed?** Only on this account.
5. Create the app, generate a private key, then **Install App** → only `noobnooc/searchkeep`.
6. Give the runtime that runs the agent the app ID, installation ID and private key (as secrets of
   that runtime, never in this repository). It exchanges them for short-lived installation tokens
   and exports one as `GH_TOKEN` for `gh` or the GitHub MCP server.

**Option B: fine-grained personal access token on a dedicated machine account.**

1. Create a separate GitHub user for the agent (for example `searchkeep-bot`) and invite it as a
   collaborator with the **Write** role.
2. Signed in as that user: **Settings** → **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
3. Resource owner: `noobnooc`; **Only select repositories** → `searchkeep`; expiration 90 days or
   less.
4. **Repository permissions:** Contents, Issues and Pull requests **Read and write**; Metadata
   **Read**; optionally Actions and Commit statuses **Read**. Nothing else.
5. Store the token only in the agent runtime's secret store as `GH_TOKEN`. Rotate it before it
   expires.

Either way the agent identity must **not** be a repository admin, must not be listed in CODEOWNERS
and must not be on any bypass list. The maintain skill never treats it as a maintainer.

**Verify:** with the agent's token, `gh api user --jq .login` (PAT) or
`gh api /repos/noobnooc/searchkeep --jq .permissions` shows write but not admin access, and a test
`git push origin HEAD:main` from the agent is rejected by branch protection.

## 2. Protect `main`

Repository → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**
(or the classic **Branches** → **Add branch protection rule**):

- Name `main`, enforcement **Active**, target **Default branch**.
- **Restrict deletions** and **Block force pushes**.
- **Require a pull request before merging**:
  - Required approvals: 1.
  - **Require review from Code Owners**.
  - **Dismiss stale pull request approvals when new commits are pushed**.
  - **Require conversation resolution before merging**.
- **Require status checks to pass**: add the check **`ci`** (the job in
  [`.github/workflows/ci.yml`](../.github/workflows/ci.yml); it appears in the list after the
  workflow has run once). Turn on **Require branches to be up to date before merging**.
- **Bypass list:** empty, or repository admins only. Never add the agent identity.

GitHub does not let authors approve their own pull requests. With a single maintainer you can either
add the repository admin role to the bypass list (and use it only for your own PRs) or ask another
trusted reviewer.

Also under **Settings** → **General**: allow **Squash merging**, turn on **Automatically delete head
branches**, and under **Settings** → **Code security** enable **Private vulnerability reporting**,
**Dependabot alerts** and **Dependabot security updates**.

**Verify:** a test PR from the agent shows "Review required" from a code owner and the `ci` check as
required, and the merge button stays disabled until both pass.

## 3. Labels

The label set lives in [`.github/labels.yml`](../.github/labels.yml) and is synced by the
**Sync labels** workflow on every push to `main` that changes that file. Run it once by hand after
the first merge: **Actions** → **Sync labels** → **Run workflow**. The workflow creates and updates
labels; it never deletes labels that are not in the file.

| Label                         | Meaning                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `type:bug` … `type:security`  | Kind of work. Set during triage.                                               |
| `priority:p0` … `priority:p3` | p0: broken for users now; p1: next up; p2: normal; p3: nice to have.           |
| `status:triage`               | New; waiting for triage and a maintainer decision.                             |
| `status:needs-info`           | Waiting for the reporter.                                                      |
| `status:agent-ready`          | **Maintainer approval**: an agent may implement this. Only maintainers add it. |
| `status:agent-in-progress`    | Claimed by an agent run.                                                       |
| `status:needs-human`          | An agent needs a maintainer decision; answer in the issue.                     |
| `status:blocked`              | Waiting on something external.                                                 |
| `agent-proposal`              | Written by an agent; needs maintainer approval like any other issue.           |
| `out-of-scope`                | Conflicts with the charter; a maintainer decides whether to close it.          |
| `agent-log`                   | The monthly agent log issues.                                                  |

**Approving work for the agent:** read the issue, edit it until it is unambiguous, then add
`status:agent-ready`. The agent checks the issue timeline to confirm a maintainer added the label,
and ignores the approval if someone else edits the issue body afterwards; re-add the label to
re-approve.

## 4. Schedule the maintain skill

The skill is [`.claude/skills/maintain/SKILL.md`](../.claude/skills/maintain/SKILL.md). Each run is
independent and reads all state from GitHub, and a lock comment prevents overlapping runs, so any
scheduler works. Run it at most a few times a day; once a day is the default.

- **Claude Code scheduled task (cloud):** create a scheduled task on a session with this repository
  attached and the agent's `GH_TOKEN` configured as an environment secret. Prompt:
  `Run the maintain skill (/maintain) for noobnooc/searchkeep.` Schedule: daily, at a time outside
  your working hours.
- **Long-running session:** in Claude Code, `/loop 24h /maintain`.
- **Headless on a machine you control:** a cron job that runs, in a fresh clone,
  `claude -p "/maintain"` with `GH_TOKEN` set to the agent's token and the permission mode your
  setup requires.

Other agents can run the same skill by following the file as a runbook.

Before the first run, create the first log issue yourself or let the agent do it: title
`Agent log: YYYY-MM` (current UTC month), label `agent-log`, pinned.

**Verify:** after a run, the month's log issue has a new comment with a summary, next steps and a
hidden `agent-state` block, and no stale lock comment remains.

## 5. Recurring duties

- **Review agent PRs.** Check the charter checklist, the ADR impact, the tests and the upgrade notes.
  Files covered by CODEOWNERS (charter, ADRs, `wrangler.jsonc`, migrations, auth code, `.github/`,
  `.claude/skills/`) need particular care.
- **Answer `status:needs-human` issues** in the issue itself, so the decision is recorded where the
  next run will read it.
- **Triage decisions:** close `out-of-scope` issues or remove the label; approve proposals with
  `status:agent-ready`.
- **Keep `main` deployable.** Every merge reaches users the next time they sync their fork.

## 6. Releases

Only maintainers create tags and releases; agents never do.

1. Make sure `main` is green and that `CHANGELOG.md` has an `Unreleased` section describing all
   merged changes, with **Upgrade notes** where users must act.
2. Rename `Unreleased` to `[X.Y.Z] - YYYY-MM-DD`, add a fresh empty `Unreleased` section, and update
   the comparison links at the bottom. Merge that change through a PR.
3. Tag and release from `main`:

   ```sh
   git switch main && git pull
   git tag -s vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(sed -n '/^## \[X.Y.Z\]/,/^## \[/p' CHANGELOG.md | sed '$d')
   ```

4. Start a new `docs/roadmap.md` section if the release closes a version's scope.
5. Update the website: `version` and `releaseDate` in `apps/site/src/lib/site.ts`, and the release
   entry in `apps/site/src/routes/changelog/+page.svelte`.

Users who "Sync fork" follow `main`, not tags, so tags mark versions for the changelog and for
people who want to pin a release.

## 7. The website (searchkeep.dev)

The website in `apps/site` is deployed by the project, never by users: their Workers Builds watch
paths (`apps/cloudflare/**`, `packages/**`, `pnpm-lock.yaml`) leave it out, and the workflow below
is skipped in forks.

**How it is hosted.** The site is a small Worker, `searchkeep-site`
([`apps/site/wrangler.jsonc`](../apps/site/wrangler.jsonc)), that serves the prerendered SvelteKit
build from its own bundle. `pnpm --filter @searchkeep/site run build` prerenders the site and
`apps/site/scripts/embed-build.mjs` packs it into `apps/site/worker/files.generated.js`
(gitignored), so a deploy is a single script upload. The Worker answers on `searchkeep.dev`,
redirects `www.searchkeep.dev` and other subdomains to it, and serves canonical URLs without `.html`
or trailing slashes. Both hostnames are custom domains declared in `wrangler.jsonc`; `workers.dev`
and preview URLs are off.

**Automatic deploys.** [`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml)
builds and deploys the site on every push to `main` that changes `apps/site/**`, `pnpm-lock.yaml` or
the workflow itself. It can also be started by hand: **Actions** → **Deploy website** → **Run
workflow**. It needs two repository secrets (**Settings** → **Secrets and variables** →
**Actions**):

| Secret                  | Value                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | API token with **Workers Scripts: Edit** on the account, and **Workers Routes: Edit** and **DNS: Edit** on the `searchkeep.dev` zone |
| `CLOUDFLARE_ACCOUNT_ID` | The account that owns the `searchkeep.dev` zone                                                                                      |

Until the token is set, the job logs "CLOUDFLARE_API_TOKEN is not set; skipping the website deploy."
and succeeds without deploying.

**Manual deploy** (maintainers only, with the same token and account ID exported in the shell):

```sh
pnpm --filter @searchkeep/site run build
cd apps/site && npx wrangler deploy
```

**Keeping it accurate.** Product facts on the site (tool names, parameters and defaults, secrets,
readiness states) live in `apps/site/src/lib/content.ts` and feed the docs pages, `llms.txt` and
`llms-full.txt`. Update them in the same pull request that changes `packages/mcp`,
`packages/core/src/config.ts` or `apps/cloudflare`, and keep `/docs/deploy` in line with
[docs/deploy.md](deploy.md).

**Verify:** the latest **Deploy website** run succeeded; `curl -sI https://searchkeep.dev/` returns
`200`; `curl -sI https://www.searchkeep.dev/` returns `301` with `location: https://searchkeep.dev/`;
and `https://searchkeep.dev/llms.txt` shows the current version.
