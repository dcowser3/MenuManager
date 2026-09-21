# Review-learning B5-C2a: credential-free draft safety

B5-C2a is a pure boundary between a prepared attempt and any future draft
worker. It reopens only bounded mode-`0600` regular artifacts below the exact
trusted topology `<repo>/tmp/code-proposals/<proposal-id>/<attempt-id>` (or an
explicit trusted root), rejects symlinked roots/components, and requires the
trusted B6-D1 behavior validator on every revalidation before accepting its
embedded hash. It rechecks the B5-A proposal/source/prompt/rule/dataset/behavior
identities and can materialize a credential-free baseline snapshot without
touching the working checkout. Snapshot scanning rejects both known token
shapes and exact values from credential-like environment keys; tests may inject
deterministic secret values without exposing them.

Revalidation always requires the attempt's baseline snapshot and recomputes its
B5-A implementation hash. Runtime edits cannot target nested tests, fixtures,
or test/spec-named files; the only permitted test edit is a new exact
`services/dashboard/__tests__/code-candidate-<slug>.test.ts` file.

Draft JSON is limited to summary, unified patch, test files, and correction
mappings. The patch validator rejects commands, binary/delete/rename/mode
changes, unsafe or duplicate paths, protected control surfaces, unauthorized
delivery edits, old-test mutations, skipped tests, and missing runtime/new
regression-test coverage. Mappings remain tied to frozen case IDs and exact
NFC-normalized source correction text. Applying a valid patch happens only on
a fresh isolated copy after `git apply --check`; all ambient `GIT_*` variables
are removed for both Git commands, and every changed path is re-opened after
apply as a regular non-symlink file. Tests and verifier execution are
intentionally deferred.

B5-C2b must add the model/worker orchestration and call this boundary; it must
not weaken these credential, path, identity, or mapping checks.
