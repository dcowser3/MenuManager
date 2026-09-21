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
148.0.7778.96), and produced image manifest
`sha256:a064dc4f63d6782682254cdf3a8546bed06d50007c3ea530a718d5b67c97b41d`
on `linux/arm64`.

The launch contract is fixed: network `none`, read-only root, non-root uid
65532, `no-new-privileges`, all capabilities dropped, bounded tmpfs for
`/tmp` and the worker profile, no host browser/profile/credential mounts, and
no sandbox-disabling Chromium flags. The worker must capture the browser
version, Quill version, serialized form body, submitted text, and submitted
HTML before the request boundary; it must never send the request or accept
caller JavaScript, callbacks, expected metrics, or ground truth.

This document records the image and asset boundary only. The fixed
repository-owned form driver remains fail-closed until its delivery executor is
wired to this image and its actual browser submission capture is covered by the
credential-free network-isolated test.
