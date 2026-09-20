# Review-learning B6 binder preparation handoff

This change adds the offline, default-off preparation tooling for B6 human-explanation binding and its source-bound preflight dependency. It is preparation-only: it does not call providers, write the database, alter review runtime behavior, or activate any learning loop.

## Scope

- Human-explanation binding preparation and packaging helpers.
- Source-bound preflight v2 preparation helper and immutable phase-0 verifier dependencies.
- The two source-anchored spelling matrices required by those verifiers.
- Focused tests covering 13 binder cases and 10 source-bound-preflight cases.
- NPM entry points for the three preparation/package operations.

The binder preserves the eight-record/16-signal denominator, including six exact and two unresolved signals. Stage and precheck results remain evidence only; they do not authorize provider, database, deployment, or production writes.

## Evidence boundary

The source was copied from the validated immutable preparation package at:

`/Users/deriancowser/Documents/mm-review-learning-human-explanation-binding-preparation-executable-1788887000000000019`

The package snapshot contained 29 hashed entries and validated with zero mismatches. Its recorded Docker test image was `sha256:2c44417fea795225bc6cad276795f5141dd4e85cddd6a8cc898482f100a0c363`; the exact focused run reported 23 passing tests (13 binder, 10 source-bound).

Only the source closure, focused tests/fixtures, and canonical design docs are included here. Preparation inputs, registries, private menus, captures, credentials, execution logs, package evidence, and other packet artifacts are intentionally excluded.

## Operational limits

The tooling is credential-free and network-isolated. It emits preparation artifacts for later review; it does not perform live Basic→submit→stored-review→DOCX lifecycle verification. Docker daemon/compose availability remains an external prerequisite for that live check.
