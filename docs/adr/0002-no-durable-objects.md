# 0002. No Durable Objects in v0.1

- Status: Accepted
- Date: 2026-11-03
- Deciders: @noobnooc

## Context

Several things could use shared state: caching OAuth access tokens for Google, coordinating the
multi-run GSC backfill, and MCP sessions. Durable Objects are the Cloudflare primitive for strongly
consistent shared state. The charter also requires the core to stay platform-independent so that a
Node/Docker or Vercel runtime can be added later.

## Options considered

1. **Durable Objects** for token caches, sync coordination and MCP sessions. Powerful and consistent,
   but it is the hardest Cloudflare primitive to port: there is no drop-in equivalent on Node or
   Vercel, and code written around it tends to leak into the core.
2. **KV** for shared caches. Portable in shape (a key-value store), eventually consistent, and adds
   a binding users must provision.
3. **No shared state primitive**: keep external API access tokens in memory per isolate, keep durable
   progress (such as backfill cursors) in D1, and run MCP statelessly.

## Decision

v0.1 uses no Durable Objects. External API access tokens are cached in memory. Durable state such as
sync progress cursors and the readiness flag lives in D1 through the Store interface. The MCP
endpoint is stateless Streamable HTTP. If tokens ever need to be shared across instances, we add KV
behind an interface, not Durable Objects.

## Consequences

- The core stays portable; a future `apps/node` only needs a Store implementation and a scheduler.
- Each isolate may fetch its own Google access token. At Searchkeep's request volume this is
  negligible.
- Long jobs (the 16-month GSC backfill) must be split into batches that fit one invocation's
  subrequest and CPU limits and resume from a cursor in D1 over several cron runs.
- Revisit if a feature truly needs strong cross-request coordination; that requires a new ADR.
