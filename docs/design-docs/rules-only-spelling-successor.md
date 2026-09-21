# Rules-only spelling successor plan

`scripts/prepare-spelling-successor.js` is a build-only, zero-model planning
seam for a narrowly scoped successor to the preserved regressed proposal
`72c144aa-c33e-4873-85e8-6e48537e799e`. It copies only the exact reviewer
corrections `chilies → chilis`, `affila → affilla`, and `afila → affilla`,
retaining each source correction ID, menu scope, replay route, and provenance.

The generated successor is a schema-valid `prompt_proposals` insert payload
(the database supplies `id`; the artifact never uses `id: null`) with the
current prompt copied byte-for-byte into `proposed_prompt`. It is linked to the
parent cycle and stores provenance inside the existing `eval_summary` JSONB
field. It includes deterministic pre-AI activation evidence for positive,
casing, boundary, and idempotence cases. The real `evalStatusFromSummary`
helper derives `passed`, and the normal approval gate is checked before the
artifact is emitted. It records zero model/provider calls. Salmon and the Turkey, Chipotle
Hummus, Guacamole, and spicy-crab rules remain held in parent evidence and are
never included in the successor. The script writes private local plan artifacts
only; production insertion and the normal approval endpoint require a separate
review and are intentionally not performed by this command.

Approval recovery compares each persisted correction rule against the complete
semantic projection emitted by `mapProposedRuleToCorrectionRulePayload`,
including source, cycle/submission provenance, menu/property scope, reviewer,
and consumed status. Only database-generated identity/timestamp/transaction
columns are ignored, so a partial or altered readback is a conflict rather
than an approval retry. Global `location: null` from the mapper is equivalent
only to the database's exact `All properties (global rule)` sentinel; scoped
locations remain exact.
