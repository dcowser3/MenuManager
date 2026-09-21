# Review-learning expectation versioning

The review-learning evaluator freezes policy and expectation versions before either
the baseline or candidate implementation runs. `services/dashboard/lib/expectation-versioning.ts`
stores the original input and expected result, restaurant/menu scope, rule identity,
approval state, and explicit supersession links in a hash-bound envelope.

Unapproved expectations remain candidates and cannot become active. Ordinary
corrections are not treated as superseding policy; only an explicitly approved
superseding policy is classified as such. Unclear evidence is reported as
`ambiguous`. Evaluation binds every result to the frozen policy and expectation
versions and reports missing output as uncertainty, so a failed candidate cannot
rewrite grading. Historical expectations are retained and Restaurant B or other
unrelated cases remain unchanged.

This slice is intentionally additive: it does not migrate existing datasets,
change provider behavior, activate production policy, or permit candidate code or
prompts to edit the frozen artifact.
