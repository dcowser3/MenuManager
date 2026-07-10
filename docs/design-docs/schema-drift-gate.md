# Schema-Drift Gate (Phase A)

> Status: Implemented (warn mode), Jul 2026
> Related: [Automated improvement loop](automated-improvement-loop.md) → "Operational note: Supabase schema drift"

## Problem

Supabase migrations are applied **by hand** in the SQL editor, with no record that
proves the live schema matches what the deployed code expects. When a migration
lags, the db service's Supabase writes fail a constraint and **fall back to a local
JSON file** the improvement cycle can't see — silent data loss. This exact trap
fired four times (missing table, missing link columns, a missing column, a stale
NOT NULL constraint). See the automated-improvement-loop doc's schema-drift note and
the portable writeup for the general pattern.

This is **detection**, not prevention: it turns a silent fallback into a loud,
named signal on deploy. The eventual prevention is auto-applying migrations
(Phase C — Supabase CLI `db push`), which needs a DB-connection secret and a
one-time migration-history baseline; not yet built.

## What it does

`scripts/check-schema-drift.js` compares the repo's declared schema
(`supabase/schema.sql`) against the **live** database and reports drift.

- **Access model:** PostgREST-only (the service-role key), no direct Postgres. It
  reads the live schema from the PostgREST OpenAPI spec (`GET /rest/v1/`), which
  lists each table's columns (`properties`) and its NOT-NULL set (`required`).
- **Pure logic** lives in the tested `services/db/lib/schema-drift.ts`
  (`parseSchemaSql`, `parseOpenApiSpec`, `diffSchemas`, `diffNullableConstraints`);
  the script consumes its compiled dist (same pattern as `improvement-cycle.js`).

### What it checks — and what it deliberately does not

Two signals from PostgREST are reliable; a third is not:

| Signal | Reliable? | Used for |
|--------|-----------|----------|
| Table exists (`definitions` key) | ✅ exact | `missing_table` (error) |
| Column exists (`properties`) | ✅ exact | `missing_column` (error) |
| Column NOT NULL (`required`) | ⚠️ conflates NOT-NULL-**with**-default | curated check only |

`required` lists **every** NOT NULL column *including those with a default* (PKs,
`status DEFAULT 'processing'`, `is_active DEFAULT true`). A schema-wide "required but
schema.sql says nullable" comparison therefore false-positives on nearly every table
(verified: 17 false errors against the live DB). So NOT NULL is checked **only** for
a curated list of columns known to have no default (`NULLABLE_COLUMNS`, currently
`correction_rules.original_text` / `corrected_text`) — where presence in `required`
genuinely means a stale NOT NULL constraint (the July 2026 incident).
`diffSchemas` itself compares existence only.

**Blind spots** (PostgREST doesn't expose them): indexes, CHECK/foreign-key
constraints, column types, defaults, and NOT NULL on non-curated columns. Those are
Phase B/C territory (direct introspection or CLI). The runtime
`correction_rule_mirror_failed` alert (db service) remains the catch-all that fires
on the *first* failed insert regardless of drift kind.

## Behavior & rollout

Controlled by env, set in the **host `.env`** (read into the container by compose),
so flipping is a one-line change + redeploy:

- `SCHEMA_DRIFT_GATE=warn` — **default**; prints findings, writes a
  `supabase_schema_drift` row to `system_alerts` (visible on `/alerts`), exits 0.
- `SCHEMA_DRIFT_GATE=block` — same, but exits non-zero on any error-severity drift.
- `SCHEMA_DRIFT_IGNORE_TABLES=a,b` — escape hatch to skip tables.
- `--dry-run` (CLI flag) — report only; never writes an alert, never fails. For
  local/manual validation.

**Ships in `warn` because prod has a known pre-existing drift**
(`submitter_profiles.name_normalized` is in `schema.sql` — with a UNIQUE index — but
absent live and unused by code; schema.sql is simply ahead). Blocking immediately
would abort the gate's own rollout deploy. Triage that column (add a migration, or
remove it from `schema.sql`), confirm the gate reports clean, then set
`SCHEMA_DRIFT_GATE=block`.

## Where it runs in the deploy

[.github/workflows/deploy-lightsail.yml](../../.github/workflows/deploy-lightsail.yml):
after `docker system prune`, the deploy **builds** the dashboard image, then runs the
gate in a **one-off container before** `compose up`:

```bash
"${COMPOSE[@]}" build dashboard
"${COMPOSE[@]}" run --rm --no-deps -T dashboard node /app/scripts/check-schema-drift.js
"${COMPOSE[@]}" up -d --build --remove-orphans
```

Because the gate runs before the stack is swapped, a `block`-mode failure aborts
(`set -euo pipefail`) with **prod still serving the previous version** — a blocked
deploy is safe, not an outage.

## How you find out a deploy was blocked

1. GitHub Actions **emails the pusher** and marks the run red (native behavior).
2. A `supabase_schema_drift` row appears on the `/alerts` dashboard.
3. The Actions log names the exact table/column and the fix ("apply the pending
   migration in supabase/migrations").

## Extending

- New must-be-nullable column → add it to `NULLABLE_COLUMNS` in
  `services/db/lib/schema-drift.ts` (shared by this gate and the db boot check).
- New load-bearing column the boot check should verify → `CRITICAL_SUPABASE_SCHEMA`
  in `services/db/index.ts`.
- Keep `supabase/schema.sql` current — it is the gate's source of truth for
  expected tables/columns.

## Next (Phase C — prevention)

Adopt the Supabase CLI so the deploy runs `supabase db push` and applies pending
migrations automatically, tracked in `supabase_migrations.schema_migrations`. Needs
the DB-connection secret in the pipeline and a one-time baseline of the 21 existing
hand-applied migrations. At that point drift becomes structurally impossible and this
gate becomes a belt-and-suspenders check.
