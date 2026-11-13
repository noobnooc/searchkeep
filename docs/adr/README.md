# Architecture decision records

An architecture decision record (ADR) captures one significant decision: the context, the options
we considered, what we chose and why. ADRs exist so that nobody, human or agent, "fixes" a deliberate
choice without knowing why it was made.

## Rules

- One decision per file, numbered sequentially: `NNNN-short-title.md`.
- Accepted ADRs are not edited except for typos and links. To change a decision, write a **new** ADR
  that supersedes the old one, and set the old one's status to `Superseded by NNNN`.
- New ADRs and status changes need a maintainer's approval (see [charter](../charter.md)). Agents
  must not write or change an ADR on their own initiative: open an issue explaining why a decision
  should change and wait for a maintainer. An agent may draft an ADR in a pull request only when a
  maintainer has asked for it in an issue.
- Pull requests whose change contradicts an accepted ADR must reference a new ADR, or they will not
  be merged.

## Index

| ADR                                                  | Title                                                 | Status   |
| ---------------------------------------------------- | ----------------------------------------------------- | -------- |
| [0001](0001-single-worker-three-entrances.md)        | One Worker with three entrances                       | Accepted |
| [0002](0002-no-durable-objects.md)                   | No Durable Objects in v0.1                            | Accepted |
| [0003](0003-cloudflare-access-for-authentication.md) | Cloudflare Access does authentication                 | Accepted |
| [0004](0004-drizzle-and-store-interface.md)          | Drizzle behind a Store interface                      | Accepted |
| [0005](0005-fork-and-workers-builds-deployment.md)   | Deploy by fork and Workers Builds, no Deploy button   | Accepted |
| [0006](0006-discrete-mcp-tools-not-code-mode.md)     | Discrete, task-shaped MCP tools instead of Code Mode  | Accepted |
| [0007](0007-agent-operations-via-github.md)          | Agent operations only through GitHub issues and PRs   | Accepted |
| [0008](0008-sites-managed-in-the-dashboard.md)       | Sites can be managed in the dashboard                 | Accepted |
| [0009](0009-apps-as-a-second-kind-of-property.md)    | Apps as a second kind of property                     | Accepted |
| [0010](0010-app-revenue-and-engagement.md)           | App revenue and engagement, attributed to acquisition | Accepted |
| [0011](0011-app-store-data-gaps.md)                  | Closing the app data gaps                             | Accepted |

## Template

Copy this into `docs/adr/NNNN-short-title.md`:

```markdown
# NNNN. Title in sentence case

- Status: Proposed | Accepted | Superseded by NNNN | Deprecated
- Date: YYYY-MM-DD
- Deciders: @handle
- Supersedes: (optional) NNNN

## Context

What problem are we solving? What constraints apply (charter principles, platform limits, users)?

## Options considered

1. **Option A**: summary. Pros, cons.
2. **Option B**: summary. Pros, cons.

## Decision

What we chose, stated so that it can be checked in code review.

## Consequences

What becomes easier, what becomes harder, what we must now watch for, and what would make us
revisit this decision.
```
