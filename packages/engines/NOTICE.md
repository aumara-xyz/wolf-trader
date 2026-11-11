# Engine extract notice

These modules are a narrow extract, not a fork of the whole symbiote tree.

- Requested pin: `aumara-xyz/aukora-symbiote` @ `796934b6e80799713caf02b190d4cc94de24af6c` (`codex/wolf-update-main`). That private repository was not readable from the agent credential (GitHub 404).
- Bytes actually copied: public `aumara-xyz/aukora-kernel` @ `b441edc4d17de778d30ae955f46408edae39bffe`. The wolf files in that tree were imported in `3ab134094668d09cb870d317a358292d9708d028` (2026-07-15).
- `vendor/arc3/mind.js` is the unchanged reply parser the wolf mind pins import. It is not a trading engine. It imports `vendor/arc3/engine.js` at load time; that file is copied so the parser module loads unchanged. The paper executor does not import either file.
- SPDX on the copied files remains `AGPL-3.0-or-later`. See `LICENSE` in this directory. New harness, bus, seat, and executor code outside this directory was written for this private repo and is not a claim that the AGPL extract was relicensed.
- `docs/mesh/handoff/TRADING.md` was not in the public tree. `docs/TRADING.md` is the fence carried forward, not a verbatim port of that missing file.
