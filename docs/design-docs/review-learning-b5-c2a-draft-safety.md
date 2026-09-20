# Review-learning B5-C2a: credential-free draft safety

B5-C2a is a pure boundary between a prepared attempt and any future draft
worker. It reopens only bounded mode-`0600` regular artifacts below the exact
attempt root, rechecks the B5-A proposal/source/prompt/rule/dataset/behavior
identities, and can materialize a credential-free baseline snapshot without
touching the working checkout.

Draft JSON is limited to summary, unified patch, test files, and correction
mappings. The patch validator rejects commands, binary/delete/rename/mode
changes, unsafe or duplicate paths, protected control surfaces, unauthorized
delivery edits, old-test mutations, skipped tests, and missing runtime/new
regression-test coverage. Mappings remain tied to frozen case IDs and exact
NFC-normalized source correction text. Applying a valid patch happens only on
a fresh isolated copy after `git apply --check`; tests and verifier execution
are intentionally deferred.

B5-C2b must add the model/worker orchestration and call this boundary; it must
not weaken these credential, path, identity, or mapping checks.
