# 0006. Discrete, task-shaped MCP tools instead of Code Mode

- Status: Accepted
- Date: 2026-11-03
- Deciders: @noobnooc

## Context

Searchkeep exposes its analysis to AI clients over MCP. Cloudflare's "Code Mode" pattern replaces
many tools with two (search the API, then execute model-written code in a sandbox), which saves
context when an API has thousands of endpoints. We had to choose the shape of our MCP surface.

## Options considered

1. **Code Mode**: a discovery tool plus an `execute` tool running model-written code against our
   API in a sandbox.
2. **Discrete, task-shaped tools**: about a dozen tools that each answer one analysis task
   (`find_quick_wins`, `geo_funnel`, ...), each aggregating on the server.
3. **Thin CRUD tools** mirroring tables. Flexible, but pushes aggregation into the model's context.

## Decision

Option 2: discrete, task-shaped tools. v0.1 ships 13: `list_sites`, `query_performance`,
`compare_periods`, `find_quick_wins`, `find_cannibalization`, `find_ctr_anomalies`,
`find_content_decay`, `geo_funnel`, `ai_crawlers`, `inspect_url`, `list_sitemaps`,
`submit_sitemap` (off by default) and `setup_status`. Tools call only the core.

Why not Code Mode:

1. **Scale.** Code Mode is designed for APIs with thousands of endpoints. A dozen tools listed in
   full cost very little context.
2. **Sandbox availability.** Safely running model-written code relies on Dynamic Workers, which are
   currently available only on paid Workers plans, and Code Mode itself is still experimental. That
   conflicts with free-tier friendliness.
3. **Per-tool safety annotations.** Discrete tools can each be marked read-only or writing, so
   clients can auto-approve every query tool and ask for confirmation only on `submit_sitemap`. A
   single `execute` tool makes that impossible.
4. **No dependency on Cloudflare's sandbox**, which keeps the MCP package portable to other runtimes.

What we borrow from Code Mode:

- Analysis tools aggregate on the server and return compact results with a built-in row limit, so
  context use stays small.
- Possible later: an optional read-only SQL escape hatch (`describe_schema` and `run_query`) that
  allows only a single `SELECT`, limits rows and run time, and reads only stable views, never raw
  tables.
- Possible later: when tools multiply or the user is on a paid plan, wrap the existing tools as an
  optional Code Mode entrance with `@cloudflare/codemode`'s `codeMcpServer`, without redesigning them.

## Consequences

- New capabilities usually mean a new tool; adding a tool needs a maintainer decision (charter).
- Tool names and parameters are a public contract; renames need a deprecation period and upgrade
  notes.
- Shared filters (`site`, dates, `source`, `brand`, `limit`) keep tools consistent.
