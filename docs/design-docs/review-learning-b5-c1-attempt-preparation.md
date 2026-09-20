# Review-learning B5-C1: credential-free attempt preparation

B5-C1 prepares a code-candidate attempt without drafting or running a verifier.
It validates the unchanged pending proposal through the B5-B queue gate,
freezes the proposal, exact prompt bytes, canonical accepted-rule rows, B6-D1 behavior artifact, and complete
historical dataset under a unique `tmp/code-proposals/<proposal>/<attempt>`
directory, then writes B6-C-compatible progress state and performs one
ownership claim.

Historical cases are bound by correction routing to exactly one submission and
exactly one completed/full audit for that submission's form attempt. Raw audit
menu text and human-approved menu text are preserved; recency selection,
legacy fallback, ambiguity, changed-only evidence, and incomplete datasets fail
closed. All files are bounded, mode `0600`, and written atomically below mode
`0700` attempt directories.

Preparation failures clean only the newly-created attempt directory and never
write a claim. Once the single claim call begins, any store error retains the
prepared artifacts and rewrites progress as `claim_failed`; it never creates a
second database owner. Model/provider,
worker polling, verifier execution, live database, schema, deployment, and
activation remain deferred to B5-C2.
