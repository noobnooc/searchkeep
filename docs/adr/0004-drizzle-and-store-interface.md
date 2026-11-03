# 0004. Drizzle behind a Store interface

- Status: Accepted
- Date: 2026-11-03
- Deciders: @noobnooc

## Context

v0.1 stores data in Cloudflare D1 (SQLite). The roadmap includes a Postgres store for a future
Node/Docker runtime. Analysis queries (quick wins, cannibalization, decay, funnels) are the heart of
the product and are SQL-heavy. Users upgrade by syncing their fork, so a broken migration reaches
every deployment at once.

## Options considered

1. **Raw SQL in the core.** Fast to write, but ties the core to one SQL dialect and to D1's API.
2. **A full ORM with its own runtime abstractions.** Heavier bundle, more dependencies, less control
   over the generated SQL.
3. **Drizzle ORM in a store package, behind a Store interface defined in the core.** Drizzle is
   small, typed and works on D1 and Postgres; `drizzle-kit` generates migrations. The core calls only
   Store methods.

## Decision

- `packages/core` defines a `Store` interface (data reads and writes plus analysis queries).
- `packages/store-d1` implements it with Drizzle `sqliteTable` schemas and owns all D1 migrations
  (`packages/store-d1/migrations`, generated with `pnpm --filter @searchkeep/store-d1 run db:generate`).
- **Analysis SQL lives only in `store-*` packages.** The core never builds SQL.
- Each source has its own raw table; sync jobs roll them up into one unified fact table
  (date, source, page, query, metrics). Analysis reads only the fact table.
- A shared Store interface test suite runs against local D1 from v0.1. A future `store-pg`
  (copying the schema to `pgTable`) is done when it passes the same suite.
- Migrations are forward-only and idempotent, and CI applies them on top of the previous release's
  database (`db:check`).

## Consequences

- Adding Postgres means a new package, not a core rewrite.
- Some analysis SQL will be written twice (SQLite and Postgres dialects); the shared tests keep them
  equivalent.
- Migrations and the schema are covered by CODEOWNERS and always need human review.
