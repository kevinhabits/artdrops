# ArtDrops

A small, motion-only digital art exhibition app. Browse a saved selection, make a queue, and give the artwork the whole screen.

**Vanilla HTML, CSS, and JavaScript. Zero runtime dependencies. No account, API key, wallet, database, or backend.**

## Run locally

Requires Node.js 22 or newer. No install step is needed.

```sh
npm run dev
```

Open <http://127.0.0.1:4173>. An internet connection is needed to stream the artwork.

```sh
npm test       # Data validation, queue logic, player behavior
npm run build # Produces the deployable dist directory
npm start     # Serves the production build locally
```

## Put on a show

1. Connect the laptop to the display. Select 3840 × 2160 in the computer's display settings if supported, and move this browser window to the external display.
2. Add or remove works, reorder with the arrows, and choose 10–120 seconds per work. The initial six works are from different artists.
3. Choose **Show full artwork** to preserve the composition, or **Fill screen** to crop to the display. Artist captions and shuffle are optional.
4. Start the exhibition. Arrow keys navigate, Space pauses both rotation and video, and F toggles fullscreen. Close or Escape leaves the player; some browsers use the first Escape to leave fullscreen.
5. Keep the laptop powered and disable system sleep for a long show. A browser screen wake lock is requested when supported, but system settings still matter.

Art plays silently and loops. Playback uses the source video's available resolution; a 4K display does not make a lower-resolution original 4K.

## Your exhibition

The queue and settings save locally in this browser. **Export exhibition** downloads a JSON backup you can import on another computer. Export contains links and credits, not the artwork files. Removing a work or importing an exhibition offers Undo.

**Add your own** accepts a direct, public HTTPS MP4 or WebM URL and verifies that the browser decodes a video frame. YouTube pages, marketplace pages, still images, and arbitrary HTML embeds are not video files. Imported external links are rendered only inside native video elements; remote scripts are never embedded.

## The collection

The versioned catalog lives in `public/catalog.json`. See [catalog selection and verification](docs/catalog.md) for sources and checks. Catalog data is a checked snapshot, not a live sales ranking. Discovery does not require a marketplace API to be available at page load. Art still streams from external hosts, whose availability can change.

The player preloads the next work, crossfades only after actual playback starts, retries an alternate URL when present, and skips failed or stalled works. If every work fails, it stops with a clear message rather than spinning through an endless queue. On the collection page, a maximum of four visible previews animate at once; reduced-motion users get still identification previews until they explicitly start playback.

Artwork titles and artist credits come from the source platforms. ArtDrops does not own or sell the artwork. Public display permissions are artwork-specific; consult each source or artist before a public exhibition. The repository includes metadata and links, not copies of the original artwork.

## Deployment

On Vercel, import this GitHub repository, select **Other**, use `npm run build`, and set the output directory to `dist`. No environment variables or secrets are required. The same `dist` directory can be served by any static host.

## Layout

```
public/       Page, stylesheet, favicon, checked catalog
src/          UI, validation and persistence helpers, exhibition player
scripts/      Local server, static build, catalog maintenance
tests/        Node built-in test runner
docs/         Catalog methodology and release verification
```
