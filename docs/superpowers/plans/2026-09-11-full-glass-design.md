# OTS Full Glass Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the supplied brand and glass references throughout OTS and embed its current live resin scene.
**Architecture:** Plain local HTML/CSS/JS with isolated hero/section styling. Dedicated same-origin iframe shares the existing scene while a validated lifecycle bridge gates offscreen rendering.
**Tech Stack:** HTML, CSS, JS, Three.js already present, Python/Pillow asset preparation, Edge CDP checks.
**Spec:** docs/superpowers/specs/2026-09-11-full-glass-design.md

## Global Constraints
- Timestamped CP backup; no commits/push/publication.
- One browser process/test at a time; no Blender; no new dependencies.
- Keep current geometry/material/shaders/motion; form remains non-sending demo.
- No competitor metrics/claims transplanted; images are illustrative, not OTS cases.
- Standing project authorization waives intermediate approval stops.

### Task 1: Live model integration
Files: create webgl/v4/embed.html, embed.css, embed-host.js; modify only lifecycle in webgl/v4/scene.mjs; extend check_site.cjs later.
Interface: parent iframe id `resin-frame`, data-src `webgl/v4/embed.html`; child DOM hero,visual,scene,loading,status,pause. Messages `{type:'ots-resin-ready'}` and `{type:'ots-resin-visibility',visible:boolean}`, validate origin/source.
- [ ] Add browser contract for live child: `assert.ok(frame.contentDocument.querySelector('#scene'));` and ready pause control, actual changing frames, stable draw count after parent scroll/manual pause.
- [ ] See missing iframe fail against old page.
- [ ] Build minimal child DOM and bounded iframe styling. Reuse `scene.mjs`. Add `hostVisible` in active() without mutating manual pause. Parent IntersectionObserver loads iframe near viewport, sends visibility after handshake, handles document visibility/pageshow. Pause unknown host by default.
- [ ] Run model tests and host lifecycle checks; preserve standalone defaults.

### Task 2: Brand, page components and imagery
Files: index.html, hero.css, new sections.css, app.js image metadata, assets/ots-logo.svg + original, assets/glass-asterisk.webp, assets/*-light.jpg, assets/SOURCES.md.
- [ ] Extend browser checks for new headline, visible logo, all section text bounds and four loaded tab images; run to observe missing new assets/content.
- [ ] Copy logo; adapt white lettering for light surface only if necessary, keep original. Convert supplied asterisk PNG to WebP; no 3D render. Download verified photos locally, resize maximum 1400px and normalize gently toward cool neutral, retain source notes.
- [ ] Use heading `<h1>Материал под задачу.<br>Решение под технологию.</h1>` with responsive wrapping. Replace SVG with `#resin-frame`. Keep real pause child accessible.
- [ ] Style sections as rounded white cards on cool gray; dimensional glass buttons/tabs using white inset highlights, blue translucent edge, restrained shadows. Replace old formulation/orbit/contact decorations with supplied glass asterisk. Preserve labels, IDs, form functionality and valid headings.
- [ ] Change sectorData photos/alt/labels to reflect actual files; keep explanatory industry disclaimer. Change anchor handler to respect reduced motion.
- [ ] Test desktop/mobile bounds, control states, tab changes and form. Review screenshots and correct observed collisions.

### Task 3: Verification and delivery
Files: check_site.cjs, NEXT-SESSION.md, PROJECT-STATE.md, README.md.
- [ ] Run `node --test webgl/v4/test-layout.mjs webgl/v4/test-resin.mjs webgl/v4/test-optics.mjs`.
- [ ] Run `node check_site.cjs` then dedicated embedded lifecycle check sequentially; ensure only local asset requests, no HTTP/runtime errors, real WebGL and pause behavior.
- [ ] Review 1440/820/390/320px screenshots and all sector photos. Verify geometry/material files unchanged from backup.
- [ ] Document paths, image sources, limitations and final checks; update short handoff. Open `http://127.0.0.1:8767/?design=full-glass` once.
