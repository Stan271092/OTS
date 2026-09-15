# Progress — plan: 2026-09-11-full-glass-design.md

No new worktree or commits: explicit project constraints, existing feat/webgl-hero. Backups provide before-state review. User authorizes continuing seven changes without intermediate confirmations.

| Task/interface | Check |
|---|---|
| 1 integration / 2 design | embed-host.js consumes iframe#resin-frame data-src; design will add it. Integration agent must not edit root HTML/CSS. |
| 2 design / 3 tests | Existing check_site rejects iframe; update after integration, use separate check_embed for GPU lifecycle. |
| 1 tests / 3 tests | Only one browser process at a time; child worker owns slot until return. |
| 1 self | Material unchanged, only lifecycle bridge; standalone keeps prior behavior. |
| 2 self | Assets local and sourced, provided logo kept intact. |
| 3 self | Whole app check after changes, not old source/hash contract. |

Decisions: separate iframe avoids global CSS conflicts and reuses exact model. Supplied glass-star image is local design reference, publication rights unresolved. Parent route uses light optical backdrop rather than pretending transparent HTML refraction.

Task 1: complete. Root hero embeds webgl/v4/embed.html with the existing scene.mjs. Only lifecycle integration changed: lazy host loader, same-origin/source/boolean validation, fail-closed visibility handshake, offscreen/ancestor-CSS/page pause, retained manual pause and reduced motion. Standalone remains available. The initial worker connection loss was recovered; the final gate tests the actual parent iframe, not a standalone surrogate.
Task 2: complete. Root markup/app/styles use the supplied unmodified logo on blue backing, a matching favicon, the requested headline, sections.css for lower sections, glass star x3 and four local cool-toned photographs. Sources and publication limitations are in assets/SOURCES.md. Rusty-pipe candidate was replaced with stainless equipment after visual review. Form remains a non-sending demo.
Task 3: complete. README.md, PROJECT-STATE.md and NEXT-SESSION.md updated and stale pending-integration instructions removed. Timestamped documentation backups verified. Result HTTP 200; opened http://127.0.0.1:8767/?design=full-glass once after all checks and document edits. Await user visual feedback; no publication.

## Fresh verification — 2026-09-11

- Restarted the stopped local server with `python serve.py --port 8767`; HTTP 200 on 127.0.0.1.
- `node --test webgl/v4/test-layout.mjs webgl/v4/test-resin.mjs webgl/v4/test-optics.mjs`: 21 passed, 0 failed, 0 skipped.
- `node check_site.cjs`: exit 0. Real iframe pixel motion; manual/offscreen/ancestor-CSS/reduced-motion pause; source and payload validation. Eight widths (1440, 1280, 1024, 820, 701, 700, 390, 320), header/hero/lower-section layout, logo/headline, menu/anchors, four new sector images, demo form, keyboard focus. No external requests or browser/HTTP errors.
- SHA-256 confirms assets/ots-logo.svg is byte-identical to the supplied Group 97 (1).svg. Favicon parses as SVG and index.html links assets/ots-favicon.svg.
- Fresh screenshots reviewed: desktop/mobile hero, desktop expertise/applications/approach, 320px contact. Test browser closed before opening the user-facing result.
- No geometry/shader redesign, new dependencies, Blender render, commit, push or publication in this completion pass.

Ruling: retain the current completed visual iteration for user review — no unsolicited new redesign after the seven requested changes; publication rights for the supplied decorative reference still require confirmation.
