# ADR-010: Asset Content Hashing

**Status:** Accepted
**Date:** March 28, 2026
**Deciders:** Ashley Childress (@anchildress1)

## Context

All public assets (images, masks, audio, fonts) are served from `public/assets/`
with 30-day nginx cache headers. When an asset is updated and re-deployed with the
same filename, browsers and CDN edge nodes continue serving the stale cached copy
until the TTL expires or the user manually clears their cache.

This is particularly painful during active development of circuit mask PNGs — the
mask images are iteratively refined, but the browser keeps showing the previous
version.

## Decision

Append an 8-character SHA-256 content hash to every asset filename, immediately
before the extension:

```
scene-01-seam.webp       -> scene-01-seam-48263be1.webp
mask-01-seam-circuit.png -> mask-01-seam-circuit-41940702.png
01-seam.m4a              -> 01-seam-9de69f8d.m4a
```

### How to generate

```sh
shasum -a 256 <file> | cut -c1-8
```

### What to update when an asset changes

1. Regenerate the hash: `shasum -a 256 <file> | cut -c1-8`
2. Rename the file with the new hash suffix
3. Update all references:
   - `src/scenes.json` — image, mask, and audio cue paths
   - `src/effects-canvas.js` — hardcoded noise texture fallback
   - `src/styles.css` — font face URLs
   - `README.md` — banner image (if changed)

### Why not a build-time plugin

A Vite virtual module approach was prototyped (query-string `?v=<hash>`) but
rejected in favor of baked-in filenames because:

- Simpler — no build plugin, no virtual module, no runtime resolver, no test stubs
- Works with any tooling — nginx, CDN, curl, browser DevTools all see the real filename
- Git tracks the rename, making asset changes visible in diffs and PRs
- No runtime code required — scenes.json paths are already the source of truth

The tradeoff is a manual rename step when assets change. This is acceptable because
asset updates are infrequent and always author-initiated.

## Consequences

- Every asset file in `public/assets/` carries an 8-char content hash suffix
- Changing an asset's content requires renaming it and updating references
- nginx's 30-day cache is now safe — different content always means a different URL
- Git history shows file renames on asset updates rather than in-place overwrites
