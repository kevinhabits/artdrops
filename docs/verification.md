# Release verification

Checked on 2026-10-15.

## Automated and media checks

- 22 Node tests pass: catalog diversity and attribution, media/input validation, filter composition, queue reordering, portable import/export, custom-library retention, shuffle, failed-work quarantine, pause timing, stale asynchronous callbacks, paused navigation, and fullscreen ownership.
- `npm run build` produces a static site with no runtime dependencies.
- All 36 selected videos passed source-page, poster, MP4-signature, native-dimension, and decoded temporal-frame checks. There are 33 artist identities across objkt and Verse. See `catalog.md` for the method and maintenance command.
- No source artwork binaries, credentials, API keys, or generated build files are included in Git.

## Browser checks

Tested in the Codex browser:

- Desktop layout at 1280 × 720, including all controls in the exhibition panel remaining reachable on a shorter screen.
- Mobile layout at 390 × 844 with no horizontal overflow.
- Exhibition stage at 3840 × 2160; source aspect ratio preserved with `contain`.
- Actual decoded video playback, preloading of the next work, pause, and navigation while paused.
- Artist search, adding to the exhibition, changing order, and settings/queue persistence across reload.
- Importing a portable exhibition through its file picker.
- A deliberately unavailable video followed by two valid artworks: playback skipped the broken work and continued.
- An exhibition containing only the unavailable work: playback stopped with an actionable message and retained an exit control.

The embedded test browser does not expose the native Fullscreen API. Its full-window player fallback was tested; requesting document fullscreen and preserving preexisting fullscreen are covered by unit tests. Native fullscreen and physical output on the Samsung monitor should be checked in the show laptop's browser.

## Boundaries

The site and catalog are static, but videos stream from external hosts. Their future availability and the venue's connection cannot be guaranteed. The player retries and skips failures. Source resolution varies; the 4K display mode does not upscale source detail.
