# Client platform implementation specification

Status: IMPLEMENTATION AUTHORIZED IN AN ISOLATED WORKTREE. Version 1, 2026-09-07.

Owner: task `01a07dda-0a48-7c20-98b3-ebcfbe6c5065` (this architecture/spec task). Worker: **gpt-5.6-luna, xhigh**. This selects the coding worker only: do not change application model/provider/settings.

This is the executable scope for [the architecture review](../client-platform-architecture-review.md). If that review is less specific or disagrees, this spec wins. Complete M0–M8 below; M0 alone or a collection of interfaces is not delivery. Keep a milestone ledger and continue autonomously through the implementation and synthetic verification. No estimate or declaration of completion substitutes for the acceptance evidence.

## 1. Outcome and scope

Deliver one reusable menu product with:

1. Canonical menu approval independent of ClickUp.
2. Independent task, document-publication and notification adapters, including intentional `none` modes.
3. Complete standalone submission → staff review → approval → approved-document download, including design review, with **no ClickUp container, token, URL or task ID**.
4. Validated per-client identity/configuration, safe initialization and a deliberate legacy-to-active transition.
5. Durable delivery/inbox processing, immutable artifacts, idempotent commands and clear database ownership.
6. Staff authentication, role/property authorization, and a small versioned command API usable by a later custom work-management product.
7. One versioned application release deployable using separate client configuration, secrets, database and storage.

Keep separate deployments/databases per client. No shared-tenancy conversion. Do not build a full task-board UI, comments system, generic workflow designer, plugin marketplace, arbitrary third-party adapter, Kafka stack, or extra network service per module. The custom-board extension point and its fake contract consumer ARE in scope; the board product is not.

No production deployment, production migration, real staff invitation/email, real ClickUp/SharePoint action, paid model/evaluation run, prompt/rule approval, or changes to the active learning-evaluation checkout are authorized. Local implementation, dependency installation/builds, disposable Docker tests, synthetic SQL migrations, docs and commits in the worker's own worktree are authorized. Keep the current task model/effort; do not create additional workers.

## 2. Mandatory bootstrap and workspace rules

The authoritative source contains many uncommitted and untracked changes. A new worktree's HEAD is NOT the full starting implementation. The coordinator supplies a frozen source archive, SHA-256 manifest, protected-file manifest and bootstrap utility under the absolute handoff artifact directory given in the worker prompt.

Before code edits:

1. Read this spec and `AGENTS.md` from the newly created worktree. Confirm its real path is neither `/Users/deriancowser/Documents/MenuManager` nor another task's worktree.
2. Run the supplied bootstrap utility exactly as the handoff prompt specifies. It verifies the expected HEAD, clean tracked/untracked state, archive/manifest hashes, safe paths, source bytes and deletion list before materializing the current source. Never independently recopy a live checkout.
3. Commit the materialized source as a clearly labeled **imported baseline**, separate from all worker implementation commits. Record baseline commit, supplied snapshot ID/digest, copied-file count and protected-file digest in `docs/design-docs/client-platform-implementation-ledger.md`.
4. Run baseline focused tests in disposable Docker. Record pre-existing failures with evidence; do not silently relax assertions. A failure unrelated to this scope does not authorize changing the learning implementation.
5. Add a worker branch prefixed `codex/` if the app provided a detached worktree. Do not reset, stash, merge into, rebase, rebuild or restart the original checkout. Do not mutate the original's Git index or source. Do not auto-merge or deploy the result.

For repository source, only read the supplied frozen snapshot and the worker's own files after bootstrap. Official external API documentation remains available for implementation research. Do not periodically synchronize with active source. If frozen inputs are incomplete, report the exact absent dependency to the coordinator instead of constructing a new baseline from live files.

Protected source/test scopes, with exact hashes supplied in the snapshot manifest:

- `scripts/*review-eval*`, `scripts/improvement-cycle.js`, prompt optimization/rewrite/code-proposal/evaluation/proof scripts and their `scripts/lib` helpers.
- `sop-processor/qa_prompt.txt`, review rule manifests, `services/ai-review/**`, `services/llm-adapter/**`, `services/differ/**`, `services/diff-core/**`.
- Dashboard review/learning/guard/receipt/canonical/prompt/evaluation modules and their corresponding tests, specifically the files enumerated in `protected-files.json`.
- Existing document-review/extraction algorithms and Python sources. New wrappers/synthetic fixtures are permitted; algorithm changes are not.

Dashboard/DB/ClickUp entrypoints and approval/submission wrappers necessarily overlap existing work. They may change **inside this independent snapshot**. Preserve the imported functionality and protected callback payloads. Do not treat the imported baseline commit as worker-authored implementation. Generated outputs corresponding to protected source should remain byte-identical unless an unavoidable compiler-only difference is separately reviewed; never hand-edit protected `dist`.

## 3. Fixed module ownership

Create these TypeScript library workspaces, with local `typescript` devDependencies and `build` scripts. None opens an HTTP listener:

| Workspace/path | Owns | Must not own/import |
| --- | --- | --- |
| `services/workflow-core/src/{types,commands,ports,delivery-plan}.ts` | Typed application commands, eligibility, revisions, stage policy, operation intent/results | Express, dashboard modules, ClickUp/Graph/SMTP SDKs, file paths supplied by browsers |
| `services/document-artifacts/src/` | Artifact ingest/materialization, hashes, immutable storage and calls to existing Python/document utilities | Approval authorization, remote task transitions, new review algorithms |
| `services/integration-adapters/src/task/` | ClickUp task/attachment/assignment/status and remote reconciliation | Canonical menu approval decisions |
| `services/integration-adapters/src/publication/` | SharePoint publishing/retrieval and destination mapping | ClickUp service or task credentials |
| `services/integration-adapters/src/notification/` | Reuse existing Graph/SMTP transport/templates, classified delivery outcome | Invented recipients, approval-state mutation |
| `services/staff-auth/src/` | Session/actor verification, role/property policy and CSRF/origin enforcement | Review algorithms or browser-supplied privileges |
| `services/db/lib/workflow-{commands,deliveries,store}.ts` | Authoritative transaction/queue/inbox/reference implementation and validation | Provider network calls inside a transaction |
| `scripts/workflow-worker.js` | Bounded delivery/inbox/derivation worker using the above modules | App listener, production scheduler/evaluation queue, paid model dispatch |

Update workspace build ordering in both Dockerfiles and `scripts/dev-test.js` for the added libraries. Prefer topological explicit ordering for these known workspaces; do not add a build system. Preserve npm lock consistency and source-first/generated-output conventions.

Existing HTTP services keep their ports. `clickup-integration` becomes an optional compatibility/webhook bridge; its entrypoint imports reusable adapters/core and delegates. Dashboard invokes workflow-core through typed DB/artifact ports. DB owns all canonical writes for migrated operations. A task-none deployment must not resolve or call `CLICKUP_SERVICE_URL` in its menu/design/SharePoint flow.

Keep the existing Graph/SMTP selection and artifact naming/archive behavior while extracting them. Existing approval function factories are the starting seams; replace `axios:any`/provider URL dependencies in new core code with domain operations. Do not merely move the entire ClickUp entrypoint into a new differently named service.

## 4. Tenant configuration, identity and activation

### 4.1 Schema v2

Extend the current `TenantConfig`; preserve existing presentation/template/rulebook fields and arrays. Add these required v2 fields (all enums are closed):

```ts
schemaVersion: 2;
tenantId: string; // immutable UUID for this deployment, not shared DB tenancy
workflow: {
  reviewOwnership: 'internal' | 'external';
  directHandoff: { enabled: boolean; staffUserIds: string[] };
  approvalStages: Array<{
    key: string; label: string;
    appliesTo: 'menu' | 'design';
    role: 'reviewer' | 'designer' | 'admin';
    requiredDecisions: number; // positive integer
  }>;
};
integrations: {
  task: { provider: 'none' | 'clickup'; connectionId: string | null };
  publication: { provider: 'none' | 'sharepoint'; connectionId: string | null };
  notification: { provider: 'none' | 'existing-mail'; connectionId: string | null };
};
auth: { provider: 'supabase'; publicSubmissions: boolean };
```

Provider-specific nonsecret settings live in a sibling `connections.json`, keyed by stable `connectionId`, with provider and immutable account/destination identity plus existing status/assignment/routing values. Credentials remain in environment variables, referenced by approved variable names; never put secret values in config, jobs, URLs or logs. Initially support at most one active connection per channel. Keep historical connection entries available to reconcile existing jobs.

`none` requires `connectionId:null`, creates no delivery jobs and emits no missing-provider warnings. Enabled providers require matching connection definitions and all necessary credentials. ClickUp webhook mode requires a webhook secret: the current signature bypass when secret is absent is forbidden in active mode. Publication-only must validate no ClickUp settings. `reviewOwnership:'external'` is invalid with task provider none; internal review still owns final authorization. Direct handoff is an explicit staff capability; never derive authorization from an email string or successful task creation.

Validation must reject wrong types, unsupported schema/enum, duplicate/empty stage keys, impossible approval counts, unknown connection IDs, out-of-root template paths, invalid recipient addresses and missing required identity. Empty optional recipient lists must remain empty. Generic presentation defaults are allowed; compiled RSH identities, recipients, rulebook content and property destinations are not fallback defaults for v2 or missing production config.

Menu stages permit `reviewer|admin`; design stages permit `designer|admin`. Active v2 requires at least one required menu stage and one required design stage. Administrators may satisfy any stage role, but one administrator counts as only one distinct decision. Activation verifies that required counts are achievable by active eligible staff for every configured property.

### 4.2 Deployment identity and migration

Add singleton `deployment_identity` with `tenant_id UUID`, `config_schema_version`, `activation_state` (`setup|legacy|active|suspended`), and activation timestamps. Configuration/database tenant mismatch prevents startup of data routes/workers. Health may respond with redacted setup/error state. A config path change must never silently switch the business using an existing database.

Provide `scripts/client-platform-migrate.js` and `scripts/client-platform-activate.js`, **dry-run by default**, emitting counts/IDs/hashes and a plan. `--apply` exists for an operator later and for disposable fixtures now. The implementation task may apply only to its synthetic local stores.

- Legacy migration explicitly materializes the current effective configuration into a separate v2 output bundle, assigns/persists one tenant UUID, preserves effective values and creates `legacy` identity. Do not overwrite the active `config/tenant.json` or rollout flags automatically.
- A successfully parsed, valid configuration with absent `schemaVersion` is schema v1; a missing/malformed file is never v1. Valid v1 with confirmed absent identity/table retains existing routes, reports nonfatal `migration_required`, and disables new commands/workers. Valid v1 with `legacy` identity also retains legacy behavior, provided its effective configuration hash matches the hash persisted by migration. V1 with `setup`, `active`, or `suspended` identity fails closed as a schema downgrade. V2 requires matching persisted identity; absent identity exposes setup health only until explicit initialization/migration. An identity lookup connection/authentication error is never absence. Active/suspended identities cannot return to legacy through configuration changes. Never select the legacy lane from hostname, business name or missing provider credentials.
- A fresh v2 database starts `setup`. Activation validates schema, config, artifact root, provider config, at least one active bound administrator and positive login/permission checks; then switches to `active` atomically. Suspended denies application data access and dispatch.
- Activation is an operator rollout step, not something the worker does to production. Tests must exercise both legacy compatibility and active v2.

With a valid matching v2 bundle, `setup`/`legacy` permit login/request/verify/logout and authenticated bootstrap self-checks solely for activation preparation. These endpoints grant no application-data access; established v1 compatibility routes remain independently governed by the matrix above. Activation requires a recent (within15 minutes) nonrevoked session for the bound administrator, matching tenant/configuration hash; a caller-supplied "login passed" flag is insufficient. Missing configuration, identity mismatch and suspension also block bootstrap access.

Remove RSH property INSERTs and routing UPDATEs from the **fresh structural schema** in `supabase/schema.sql`; move their data into the existing business's explicit bootstrap bundle. Do not rewrite historical migration files or delete existing client rows. Remove name-based compiled SharePoint routing defaults from active initialization. Fresh tenants seed only their own properties. Migrating an existing store preserves rows.

Runtime/approved rulebooks are protected inputs. Migration must preserve existing approved DB prompt and runtime file bytes/hashes. In a genuinely fresh isolated client, after identity validation, approved DB prompt wins if present; otherwise seed from that client's bundle. Changing profile or upgrading must not replay the checked-in RSH runtime prompt. Implement runtime seed/identity selection in new wrapper/bootstrap code, without editing the protected prompt or prompt-building algorithms.

## 5. Canonical workflow commands and semantics

Use current public submission-ID resolution; legacy IDs are strings, not invariably UUIDs. Introduce `workflow_version BIGINT NOT NULL DEFAULT 0` for optimistic concurrency. New command IDs are UUIDs and persist across browser retries, refresh and provider retries.

Common envelope: `commandId`, `commandType`, `submissionId`, `expectedVersion`, optional `artifactId`, validated `payload`, and server-derived actor/source context. Hash canonical semantic request JSON (stable key order); exclude transport headers, secrets and transient session tokens. Include actor identity, source event, artifact SHA and all behavior-affecting inputs.

| Command | Required behavior |
| --- | --- |
| `RequestMenuReview` | Requires a reserved submission-attempt identity and prepared original artifact. Atomically create/finalize that submission, record review ownership independent of task delivery, and enqueue configured confirmation/task work once. Preserve existing applicable pending-review status. No duplicate direct mail/task call from the old handler. |
| `ApproveMenu` | Inputs include staged approved artifact, changesMade, source and optional existing menu-collision decision. Validate actor, allowed stage, current version and artifact. Atomically commit decision/stage progression, approved content/artifact, applicable menu linkage/current-version pointer and jobs. Final `approved` occurs only after all configured required stages pass. |
| `RecordDesignReview` | Persist PDF/findings and review record with a transaction-bound check that its source submission remains the current approved menu version. Existing blocking findings remain blocking. Passing machine comparison is evidence; active v2 requires configured authorized human design decisions before final approval. Preserve legacy interpretation in the compatibility lane. |
| `ApproveDesign` | Authorized design-stage decision, expected version/current source check and staged PDF reference. Final approval/enabled jobs when required design decisions complete. Cannot substitute a task status for authorization. |
| `OverrideDesignReview` | Administrator only, nonempty reason, existing blocked design, fresh source/version. Persist `approved_override`, actor/time/reason/audit and enabled jobs. |
| `RetryDelivery` | Authorized retry of an existing delivery with preserved operation key/history; does not create an approval event or change approval state. Reconciliation required before resend of ambiguous operations. |

Multiple distinct staff decisions may satisfy a stage; the same actor cannot satisfy the same stage twice. Introduce an immutable `approval_round_id` binding one candidate artifact SHA, source menu revision and policy snapshot. This is separate from `workflow_version`, which increments on decisions. Enforce unique `(approval_round_id,stage_key,actor_user_id)`; all counted decisions belong to that same round/artifact. After the first decision, changed candidate bytes are rejected with `409 APPROVAL_CANDIDATE_CHANGED`; the UI must expose an authorized explicit restart-review command that closes the old round and starts a new one with zero counted decisions. Replacement approval of a previously final artifact likewise starts a new round. Preserve all prior decisions. A stage-two SHA-B can never inherit a stage-one SHA-A decision. Stages execute in configured order per appliesTo. Snapshot policy when review begins; a restart uses the current policy and records that choice. Otherwise configuration edits do not silently change in-flight requirements. Chef-supplied approver names/emails/attestations are metadata, not authenticated staff decisions.

Add `RestartApprovalReview` to the allowlisted typed commands: the same role/property authority as starting the corresponding menu/design review, current expectedVersion, prepared replacement candidate and nonempty reason are required; it closes only the in-progress round and cannot erase finalized history. A new final-menu replacement still uses explicit `ApproveMenu mode:'replacement'` and a fresh round.

Only the final required stage changes canonical approved content/artifact, menu-current pointer and post-approval jobs. Intermediate decisions save candidate/round progress only. During a replacement round, the prior approved artifact/current pointer remains available until the new round completes. Direct handoff changes work ownership and never waives required staff decisions.

Submission creation also needs retry safety. Persist a `workflow_submission_attempts` reservation binding the staff actor or hashed public attempt capability, stable submission ID, command ID and 24-hour expiry before document generation/submission creation; attach original artifact ID/SHA after preparation. Retries of `/form/submit` use the same attempt/command/submission identity. RequestMenuReview commits the initial canonical submission and jobs together; a crash before/after that commit cannot create a second submission or duplicate confirmation. Run applicable legacy continuation/AI-trigger work only for the first accepted submission operation, never a replay. Artifact preparation is reusable for the reserved attempt, without treating a mutable browser pathname as identity. Do not fix approval idempotency while leaving new-submission retries as fresh random IDs.

Keep canonical content state `pending_human_review`/other established pending values → `approved`, and blocked design `needs_correction` → `approved` or `approved_override`. Stage-progress records are separate; do not invent arbitrary new submission status values without updating every reader. External task delivery never decides `sent_to_marketing`; workflow policy records intended work ownership independently and delivery status records whether the external system caught up.

`ApproveMenu` supports `mode:'initial'|'replacement'`. Initial requires characterized eligible pending states. An already-approved version with the same artifact SHA returns its existing approval without effects. Different approved content requires explicit replacement mode, current expectedVersion and reviewer authorization; preserve old artifacts/decisions. This supports a later corrected attachment without silently overwriting history. Deleted submissions cannot be approved. Menu-name collision still returns the existing `409 needsMenuDecision` response without committing an approval.

Errors: `400 INVALID_COMMAND`, `401 AUTH_REQUIRED`, out-of-scope `404 NOT_FOUND`, `409 COMMAND_ID_REUSED`, `409 WORKFLOW_VERSION_CONFLICT`, `409 STALE_DESIGN_BASELINE`, `422 ARTIFACT_PREPARATION_FAILED`, `503 WORKFLOW_STORE_UNAVAILABLE`. Same command ID/hash returns the originally stored result without new work, even if expectedVersion is now old; different hash returns COMMAND_ID_REUSED. Two commands against one expectedVersion cannot both commit.

Successful results must distinguish canonical state from delivery:

```ts
{
  commandId: string; submissionId: string; version: number;
  approvalState: string; approvedArtifactId?: string;
  approvalProgress: { completedStages: string[]; pendingStage: string | null };
  deliveries: Array<{ deliveryId?: string; channel: 'task'|'publication'|'notification'; state: 'not_required'|DeliveryStatus }>;
  learning: { state: 'not_required'|'pending'|'running'|'succeeded'|'failed'|'reconcile_required'; ready: boolean; outcome?: 'changed'|'no_changes' };
  warnings: string[];
}
```

Approval can succeed while enabled integrations are pending/failed. A task-none design can finish with task `not_required`. If a client requires publication, label publication pending separately; never reverse a saved staff approval due to a provider outage.

The versioned command POST returns an immutable commit receipt with the initial delivery/learning snapshot. Replays return that same receipt. Scoped GET `/api/v1/menu-submissions/:id` returns current delivery/learning state. Legacy approval translations may wait on the live read and enrich `clickup.learningComparisonReady`; this enrichment is outside the cached command receipt. A successful no-change comparison is terminal with `outcome:'no_changes'`, not an endlessly pending comparison.

## 6. Artifact and transaction boundary

Before a command transaction, document-artifacts validates actor/resource access and file type/size, calls existing generation/extraction code, verifies readability and computes SHA-256. Move completed bytes to an immutable location under the configured artifact root (UUID/file name with validated extension). Never overwrite an approved artifact. Artifact metadata includes ID, source submission, MIME/type, filename, SHA, size, provenance and storage locator. Public/new APIs use artifact IDs; only the authenticated legacy bridge may accept existing safe local paths and convert them through the artifact layer.

The DB approval transaction includes all of: idempotency record; version lock/check; staff stage decision and approval history; canonical submission fields/content; artifact metadata; menu-current-version change; audit event; enabled outbox/derivation rows; optional source inbox completion under its lease; and stored result. No HTTP provider operation runs inside it. Artifact preparation failure or transaction failure leaves the prior approval intact. Prepared but unreferenced bytes may remain for a documented dry-run cleanup; no automatic removal of user files.

An approved file is immediately downloadable from canonical storage even if SharePoint is off/down. SharePoint is optional publication, not the only approved copy. Current DOCX filenames, clean/redlined distinction, extraction/formatting behavior, PDF association and SharePoint archive-without-delete behavior are regression requirements.

Expose authenticated `GET /api/v1/artifacts/:id/download` for staff and an internal artifact stream endpoint for workers/compatibility adapters. Apply property authorization and existing traversal/type limits. Preserve legacy download URLs through the same resolution layer. Do not expose arbitrary local paths or signed credentials.

## 7. Persistence and jobs

### 7.1 One selected backend

Add `WORKFLOW_STORE=supabase|local`, chosen at startup. Production active mode requires Supabase. Local is explicitly non-production/test single-DB-process mode. Configured Supabase outage or missing migration returns 503; never fall back to a local queue. Legacy behavior is separately gated by deployment activation, not inferred from an outage.

Supabase uses SQL RPC transactions. Implement/test actual SQL, not a sequence of REST updates labeled atomic. Update fresh schema and add new timestamped migrations without altering historical files. Enable RLS on new sensitive tables with no anon/browser direct policies; revoke PUBLIC/anon/authenticated RPC execution and grant service_role only. Staff access goes through authorized server operations.

Required tables (UUID IDs for new records; existing submission references support legacy string IDs):

- `workflow_commands`: id PK, command_type, submission_id, request_hash CHAR(64), expected_version, result JSONB, actor JSONB, source_inbox_id nullable, created_at/committed_at.
- `workflow_submission_attempts`: id, reserved_submission_id unique, command_id unique, actor_user_id or capability_hash (one ownership mode), original_artifact_id/SHA, expires_at, created_at, committed_at. Never expose capability hashes or raw secrets through summaries.
- `workflow_approval_events`: id, command_id, submission_id, artifact_id, stage_key, decision, actor_user_id, source, reason nullable, policy_hash, created_at. Preserve historical decisions; unique command/event identity and distinct actor per stage/revision.
- `integration_deliveries`: id, command_id, submission_id, channel (`task|publication|notification|derivation`), provider_instance, adapter_version, operation, unique operation_key, destination JSONB, payload JSONB, dependency_ids, status, attempt_count, max_attempts default8, next_attempt_at, lease_token/owner/expires_at, last_error, result, created_at/updated_at/completed_at.
- `integration_inbox`: id, provider_instance, provider_event_id, body_hash, event_type, bounded payload JSONB, status/attempt/next-attempt/lease fields, received_at/processed_at/result/last_error. Unique provider_instance + provider_event_id.
- `integration_external_refs`: id, provider_instance, entity_kind/entity_id, purpose, external_kind/external_id/external_url, operation_key, created_at/updated_at. Unique provider_instance+entity_kind+entity_id+purpose and provider_instance+external_kind+external_id.
- Extend existing artifact/submission/approval_workflow tables additively where appropriate; document the exact mapping rather than create duplicate competing artifact stores. Add approval-round identity, candidate SHA, source revision, policy_hash/definition snapshot and stage identity fields needed by section5. Persist delivery attempt history and resource-lane ownership needed below. Existing table definitions are in `supabase/schema.sql`; existing submission UUID/legacy aliases must be resolved before transactions.

Backfill existing clickup_task_id values into references **without external calls**. Preserve legacy columns as derived compatibility projections. Conflicting mappings are reported, not overwritten. Destination/account identity is frozen in each job. Reconfiguration cannot reroute an old job to another client/account. Credentials are resolved by connection reference at dispatch; absent retired config yields a visible configuration failure.

Local mode uses one authoritative `tmp/db/workflow-state.json` for migrated submission/menu/artifact/approval/command/job/inbox/reference state. Import existing local records with explicit dry-run/apply migration; all migrated writes and reads go through this store. Legacy submission/asset JSON files are derived projections, never authority for approval fields. Route affected dashboard approved-menu/download/queue reads through the DB repository; do not migrate unrelated learning data. Serialize mutations with a tested exclusive process lock and write→file fsync→atomic rename→directory fsync. Refuse a second local DB owner. Repair projections on startup; a projection failure never repeats a committed command.

In active mode generic submission updates cannot write approved status/content/artifact fields, stage decisions or menu-current pointers. Those require workflow commands. Existing AI review-preparation callbacks retain a bounded compatibility DTO and may update draft/pending state only while that review round remains open. A late AI callback must not regress a completed approval. Enforce this in the DB adapter/entrypoint, leaving protected AI callers unchanged; legacy writes remain gated separately. Exercise late callback arrival after staff approval in A14/A23.

### 7.2 Internal DB routes

All require the existing internal-service token and bounded schemas; no public generic queue proxy:

- `POST /workflow/commands`, `GET /workflow/submissions/:id`.
- `POST /workflow/submission-attempts`, `GET /workflow/submission-attempts/:id` (trusted wrapper validates staff or public capability before forwarding).
- `POST /workflow/deliveries/claim` with workerId/limit (default5, max20).
- `POST /workflow/deliveries/:id/{heartbeat,complete,fail,retry}`.
- `POST /workflow/inbox`, `POST /workflow/inbox/claim`, `POST /workflow/inbox/:id/{heartbeat,fail}`.
- Inbox business completion occurs through /workflow/commands with sourceInboxId + current lease token in the same commit.

Complete saves operation result and external refs atomically. All lease mutations require current unexpired token. DB validates command eligibility/concurrency even if the caller already checked. Actor comes from trusted middleware/provider mapping, never a forwarded browser actor field.

### 7.3 Delivery rules

`DeliveryStatus = pending|leased|retry_wait|succeeded|failed|reconcile_required|superseded|cancelled`.

Use DB time, `FOR UPDATE SKIP LOCKED` claims, random lease tokens, 120-second leases, heartbeat every30 seconds and provider timeout at most60 seconds. Attempts increment at claim; store attempt outcomes for audit. Retry transient definitely-not-applied failures after `min(30*2^(attempt-1),3600)` seconds with injected deterministic-testable jitter0–10%; honor valid Retry-After up to24h. Maximum8 automatic attempts. Terminal/configuration failures remain visible. Manual retry retains operation identity/history/cumulative count and grants one explicit additional attempt; cannot reset the automatic budget indefinitely.

Timeout/disconnect/5xx after possible processing require reconciliation. Conservatively treat EVERY expired lease for a non-idempotent operation as potentially sent, including a crash immediately after claim; do not depend on an unpersisted "started" flag. Use provider-supported idempotency keys or a discoverable correlation marker plus external refs. If remote outcome cannot be established, mark reconcile_required instead of blindly duplicating task/attachment/mail. Do not promise exactly-once external delivery. For SMTP without conclusive reconciliation, ambiguous send remains reconcile_required. Record only redacted errors.

Task operations have explicit dependencies: task creation before attachment; required attachment before remote status/assignment progression. Publication and notifications retry independently. Version-sensitive design/publication jobs recheck the canonical version and become superseded if obsolete. Freeze destinations and artifact SHA; never dispatch a mutable latest-file path.

Per-job leases alone do not prevent stale in-flight publication. Serialize publication/promotion under a DB-owned lane keyed by connection + destination + canonical menu identity. An expired or ambiguous older operation keeps that lane unavailable for newer publication until reconciled. Upload to immutable staging, recheck the authoritative version before archive/promote, and fence lane ownership in every DB completion. Provider operations must support conditional/versioned promotion or remain serialized through conclusive reconciliation; a new owner must never assume a timed-out request stopped remotely. Test deliberately reversed completion timing and prove the newest artifact remains current. Lane claims/recovery must be persisted and tested in SQL and local backends, not process-only locks.

Workers dispatch only known operations; unknown operation/adapter versions fail visibly. Backoff polling when idle and shut down cleanly. Existing recurring learning/improvement schedulers are not reused or modified.

## 8. Adapters, webhooks and extension API

Task adapter: `ensureReviewTask`, `attachArtifact`, `applyAssignment`, `advanceTask`, `reconcileOperation`. Publication adapter: `publishArtifact`, `readPublishedArtifact`, `reconcileOperation`. Notification adapter: `sendNotification`, optional `reconcileOperation`. Typed inputs use entity/artifact IDs, version, semantic intent, connection snapshot and operation key. Concrete adapter alone knows URLs/payloads/status IDs/assignees/signatures. A disabled adapter returns not_required before any network call.

Move existing SharePoint/Graph/SMTP helpers into reusable libraries as needed; keep compatibility exports/bridges during migration. Do not leave publication indirectly importing ClickUp runtime. Preserve existing caller-visible warning fields only in legacy translations; active UI uses neutral delivery descriptions.

ClickUp webhook: preserve actual HMAC/raw-body verification semantics; active mode requires secret and real raw bytes (no JSON reserialization fallback). Do not invent a timestamp field the provider does not send. Deduplicate actual provider event/history-item identity; if no documented stable event ID exists, define/test a stable key from provider connection + event type + task + history-item ID, and a documented content-hash fallback for events with no ID. Never use arrival time/random UUID as the dedupe key.

Return202 only after durable inbox insertion. Same event ID/hash returns202; different body for same ID returns409; invalid signature401; malformed event400; unavailable persistence503. Map external task and actor through explicit references/authorized configuration. Unknown/ambiguous tasks or unmapped actors cannot approve arbitrary submissions. Signed provider status alone cannot bypass staff-stage rules. Preserve legacy provider interpretation only in the unactivated compatibility lane. Out-of-order/echoed events must not regress approvals or create feedback loops.

Preserve current public/internal routes as translations: browser/quick/corrected approval, `/approval/finalize`, `/design-approval/finalize`, ClickUp webhook, retry route and SharePoint download bridge. Active task-none requests must not call these provider bridges. Add versioned authorized staff endpoints:

- `GET /api/v1/menu-submissions/:id` (scoped canonical summary, version, approval progress, delivery summaries).
- `POST /api/v1/menu-submissions/:id/commands` (explicit allowlisted commands; reuse server actor/version/idempotency logic; no generic privileged envelope proxy).
- `GET /api/v1/artifacts/:id/download`.
- `POST /api/v1/deliveries/:id/retry` (administrator in this milestone).

Require `Idempotency-Key` UUID and `If-Match` current version for new mutations; same-command retries replay before stale-version rejection. Respond with stable errors/results from section5. Existing UI endpoints translate persisted browser command IDs rather than generating a new random ID on each retry. Write an OpenAPI3 contract and a tiny **test-only fake task-product client** that reads a menu, submits a permitted approval command and downloads its artifact. No production generic API keys or custom board UI yet; external production authentication is a later explicitly selected integration, while the same-origin staff API is usable now.

Existing staff queues must show pending stages and the staff member's permitted next action. Add a scoped resumable design review page at `GET /design-approval/reviews/:id`, authorized for designers/admins using its persisted submission property; it loads the existing artifact/round and offers `ApproveDesign` through the command API. Reopening must not upload another file or create another review. Include this new route in policy/tests and verify a second distinct staff member can complete the same design round.

## 9. Staff identity and permissions

Use existing Supabase Auth and `users` membership, not Clerk/new password storage. Implement server-side email OTP request/verify with the existing Supabase SDK. Verify official current API documentation during implementation. `shouldCreateUser:false`; authentication must not create membership. Only pre-provisioned active staff are eligible. Uniform request responses prevent enumeration. Apply per-email and per-IP rate limits (request:3/email/15min,20/IP/15min; verification:5/email+IP/15min) using the selected authoritative store. Tests control the clock.

Add nullable unique users.auth_user_id referencing auth.users, preserve legacy clerk_user_id, and constrain active v2 roles `chef|reviewer|designer|admin`. Add `user_properties(user_id,property_id)` using existing properties UUIDs. Backfill resource property_id from exact unique names; preserve display strings. Unmatched historical resources are administrator-only until explicitly mapped. A verified provider user must match the bound membership; never adopt a different existing auth ID because email looks similar. Provide dry-run operator membership-binding/activation instructions; do not send invitations or provision real users during this task.

After OTP verification discard provider access/refresh tokens and create an opaque random256-bit application session. Store only token SHA-256 in `staff_sessions` with user ID, created_at, absolute8-hour expiry and revoked_at. No sliding refresh. Cookie: Secure/HttpOnly/SameSite=Lax/Path=/ and no Domain in production. Every request rechecks active membership and session; logout revokes, deactivation is immediately effective. Synthetic auth provider is injectable only in non-production fixtures; production must reject fixture auth configuration.

Add login/request/verify/logout views/routes, a middleware before protected handlers and uploads, and CSRF/origin protection for cookie-authenticated mutations including login/logout. Use per-session synchronizer CSRF tokens (hashed in session storage) and a pre-auth nonce for login forms; accept tokens in form fields or a header, never URLs. Allow same-origin requests only; redirects must be local allowlisted paths. No secrets/provider tokens in browser localStorage, logs or URLs.

Deliver the raw CSRF token in a separate Secure/SameSite cookie and copy it into the required form/header field; bind its hash to the opaque HttpOnly session. Verify that binding, the submitted token and origin. Possession of the CSRF cookie alone grants no access. Rotate on login/session replacement. The pre-auth nonce has a separate signed/hashed binding, 15-minute expiry and request/verify form lifecycle; consume it upon successful login and issue a fresh nonce after expiry. Do not attempt to reconstruct a raw token from a stored hash.

| Role | Rights within explicitly assigned properties |
| --- | --- |
| chef | Approved resources, shared drafts belonging to assigned properties, menu submission; cannot approve or browse other properties. Preserve per-menu draft concurrency; this milestone adds no per-user draft ownership. |
| reviewer | Chef rights plus menu review/stage decisions and scoped correction explanations |
| designer | Read scoped approved resources, upload design proof, configured design-stage decisions; no menu-content approval |
| admin | All properties/actions, override, integration retry, staff/configuration and rule/prompt administration |

Role does not automatically fulfill every stage: enforce stage's role and distinct-decider requirement. No self-granted property/role/assignee/actor fields. Use actual resolved resource property, query-level list filtering and consistent404 for out-of-scope IDs. Denied upload requests must produce zero persisted files or external calls.

Use the accompanying `client-platform-route-policy.json` as the complete current dashboard-route inventory for active mode. Implement route policy centrally and test actual requests; unknown new data routes must fail closed until added. It is a spec fixture, not a runtime JSON import requirement.

Important cases:

- Protect draft lists/edit tokens, review/approval pages/actions, approved files, design work, profile lookups and integration retries. Draft tokens are locators, not authorization after activation; remove tokens from broad list payloads.
- Reviewers may view scoped `/learning/submission/:id` and save explanations as pending evidence; they cannot approve prompt/rule changes or trigger improvement cycles. Enforce this in routing/DTO checks without editing protected learning algorithms.
- If publicSubmissions is true, allow only new-menu form/static templates/minimal property metadata/upload/check/submit flows; deny existing menu/draft IDs and modification modes. Scope async check IDs and receipt/download capabilities to a high-entropy attempt capability, not an enumerable submission ID. No public staff/profile directory or prior-project/draft browsing. Original submitted-DOCX receipt capability may read only that submission's original artifact, expires24h and is stored hashed; it never authorizes approval/approved-file access.
- Preserve narrow negative-confirmation approval-dispute tokens with existing rate limits; they cannot approve a menu or reveal an unrelated resource. Keep CSRF for its mutation.
- Internal configuration and DB routes retain service-token auth; user sessions never substitute for it.

Auth/authorization changes only apply after deliberate v2 activation. Explicitly test that this compatibility gate does not leak into active v2 and that production cannot select fixture auth.

## 10. Learning and existing behavior preservation

Keep the exact callback semantics and provenance used today for browser, corrected-upload and ClickUp human comparisons: submission_id, ai_draft_path, final_path, original_path, optional original_html, comparison_source, review_source, review_completed_at, changed_by_human. Capture a fixture for each current path BEFORE extraction. Quick approval still skips human-change comparison. Artifact materialization supplies the same accepted content, original and AI draft bytes. Do not rename evidence/source labels or reinterpret user edits.

Persist comparison/dish-extraction work as distinct derivation jobs with an approval-event key to prevent duplicate scheduling. Invoke existing differ/extraction entrypoints unchanged. Verify their idempotency capabilities before retry: after an ambiguous comparison response reconcile existing records by submission/approval provenance; if outcome cannot be proven, expose reconcile_required instead of duplicating training evidence. The delivery wrapper may add an idempotency field but may not alter protected differ algorithms; use existing read endpoints or report a concrete missing reconciliation seam to the coordinator.

The frozen differ writes a shared local training store with read/rewrite operations and keys comparisons by submission/source. Use one DB-coordinated global differ-comparison lane per deployment; all active-mode comparison callers must enqueue through it, with no concurrent direct bypass. Order comparisons for a submission and supersede stale queued replacements before invocation. Keep the lane held across ambiguous in-flight outcomes until reconciled, so an old response cannot overwrite newer evidence. Distinguish this persisted global comparison lane from independently parallel task/mail/dish jobs. Capture a slow-old/new-replacement test without modifying differ algorithms.

Browser approval currently waits for explanations. Preserve bounded waiting up to the existing finalize timeout; return learning.ready=true only on actual completed comparison. If pending/failed, report approval saved with truthful readiness and let the UI poll a scoped status endpoint; never invent a completed learning comparison. Preserve legacy `clickup.learningComparisonReady` in old response translations. The newer neutral result is authoritative in active UI.

Also retain DOCX formatting/redlines, price/allergen guards, design finding/override semantics, menu-collision UX, draft concurrency/lineage, current-menu eligibility and old download aliases. Protected algorithms remain hash-identical. Necessary auth wrappers around learning routes are allowed; learning implementation edits require a separate coordinator decision.

## 11. Reusable release and isolated verification topology

Add a client deployment Compose file/template with required web/DB/review/document dependencies and optional worker/webhook services. Task-none must omit the ClickUp service entirely; publication/mail can still use the worker. Avoid hardcoded container_name and host ports in the new topology. Runtime config/templates mount read-only and state mounts separately. Existing default stack remains untouched during worker verification.

Build a versioned release artifact from shared code; default production images must not bake a live tenant bundle or the active runtime RSH prompt. Separate code/default example assets from injected client bundles. Existing legacy deployment can mount its explicit current bundle; document migration before changing live CI. Add a release manifest recording code/image digest, config schema version and required migration version, without secrets. Deployment template uses one release digest across client settings; no per-client source branches. No automatic database downgrade or destructive rollback.

Add `docker-compose.platform-test.yml` using disposable PostgreSQL, fake ClickUp/SharePoint/mail/Auth/AI endpoints, independent storage and a unique Compose project. Private service network; publish only ephemeral loopback browser ports. No mounted original checkout, real .env or Docker socket. Load only synthetic documents/users, generated test credentials and test tenant bundles. Source builds/copies come from the worker worktree. Keep real model/provider calls blocked. Synthetic fake mail delivery records requests without sending.

Provide explicit scripts:

- `npm run platform:test` — all non-paid unit/contract tests and real temporary-Postgres transaction tests.
- `npm run platform:test:browser` — real Docker-served routes with synthetic staff, upload/DOCX, approvals/design, downloads and provider fixtures.
- `npm run platform:verify` — above plus builds, protected-manifest check, dependency-boundary check and machine-readable acceptance report; nonzero on any required missing/failed item.

Scripts must clean only their own containers/networks/temp data and leave evidence under their own `tmp/client-platform-verification/`. They must not call `./dev-up.sh --down`, use mm-* names, kill ports, overwrite menumanager/dev:latest, read production credentials or rely on an already-running shared stack. Use workspace-specific images. Dependency installs/builds may use network; runtime acceptance network is restricted to fixtures.

New tables/RPCs must be exercised against **real disposable PostgreSQL**: actual migration SQL, transaction rollback, concurrent clients, SKIP LOCKED, lease fencing and RLS/grants. Create synthetic service_role/anon/authenticated/auth.users prerequisites in that fixture as needed. Mocked Supabase calls do not count as SQL verification. Test local atomic file storage with injected crashes separately. Reuse existing test locations/patterns and avoid source-string assertions masquerading as behavior.

## 12. Required acceptance cases (report each ID)

| ID | Required evidence |
| --- | --- |
| A01 | Imported baseline contains current dirty tracked and new untracked representative source; exact supplied hashes and deletions verified. |
| A02 | Protected learning/AI/diff/Python source/tests unchanged; no worker writes to original checkout. |
| A03 | Current legacy profile approval/document behavior characterized and preserved before activation. |
| A04 | Fresh generic v2 profile boots and completes real synthetic DOCX upload→review→staff approval→download with NO ClickUp service/config/network requests or warning. |
| A05 | Generic design review + authorized decision/override→PDF download completes with task not_required. |
| A06 | Two-tenant fixture isolation: branding, recipients, templates, property destinations and rulebook hashes never inherit RSH in generic profile. |
| A07 | Missing/malformed/incomplete profile, tenant/DB mismatch, enabled-provider missing credentials and impossible stage policy fail before application dispatch. |
| A08 | Legacy migration idempotent; existing rows/prompt/runtime hashes preserved; activation requires bound administrator/recent bootstrap session; setup/suspended gates and every startup-matrix case work, including rejected v2→v1 downgrade. |
| A09 | OTP allowlist/rate limits, bad/expired/revoked session, deactivation, CSRF/origin and production fixture-auth rejection. |
| A10 | All route-policy entries and new routes enforce role/property rules; broad lists exclude unauthorized rows/tokens; denied writes/uploads/provider calls count0. |
| A11 | Public-new-submission lane cannot edit/download prior resources or enumerate profiles/drafts; attempt/receipt capability isolation and expiry tested. |
| A12 | Service-token auth required on internal command/queue/artifact routes; staff session alone rejected. |
| A13 | Parallel duplicate command returns one committed result/event/job set; changed request same ID409; submission retries/crashes reuse reserved identity and create one submission/confirmation. |
| A14 | Competing approval versions/stage decisions enforce one winner/current round; same actor cannot double-count across workflow versions; SHA-B cannot inherit SHA-A decisions; explicit restart/replacement preserves history. |
| A15 | Real SQL rollback after injected failure leaves neither approval change nor outbox/event; prepared orphan is not a successful approval. |
| A16 | Approved bytes immediately downloadable with publication down/off; extraction/validation failure preserves prior version. |
| A17 | Two real PG workers cannot claim one live lease; expiry recovery works; late heartbeat/completion fenced. |
| A18 | Fake ClickUp accepted-then-timeout/crash-before-completion-write reconciles before resend; unresolved ambiguity does not duplicate tasks/attachments; expired non-idempotent leases never assume unsent. |
| A19 | Backoff/Retry-After/attempt cap/permanent failure/manual retry preserve identity/history; independent publication retry does not repeat task creation. |
| A20 | Remote status/assignment cannot advance before required attachment succeeds; obsolete design/publication jobs supersede; reversed provider completion timing cannot replace the latest approved publication with stale bytes. |
| A21 | Signed webhook persisted before202; duplicate/conflicting-body/invalid-signature/malformed/unknown-task/unmapped-actor/out-of-order cases verified. |
| A22 | SharePoint ON + task NONE publishes and retrieves; task ON + SharePoint NONE works; mail NONE performs zero sends. |
| A23 | Learning callback fixtures preserve exact data/provenance; quick approval skips; slow/failing comparison has truthful saved/readiness response; retries do not duplicate evidence; global differ lane prevents concurrent lost updates and slow-old/new-replacement evidence inversion. |
| A24 | Local store crash points before/after rename/projection repair do not partially approve or double-dispatch; second DB owner rejected. |
| A25 | Supabase-selected outage/schema absence fails closed with no local queue/state creation. |
| A26 | Actual SQL constraints/RLS/RPC grants deny anon/authenticated/PUBLIC privileged mutation. |
| A27 | Fake separate task-product consumer uses versioned API only; forged actor/property/task status cannot approve; artifact API scoped. |
| A28 | One release image works with both injected profiles; startup/upgrade preserves client-approved rules; optional Compose services truly absent; cleanup preserves shared stacks. |
| A29 | All affected workspaces build; focused existing approval/design/draft/download suites pass; source/generated assets align; exact new API/OpenAPI contracts tested. |

A skipped mandatory test means incomplete, with cause and risk stated. Synthetic provider success is not proof of production credentials, actual email deliverability, paid model quality or deployment. Distinguish those explicitly in final handoff.

## 13. Milestones, files and handoff

Implement in this order; each milestone has focused tests and a small commit after imported baseline:

- **M0 Baseline:** bootstrap/import, characterize existing approvals/learning callbacks/downloads, ledger + protected checks. No speculative code refactor.
- **M1 Configuration/identity:** schema v2, validators, dry-run migration/activation, tenant-free structural seed, backend selection; A06–08/A25.
- **M2 Core/artifacts/persistence:** typed commands, atomic SQL/local store, immutable artifacts, scoped read ownership and reference backfill; A13–16/A24/A26.
- **M3 Adapters/jobs/inbox:** extraction of ClickUp/SharePoint/mail, worker, dependency ordering and reconciliation; A17–22.
- **M4 HTTP/standalone:** translate existing routes, no-ClickUp UI, canonical/legacy response compatibility, design and learning readiness; A03–05/A23.
- **M5 Staff access:** OTP/session/membership/property/CSRF controls, route-policy coverage and stage decisions; A09–12/A14. Active v2 may not ship before this milestone.
- **M6 Extension contract:** versioned APIs/OpenAPI + fake consumer; A27.
- **M7 Release/verification:** injected profiles/optional topology, Docker/Postgres/browser scripts, complete A01–29 matrix; A28–29.
- **M8 Reviewable delivery:** run final verification, record unresolved failures honestly, commit owned implementation/docs, send direct handoff to coordinator and stop before integration/deployment.

Maintain `docs/design-docs/client-platform-implementation-ledger.md` with milestone status, commits, files, commands/results, exact baseline/protected hashes and acceptance IDs. Update relevant architecture/onboarding/environment/design docs and README alongside implementation. Preserve existing in-progress doc content. Add `docs/design-docs/client-platform-verification.md` with evidence locations and limitations, and `docs/design-docs/client-platform-rollout.md` with operator migration/activation/backup/rollback steps. Update rule manifests only if an authorized deterministic-rule change occurs; this spec authorizes none.

The final worker handoff must include: worktree/branch, imported baseline commit, implementation commit range, completed M/A IDs, test/build/browser results, protected-source comparison, schema migration/release artifacts, explicit production tasks NOT executed, and any concrete blocker. Address it directly to coordinator task `01a07dda-0a48-7c20-98b3-ebcfbe6c5065`. Do not ask the user to relay files/messages. Do not say complete while a required test or milestone remains.
