# Manual code-candidate fallback

This bounded fallback records source changes for the frozen code-candidate lane without provider calls, live database writes, proposal approval, activation, deployment, or C2b/C2c provenance. The complete binding (proposal, lineage, frozen hashes, and all 17 correction IDs) is in [`manual-code-candidate-manifest.json`](manual-code-candidate-manifest.json).

Implemented corrections are limited to contextual ingredient singularization, named-cheese modifiers, and the verified interior `salmon*` option marker. The two `Dessert` corrections remain unresolved because the accepted SOP and runtime prompt require plural category headings (`Desserts`). Resolving them requires an explicit policy decision and a section-aware category parser; they are not applied by this fallback.

The deterministic guards are intentionally allowlisted and contextual. They preserve counted/prepared phrases, documented plural exceptions, dish names, existing modifiers, and idempotence. The raw-marker change recognizes only a bare `salmon` option in a comma-separated option line; it does not mark arbitrary salmon mentions.

Verification is limited to the focused deterministic test source and static/type checks available in the checkout. Provider transport and live service/database verification are deliberately out of scope.
