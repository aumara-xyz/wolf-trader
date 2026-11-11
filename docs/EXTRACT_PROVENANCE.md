# Extract provenance

| | |
|--|--|
| Requested source | `aumara-xyz/aukora-symbiote` @ `796934b6e80799713caf02b190d4cc94de24af6c` (`codex/wolf-update-main`) |
| Access | Not readable. `gh` and `git ls-remote` returned repository-not-found for the agent credential. |
| Bytes used | Public `aumara-xyz/aukora-kernel` @ `b441edc4d17de778d30ae955f46408edae39bffe` |
| Wolf blob import | `3ab134094668d09cb870d317a358292d9708d028` (2026-07-15), message: consolidate private Aukora organism checkpoint |
| License of copied files | AGPL-3.0-or-later (`packages/engines/LICENSE`, SPDX headers kept) |
| Missing doc | `docs/mesh/handoff/TRADING.md` was not in that public tree. `docs/TRADING.md` restates the fence; it is not that file. |

Unchanged files are pinned by SHA-256 in `tests/extract-identity.test.ts`.

Rewritten for this layout (imports and paths only, plus the UI fence paragraph and the mind-driver key lookup):

- `apps/wolf-ui/wolf.js` was the extracted shell. It is not served. The desk is `apps/paper/`.
- `scripts/wolf-mind-auto.ts` — imports rewritten; `resolveApiKey` reads `OPENROUTER_API_KEY` only and receipts refuse to contain that key; home is `AUKORA_WOLF_HOME`
- `tests/wolf*.test.ts` — import paths and filesystem pins follow `packages/engines`

`packages/engines/vendor/arc3/mind.js` is the unchanged parser the mind pin imports. It loads `engine.js` beside it. Neither file is imported by the paper executor. There is no live order path.
