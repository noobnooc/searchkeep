# 0008. Sites can be managed in the dashboard

- Status: Accepted
- Date: 2026-11-04
- Deciders: @noobnooc

## Context

The v0.1 plan kept all user configuration, including the list of sites, in Worker Secrets. For the
site list this meant writing a JSON array by hand, with identifiers (zone IDs, Web Analytics site
tags, Search Console property names) that a beginner has to hunt for in three different consoles. A
typo was only reported after deploying. The maintainer asked for sites to be entered in the
dashboard instead.

## Options considered

1. **Keep `SITES` as the only source.** Simple and declarative, but the hardest part of the setup for
   non-technical users.
2. **Move sites to D1 and drop `SITES`.** One source of truth, but breaks existing deployments and
   scripted setups that agents run from docs/deploy.md.
3. **Store dashboard-managed sites in D1 and keep `SITES` as an optional, read-only source.**

## Decision

Option 3. Sites added in the dashboard live in the `site_configs` table. The Worker merges them with
the sites from `SITES` on every entrance (dashboard API, MCP, cron); on an `id` conflict the secret
wins and the dashboard shows the site as read-only. Every site goes through the same validation in
core (`validateSite`). The dashboard offers suggestions from what the configured credentials can
see (`discoverSources`), so most identifiers can be filled in automatically.

## Consequences

- Secrets still hold credentials and access settings. Site definitions are not secret, and keeping
  them in the user's own D1 respects principle 1 (data stays in the user's account).
- Adding sites from the dashboard is a write to the user's own database only. It is not a write to
  an external system, so principle 4 (read-only by default towards external systems) is unaffected.
- Removing a site deletes only its configuration; data already synced stays in D1.
- Optional extra token permissions (Zone: Read, Account Settings: Read) make the zone and Web
  Analytics pickers work; without them the fields are typed by hand.
