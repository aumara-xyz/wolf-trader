# mv-meter (vendored)

`meter.mjs` is Microverse's deterministic instruction-metering transformer
(ABI §5), copied byte-for-byte from `aumara-xyz/aukora-microverse`
`tools/meter/meter.mjs` at `e898ca86d3545d8d94208cea74db861f1d1e0b5c`
(sha256 `0c8fcc36550a6c379317780f3f063cdbb04ce514fd64a43dc3a9a8781dfd2714`,
the digest pinned in that repo's `transfers/x1-meter/manifest.json`). Do not
edit it; replace it only with a new pinned copy.

`build-metered-cell.mjs` is the X1 builder that compiles a cell
path-independently, strips it, meters it with this transformer and verifies
it. Cells that use it: `startup-recovery`, `profile-checkpoint`.
