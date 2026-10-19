# Requested references

Checked on 2026-10-19. The library now contains **1,757 options**: the original 167 videos plus **1,590 new options**. These additions include 761 SuperRare artworks, 414 Orkhan episodes with two views each (828 options), and Emberblend’s cherry-blossom loop. Variants are counted as separate selectable options, not separate original artworks.

| Reference | Available options | Coverage |
| --- | ---: | --- |
| [Still MS Painting](https://superrare.com/collection/1-0x4573cfc6cd3bf62000c1b0b55ce1beeee0b8cbd8) | 12 | 12 records discovered; source reports 12. |
| [20 tales from dreadland](https://superrare.com/collection/1-0xa930ef880909b589a525ffd9bd8e60854a2e0a02) | 20 | 20 records discovered; source reports 20. |
| [Untitled](https://orkhan.art/untitled/gallery) | 828 | 414 episodes, each with standard and mask views; 560 × 560. |
| [Faceprint](https://superrare.com/collection/0x0b41706c0d7660842a54e573014e8d0fe388d58f) | 169 | 169 records discovered; source reports 169. |
| [Hazed](https://superrare.com/hazed) | 44 | 44 records discovered; source reports 44. |
| [Botto](https://superrare.com/botto) | 251 | 251 records discovered; source reports 251. |
| [Intrepid](https://superrare.com/intrepid) | 98 | 98 records discovered; source reports 98. |
| [Beverly Kills](https://superrare.com/beverlykillsartist) | 88 | 88 records discovered; source reports 88. |
| [New Light Visuals](https://superrare.com/newlightvisuals) | 52 | 52 records discovered; source reports 52. |
| [Book of Bee](https://superrare.com/bookofbee) | 27 | 27 records discovered; source reports 27. |
| [Endless Cherry Blossom Loop](https://www.reddit.com/r/blender/comments/fm6t8y/endless_cherry_blossom_loop_made_in_blender_1_hr/) | 1 | Silent 60-second browser-compatible copy; 1920 × 1080. |

Counts come from the current public records and checked files; some differ from the original brief. Pagination reached the end of every SuperRare collection and artist profile. Every discovered candidate passed the media checks.

The three supplied Charles/Steve videos and the Duckmania file were left out at the user’s request. Their private Drive links are not part of the published library.

## Choosing artwork

Use **Collection**, **Media**, and the shape filter to narrow the library. The additions contain 277 moving options (videos or animated GIFs) and 1313 still-image options. Both work in the same silent, fading exhibition. Collection bulk-add respects the separate 150-work queue limit and offers Undo. Existing saved queues remain intact.

Beverly Kills’ **TEC-9 (image view)** displays the source-provided still representation of an interactive piece; the original interaction is not reproduced.

The full library has 75 works meeting the high-resolution **9:16 screen** filter. A **Portrait screen** one-hour mix selects from that group; other compositions remain available under **All shapes**. Use **Show full artwork** to preserve the composition on the vertical Samsung display.

Orkhan’s official gallery files are only **560 × 560**, so they are excluded from the high-resolution portrait preset. The blossom copy is **1920 × 1080**, from a source that the creator describes as upscaled from a 540p render. Neither is presented as native 4K artwork. The physical Samsung display has not been tested.

## Verification and hosting

- SuperRare titles and artist identities come from its public collection/profile pages and GraphQL records. Each included media URL passed an HTTP, signature, and dimension check. GIFs and videos were decoded into sampled frames; animated GIF labels require changing frames. Included videos use browser-compatible 8-bit H.264. Gallery thumbnails use verified official smaller images where available; exhibition playback retains the verified media URL. Recorded dimensions describe the actual file served, which may be smaller than dimensions declared in older token metadata (Faceprint files currently serve at 1280 × 1280).
- All 828 Orkhan URLs returned WebP images with actual 560 × 560 dimensions and distinct file hashes. Episode titles and mask links come from the artist’s metadata and gallery.
- The blossom copy was fully decoded, and six sampled frames confirmed motion. It has no audio stream. Its creator’s reuse statement, source link, and transformation details are in [the media credits](../public/media/README.md).
- SuperRare and Orkhan artwork files remain on their existing public hosts. The creator-permitted blossom derivative is the only new artwork binary hosted in this repository. Public links can change; the player keeps the outgoing work visible while loading and skips failed media.
- Player, browser, fullscreen, and release checks are documented in [verification.md](verification.md). Media checks do not establish public-exhibition rights; consult the artwork’s source or creator.

## Refresh the snapshot

The app reads saved static JSON and does not call marketplace APIs at runtime. Import artifacts stay in the ignored `artifacts/` directory.

1. Run `node scripts/import-superrare.mjs --posters`. Set `FFMPEG_BIN` if FFmpeg is not on PATH. The importer paginates public records, respects bounded rate-limit retries, and checkpoints verified results by source. `--resume --posters` continues an interrupted run without repeating completed groups; `--cached-only --posters` retries saved records; `--posters-only` refreshes thumbnails without changing artwork URLs.
2. Run `node scripts/import-orkhan.mjs` to check all episode variants and official metadata. Its metadata-file, gateway, and concurrency flags support controlled retries.
3. Review candidate JSON and reports. Run `node scripts/assemble-references.mjs`, then `node scripts/validate-references.mjs`. Assembly refuses an empty replacement, duplicate media or IDs, missing dimensions, and mismatched reference counts.
4. Run `npm test` and `npm run build`; verify the browser flow within the user's current testing constraints. Under background-only instructions, keep the browser hidden and use the automated fullscreen tests; skip actions that would enter fullscreen or bring a window forward. Publish through the existing GitHub/Vercel pipeline and compare the live assets against the build.

Primary references: [SuperRare API documentation](https://help.superrare.com/en/articles/10683308-superrare-public-api-documentation), [Orkhan gallery](https://orkhan.art/untitled/gallery), [Emberblend’s original thread](https://www.reddit.com/r/blender/comments/fm6t8y/endless_cherry_blossom_loop_made_in_blender_1_hr/).
