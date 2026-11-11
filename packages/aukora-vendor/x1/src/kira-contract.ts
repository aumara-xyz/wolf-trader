/** Wire contract for the Kira X1 memory core and its tools. */

/** Pinned Microverse ABI v1 Kira core. */
export const KIRA_CORE_MODULE = {
  name: 'kira-core',
  version: 1,
  abi: 1,
  file: 'kira-core.wasm',
  /** Updated only through scripts/build-kira-core.mjs. */
  sha256: '4d1be5b5eb8cb2ba943cac58aff3e5ad46f3c3e779af3cc3c1778282f32caa3e',
  /** Per-export fuel ceiling; measured separately by the metering specs. */
  fuel: 100_000_000,
  meterSha256: '0c8fcc36550a6c379317780f3f063cdbb04ce514fd64a43dc3a9a8781dfd2714',
  maxBytes: 1024 * 1024,
} as const
