# 0001. One Worker with three entrances

- Status: Accepted
- Date: 2026-11-03
- Deciders: @noobnooc

## Context

Searchkeep has three ways in: the dashboard (and the JSON API it calls), the MCP endpoint for AI
clients, and a daily scheduled sync. Users deploy Searchkeep themselves, often with the help of an
AI agent, so every extra moving part is one more thing to configure, secure, upgrade and debug.
The charter requires zero operations and free-tier friendliness.

## Options considered

1. **One Worker with three entrances** (fetch handler for dashboard, `/api/*` and `/mcp`; scheduled
   handler for the cron). One deployment, one set of secrets, one D1 binding, one Access application.
2. **Separate Workers** for MCP, dashboard and sync, joined by service bindings. Clearer isolation,
   but three deployments, three sets of secrets, more Access configuration and more ways for a fork
   to drift out of sync.
3. **Cloudflare Pages for the dashboard plus a Worker for the rest.** Two products, two build
   pipelines, and the dashboard's API would still need the Worker.

## Decision

Users deploy exactly one Worker, `searchkeep`, from `apps/cloudflare`. It serves:

- `/` the dashboard single-page app as static assets, `/api/*` its JSON API and `/api/status`;
- `/mcp` the MCP endpoint (Streamable HTTP, stateless);
- `/setup` a public setup guide and `/healthz` a liveness check;
- the Cron Trigger (`17 3 * * *`) that runs the daily sync.

All three entrances call only `packages/core`, which reads and writes D1 through the Store interface
and calls external APIs through Source adapters. MCP tools and dashboard views use the same analysis
functions.

## Consequences

- One deployment, one place for secrets, one Access application covering one hostname.
- The dashboard and MCP always show the same numbers because they share the code path.
- `packages/mcp` and `packages/dashboard` stay separate packages so a future runtime
  (`apps/node`) can reuse them unchanged.
- The Worker bundle contains everything, so bundle size is checked in CI.
- A bug in one entrance can affect the others; tests cover each entrance.
