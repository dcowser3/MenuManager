# Submitted allergen preservation

The review pipeline treats allergen codes supplied by the chef as source-bound
semantic data. A model response may suggest a concern, but it cannot remove a
submitted code, even when it reports high confidence. The latest submitted
menu is the source of truth, so a later explicit chef edit is not overwritten
by an older revision. Case, punctuation, aliases, and formatting are
normalized only for row identity; they do not change the semantic code set.

Configured deterministic tenant rules govern supported additions. Candidate-only
configured codes are stripped while advisory suggestions remain available for
human confirmation. The shared trailing-price grammar covers `$`, `€`, `£`,
spaced currency, `MKT`, `MP`, and `market price` forms; reconciliation preserves
those price bytes exactly while changing only the configured allergen cluster.

The approved-dish database integration is intentionally outside this change.
