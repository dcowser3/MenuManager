# B5-C2c2b3 browser-worker boundary

The delivery-evidence browser is isolated from the host browser and from the
generic replay worker. It runs only from the dedicated
`docker/Dockerfile.code-proposal-browser-worker` image, with Chromium installed
at build time by the repository's pinned Playwright dependency.

The checked-in form now loads the exact Quill 1.3.6 bytes from
`services/dashboard/public/vendor/quill-1.3.6/`; no CDN request is part of the
browser run. The current vendor hashes are:

| asset | SHA-256 |
| --- | --- |
| `quill.js` | `a4da70cd71b5a0e224e95865829a8356a93907c7d47ebb6b23cb8014c6ff9c48` |
| `quill.snow.css` | `892e299431955e9ae388ae257f72024ee76af2d52a7a97a868f70fbe50f16144` |

The reproducible local worker build used base image
`menumanager/dev@sha256:c5c31c8c36565eda780fcfc7d99a2dde15d91bb22ade6f274d1b5041514452c5`,
Playwright 1.60.0 / Chromium revision 1223 (Chrome for Testing
148.0.7778.0), and produced image manifest
`sha256:a064dc4f63d6782682254cdf3a8546bed06d50007c3ea530a718d5b67c97b41d`
on `linux/arm64`.

The delivery launch contract is fixed: network `none`, read-only root, and a
container process that starts directly at uid 65532 with no privileged staging
parent,
`no-new-privileges`, all capabilities dropped, bounded tmpfs for
`/tmp` and the worker profile, no host browser/profile/credential mounts, and
Chromium sandbox disabled inside the container boundary (`chromiumSandbox:false`).
The worker must capture the browser
version, Quill version, serialized form body, submitted text, and submitted
HTML before the request boundary; it must never send the request or accept
caller JavaScript, callbacks, expected metrics, or ground truth.

The fixed repository-owned form driver is wired through a separate, hash-bound
delivery identity. It uses the checked-in form boundary and vendored Quill
serialization, captures baseline/candidate text and HTML-derived text before
the request boundary, and fails if any request is attempted. Generic
unit/replay/behavior images are never used as a delivery fallback.

This evidence is deliberately limited to the shared
`serializer_request_boundary_v1` path: Quill, diff-core, redline-preview, and
`form-submission.js`. It does not certify reviewed-state selection, the full
`form.ejs`/`form-legacy.ejs` assembly path, or other editor behavior. Each
schema-v2 correction must carry this exact frozen delivery-evidence scope;
missing or broader claims fail closed.

Schema-v2 delivery proof also binds the worker response to the frozen delivery
image, runtime, driver, source-manifest, browser/Quill, and fixture identities.
Missing, stale, or tampered bindings fail closed; legacy schema-v1 evidence is
retained only for compatibility and does not establish the new binding.

The delivery report attests the observed UID/GID, empty supplementary groups,
zero capability masks, `NoNewPrivs=1`, `Seccomp=2`, read-only root mount, and
loopback-only network. Residual risk is limited to this offline frozen-local
delivery check; it is not equivalent to an inner Chromium sandbox.

The opt-in network-none causal proof passes with the baseline serializer
omitting `TARGET` from both payload forms while the candidate preserves it;
the current/current replay is rejected by the same before/after predicate.
