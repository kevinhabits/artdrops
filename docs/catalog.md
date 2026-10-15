# Artwork catalog

ArtDrops ships a curated snapshot of 122 moving artworks by 87 artist identities, drawn from public objkt and Verse records. It is an editorial selection for exploring exhibition playback, not a sales ranking or a live marketplace feed. No artwork files are copied into the repository. The browser streams the original source-hosted media.

## Provenance and selection

- **objkt:** public GraphQL API at `https://data.objkt.com/v3/graphql`. Token name, creator alias/address, artifact URI, and source identity come from token metadata. Query below selects MP4s; curation then excludes memes, talking-head clips, duplicate editions, and visually unsuitable candidates.
- **Verse:** public GraphQL API at `https://api.verse.works/query`. Larry Cuba’s title, artist, media, and year come from the artwork record. Its source is the official [Calculated Movements release](https://verse.works/series/calculated-movements-larry-cuba). This is the 2026 digital edition of the 1985 film.
- **Media delivery:** objkt’s official frontend uses `https://assets.objkt.media/file/assets-003/{IPFS-CID}/artifact` and `/{contract}/{tokenId}/thumb400`. These source-owned CDN URLs were confirmed against the public frontend and checked individually. Some artist previews remain animated or large; thumbnails load on demand in the application. Verse’s original static media endpoint is used after its image transformation service returned an error.
- **Attribution:** artist aliases are preserved, with surrounding whitespace removed. `a-paufler` and `a_paufler` identify two accounts whose descriptions both attribute the work to `@a_paufler`; they share one `artistKey`. Each artist has at most two works. The first six works represent six distinct artists.
- **Dates:** `year` is the source edition/mint year unless the artwork description explicitly supplies a creation year (INSIDE/OUT: 2017). `verifiedAt` records successful media validation, not creation or licensing.
- **Dimensions:** actual decoded video dimensions, rather than promotional text. A 4K display can play the whole catalog; many artworks are below 4K resolution. Portrait and square works preserve their native proportions.
- **Rights:** source links and attribution do not confer exhibition rights. Artwork copyright and any exhibition permissions remain with the respective rightsholders.

Example metadata query (the public API caps results at 500):

```graphql
{
  token(limit: 500, order_by: {timestamp: desc}, where: {
    mime: {_eq: "video/mp4"}, supply: {_gt: "0"}
  }) {
    pk name description artifact_uri display_uri thumbnail_uri
    mime fa_contract token_id timestamp
    creators { holder { alias address } }
  }
}
```

## Exhibition length

At 30 seconds per artwork, 120 distinct works provide one nominal hour before repeating. The catalog contains 122 works (61 nominal minutes), including two reserve selections. Short source clips loop within their allotted slot; longer films play an excerpt. Repeating a 120-work queue four times yields approximately four hours, plus any loading time. This is program-length arithmetic, not a claim that four hours of unique source footage are included.

The original 36 selections retain their IDs, metadata, and order. The expansion adds 86 works across abstract animation, generative art, moving illustration, and stylized environments. Each artist remains capped at two works, with known account aliases grouped. Newly added media uses H.264 MP4; four candidate HEVC files were excluded for broader native-browser compatibility. Candidate posters were visually reviewed, excluding promotional cards, talking heads, and unsuitable material.

## Validation

On 2026-10-15 every selected source page, MP4, and poster responded successfully; all MP4s were identified as `video/mp4` and supported byte ranges. FFmpeg 7.1 decoded three sampled frames for every video, scaled to at most 96×96 at two frames per second. Every sample contained at least two distinct decoded frame hashes. Larry Cuba was sampled eight seconds into the film to avoid its opening. This confirms decodability and changing sampled frames; it does not certify a complete screening, seamless looping, long-term availability, a native 4K master, or quality on every browser/network.

No uninterrupted four-hour screening on a physical exhibition display has been performed.

The public catalog is a fixed selection. No API keys, wallets, market-price estimates, or data refresh jobs are needed for site playback.

## Maintenance

Requires Node.js 20+ with built-in `fetch`. Run from the repository root:

```sh
node --test tests/catalog.test.mjs
node scripts/refresh-catalog.mjs --check
```

The read-only network check validates every media URL’s HTTP response, MP4 signature, poster MIME type, and source page. It stops reading after the MP4 header even if a server ignores byte ranges. It does not refresh timestamps or claim new motion verification.

To repeat decoded-motion validation, install FFmpeg separately or provide its existing executable path:

```sh
FFMPEG_BIN=/absolute/path/to/ffmpeg node scripts/refresh-catalog.mjs --motion
FFMPEG_BIN=/absolute/path/to/ffmpeg node scripts/refresh-catalog.mjs --write
```

`--write` always includes motion validation. It updates timestamps only after the entire current selection passes, using an atomic file replacement. Any HTTP, decode, dimension, attribution, diversity, or catalog-size failure leaves the existing catalog untouched and exits nonzero. The script preserves the editorial selection and does not silently replace unavailable pieces with random new results. The validator requires 120–150 works and at least 60 artist identities. Update metadata/selections deliberately in `public/catalog.json`, then run both checks. URLs can change or become unavailable after validation.

## Checked selection

| Artwork | Artist | Decoded dimensions | Source |
|---|---|---|---|
| Liquid Abstract G2-186 | Marcelo Kato | 2000 × 2000 | [objkt](https://objkt.com/tokens/KT1WNq5XeVY4628bPbRZ2qkj8aS2RDPW8uFb/193) |
| 26281 | Bri4nH3nry | 1920 × 1080 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/48137) |
| Lines of Force 11 · Scatter | Wozo | 1600 × 1600 | [objkt](https://objkt.com/tokens/KT1VFfnhCVjBkEZK7CYURJRFxtHBsxjvuRTC/12) |
| Fractal Dream #30 | Driven by Dreams | 1920 × 1080 | [objkt](https://objkt.com/tokens/KT1FAu5MD3nKbzDwBmntLK7rQtApFFrkkKNr/30) |
| Resonant Fluidity | Cromwell | 2160 × 3840 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/47389) |
| Test Tile 02 (Line Blend) | Tom Lauerman | 3648 × 3648 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/885499) |
| DoodleDeProgramming_20261014 | JunKiyoshi | 720 × 720 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/885716) |
| Totem | KeyRun | 2160 × 3840 | [objkt](https://objkt.com/tokens/KT1RsmUhVphfQPAD7HoVqosskwCnYnqt6MHc/4) |
| blue clouds | ake | 2560 × 1664 | [objkt](https://objkt.com/tokens/KT1E7WQFt861FRBvKPDQJBu9hSGHF4acaLBx/15) |
| Untamed 19 | _arahad_ | 1904 × 1080 | [objkt](https://objkt.com/tokens/KT1D1qHkZtiZmyXvjS2UTYCj79NrWErFPp1x/21) |
| Es zieht | ₸ommy | 3840 × 2160 | [objkt](https://objkt.com/tokens/KT1DBA4J1muAb8JSzU5tdAuKKNk2uSxCyV8n/32) |
| Monostorm. | Kopfgestaltung | 1920 × 1280 | [objkt](https://objkt.com/tokens/KT1VBS1F8iRiix3eD4DK6MnSGatvndrTyfih/56) |
| Calculated Movements #5 | Larry Cuba | 1440 × 1080 | [Verse](https://verse.works/series/calculated-movements-larry-cuba) |
| NFT_Form of a Passage No_31 and 34 | Niko Hendrickx | 1050 × 1050 | [objkt](https://objkt.com/tokens/KT1DDUtxsWB9pLUfCcP5njYP22fwmHNPPzRc/16) |
| INTERFERENCE : PROOF 01 | NARI (나리) | 1080 × 1350 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/47947) |
| fragments ZTX-279 | Marcelo Kato | 2000 × 2000 | [objkt](https://objkt.com/tokens/KT1DvD5c1shgVHJT2amVUz3tgYiKPjRoBhyN/280) |
| apb-128 v1s5 | a-paufler | 1080 × 1080 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/885714) |
| INSIDE/OUT | Revolue | 1080 × 1920 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/47903) |
| Vessel | beantart | 2160 × 2160 | [objkt](https://objkt.com/tokens/KT1Pq34ERojxf3mHGL68rbLNssFdjXVdh4Z3/8) |
| Picture-in-picture | Zhou Zeliang | 3840 × 1966 | [objkt](https://objkt.com/tokens/KT1F97g5mcy8kCdsvMBgjg8A9Tbhir4JFjHj/42) |
| HARDWARE #06 - Late Signal | kemme | 800 × 800 | [objkt](https://objkt.com/tokens/KT1WHrdiR2bUctyqoLnRKmqk3eVc8cGDujWc/5) |
| DNFTA October 5, 2026 | sphericalart | 1080 × 1080 | [objkt](https://objkt.com/tokens/KT19sLmQ5RFyj2vqpNerzdksssXTHwMoedPJ/18) |
| Lines of Force 10 · Octupole | Wozo | 1600 × 1600 | [objkt](https://objkt.com/tokens/KT1VFfnhCVjBkEZK7CYURJRFxtHBsxjvuRTC/11) |
| the ferryman | GŁOWA | 1280 × 1280 | [objkt](https://objkt.com/tokens/KT1WYn4it4wrNSQgDe9cgowRjeLcJuMkA7pE/71) |
| Across The Horizon | Causa sui | 1280 × 1280 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/47961) |
| The Dervish's Dream | Feyzullah.Tunc | 2160 × 2700 | [objkt](https://objkt.com/tokens/KT1B67Xd3V3pwGVhC7ZPNLsgAVxorGSYcYZY/4) |
| Quixote | VLDZ ∞ Vampy | 1792 × 1024 | [objkt](https://objkt.com/tokens/KT1MhodKgE3BUJ3Ry23WPpqnTWaMmH3wjGRZ/306) |
| apb-211 v10s15 | a_paufler | 1080 × 1920 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/885680) |
| Interaction of the Living-4B/ Interaction du vivant-4B | Veronique Egloff | 1200 × 1920 | [objkt](https://objkt.com/tokens/KT1JMxFRHVNXpoLArdQC4VWA3V2U1vnfAv6P/7) |
| ENTITY_001 | LoreTechX | 1024 × 1024 | [objkt](https://objkt.com/tokens/KT1DjaDWzv3JSnKMPovEjbJpA3EdEbxRDtd9/0) |
| Signal Drop | INspireENcrypt | 540 × 540 | [objkt](https://objkt.com/tokens/KT1X44KgXt1WeUkCaCAe51SKdEu4s8951X5F/17) |
| ritual | nebülar | 1920 × 1080 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/885704) |
| The Bench #20 | TokenPeacock 🦚 | 800 × 800 | [objkt](https://objkt.com/tokens/KT1R89ivyMC9qe99SEYkn9zHJK7kv9238u9k/49) |
| Rain Between Us | Bahar | 1080 × 1920 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/47761) |
| Joe | Leon Vilhena | 1920 × 1080 | [objkt](https://objkt.com/tokens/KT1Rz8UKrWh2pptYMqopQeURgU6GN33kuPsC/3) |
| Invasion no. 10 | Criptocromo | 1080 × 1080 | [objkt](https://objkt.com/tokens/KT1UD2xfU5SuerLFjonmiS7dBiVe6YeGNNmm/13) |
| NFT_Form of a Passage No_28 and 35 | Niko Hendrickx | 1050 × 1050 | [objkt](https://objkt.com/tokens/KT1DDUtxsWB9pLUfCcP5njYP22fwmHNPPzRc/15) |
| HARDWARE #05 - One More Level | kemme | 800 × 800 | [objkt](https://objkt.com/tokens/KT1WHrdiR2bUctyqoLnRKmqk3eVc8cGDujWc/4) |
| 26280 | Bri4nH3nry | 1080 × 1350 | [objkt](https://objkt.com/tokens/KT1Dd1joaMCh3vrNjUYLD2g4wV1K4JFUoTLp/243) |
| one in the hand | GŁOWA | 1280 × 1280 | [objkt](https://objkt.com/tokens/KT1WYn4it4wrNSQgDe9cgowRjeLcJuMkA7pE/70) |
| DoodleDeProgramming_20261013 | JunKiyoshi | 720 × 720 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/885687) |
| driftwood | VLDZ ∞ Vampy | 2048 × 2048 | [objkt](https://objkt.com/tokens/KT1U1JYXNDLgiq7YCfr8JX4gGMaZt4GjxhqY/29) |
| Stehen lassen | ₸ommy | 3840 × 2160 | [objkt](https://objkt.com/tokens/KT1DBA4J1muAb8JSzU5tdAuKKNk2uSxCyV8n/21) |
| Alchemie. | Kopfgestaltung | 1080 × 1920 | [objkt](https://objkt.com/tokens/KT1VBS1F8iRiix3eD4DK6MnSGatvndrTyfih/54) |
| Untamed 18 | _arahad_ | 1904 × 1080 | [objkt](https://objkt.com/tokens/KT1D1qHkZtiZmyXvjS2UTYCj79NrWErFPp1x/20) |
| Interaction of the Living-4A/ Interaction du vivant-4A | Veronique Egloff | 1200 × 1920 | [objkt](https://objkt.com/tokens/KT1JMxFRHVNXpoLArdQC4VWA3V2U1vnfAv6P/6) |
| Invasion panel no. 9 | Criptocromo | 1080 × 1080 | [objkt](https://objkt.com/tokens/KT1UD2xfU5SuerLFjonmiS7dBiVe6YeGNNmm/12) |
| OBALMCNAKSY18207182NDJAK | Revolue | 1080 × 1920 | [objkt](https://objkt.com/tokens/KT1XsnLsCYbZA4f6fLK729nWVtWo2u9d7AMT/291) |
| Fractal Dream #29 | Driven by Dreams | 1920 × 1080 | [objkt](https://objkt.com/tokens/KT1FAu5MD3nKbzDwBmntLK7rQtApFFrkkKNr/29) |
| Suspended Tide | INspireENcrypt | 540 × 540 | [objkt](https://objkt.com/tokens/KT1X44KgXt1WeUkCaCAe51SKdEu4s8951X5F/15) |
| The Red Poppy's Dream | Feyzullah.Tunc | 3024 × 2160 | [objkt](https://objkt.com/tokens/KT1XD2CC8b6dFTR7e5V57GLJr7wJ65yKXTJe/5) |
| Apertures 02 | Tom Lauerman | 3648 × 3648 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/885021) |
| · Simulac Room · | Causa sui | 1280 × 1280 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/46437) |
| The Bench #19 | TokenPeacock 🦚 | 800 × 800 | [objkt](https://objkt.com/tokens/KT1R89ivyMC9qe99SEYkn9zHJK7kv9238u9k/48) |
| The Image After the Image | Zhou Zeliang | 3840 × 1966 | [objkt](https://objkt.com/tokens/KT1F97g5mcy8kCdsvMBgjg8A9Tbhir4JFjHj/41) |
| The Familiar Stranger | Muriel Lherm | 1936 × 1080 | [objkt](https://objkt.com/tokens/KT1HTXSevcJecVGdNRJpCNBLcyZowSkgbXzv/15) |
| Ripples at Dawn | Neha-Mahout | 2000 × 2000 | [objkt](https://objkt.com/tokens/KT1Ra6KqjpwLMXTLkEG11gkh8W9SkgkPKEfm/125) |
| Root Of The Unspoken | Jimberton | 2160 × 2160 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/48030) |
| Night I · The Tide — Seven Nights of Miami | Maya Reyes | 1248 × 1664 | [objkt](https://objkt.com/tokens/KT1PFUFmpchmvRhXjT7XZWZYqyr7kooCnjuN/0) |
| Just a Moment | Art by Jackie D. | 928 × 1376 | [objkt](https://objkt.com/tokens/KT1TDY8d1k8KhJ4cYd5jMU9UtDyCkaDyCNDX/70) |
| Crimson Nebula: Birth of a World | Esiart | 1440 × 2160 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/47753) |
| Among the giant flowers | Digital art art | 1280 × 704 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/47656) |
| Blooming in Silence | Artamis | 720 × 1280 | [objkt](https://objkt.com/tokens/KT1AJ6xdzVqEHCYWJ6TkVY5CfkX7jRuiQFjb/8) |
| Atom-Shift-01 | SystemPulse | 2304 × 2304 | [objkt](https://objkt.com/tokens/KT1AJgeRSkGjEPjTw6bRUBJDyUsZHcERtxax/2) |
| Soloist #12 - Flow | Crawford Curates | 3840 × 2160 | [objkt](https://objkt.com/tokens/KT1T6f84Qf2c9T2XoAwSXcUJCk2HaQx1ZCtn/11) |
| Panorama 8 | Dr. Version | 3840 × 1600 | [objkt](https://objkt.com/tokens/KT1Upr1ZDomWVtDR47B9h19HJn2MRAdbCASw/7) |
| LSD — Hypnosis | A.WAY | 1920 × 1080 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/46799) |
| The Eye Between Worlds | Bita Ghasemi | 720 × 720 | [objkt](https://objkt.com/tokens/KT1SDLrq8ZC4yH576D7svijzrc7afH6eaPKz/8) |
| nP1X -F4llw | CIVIT | 2500 × 2500 | [objkt](https://objkt.com/tokens/KT1WcMRjTRBqruupHkQVTFzFCb9dUREgo5xb/46) |
| Late Nights | psydigitalart | 1800 × 2200 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/46718) |
| THE FAILURE XXVI | Maxime Besnard | 1080 × 1920 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/885133) |
| UNKNOWN CIRCUIT — MM7 | @MOBIN | 720 × 1600 | [objkt](https://objkt.com/tokens/KT1Xcg8wct5cfyWiHCkHPXhxCoPD6nFRTGRu/0) |
| daemon | ana carolina | 1080 × 1080 | [objkt](https://objkt.com/tokens/KT19wRN6ozmy7nzC5drKi8RLyNvodsVqeS2T/12) |
| The Mountain’s Breath | wow_studio | 1280 × 720 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/46420) |
| Where the Rails Take You | 0xVac | 1920 × 1080 | [objkt](https://objkt.com/tokens/KT1V2yv5Edncq5GCKDpVD4p1E6A4QwoJR5Hp/0) |
| Ink 🌳 3 : Chaos | rodicqart | 2160 × 3840 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/885011) |
| The Room Beneath | Rozan | 736 × 544 | [objkt](https://objkt.com/tokens/KT1CxZRWNZU4agdBfmad16G5hxvCMg84gdCo/9) |
| Flowers Bloom, Bugs Prosper | Riniifish | 1920 × 1920 | [objkt](https://objkt.com/tokens/KT1PZ1QBFFFZjXapbb7pnr9q8p86R5622C5t/18) |
| Alive | Chroma Visions | 992 × 736 | [objkt](https://objkt.com/tokens/KT1PxkUVWqcyTHDC8god5pg4n1CaEkpjUwWh/31) |
| Saudade | bosquegracias | 1280 × 720 | [objkt](https://objkt.com/tokens/KT19beXXFz7Zk1sxDyhiRq7YYo8YWdnBx1vz/19) |
| Eruption | Helio Santos | 1080 × 1080 | [objkt](https://objkt.com/tokens/KT18nSXK3MXNkmH9bXYG33bJHWgX8vMFF6wX/85) |
| Censor | EM ZEE | 1440 × 1444 | [objkt](https://objkt.com/tokens/KT1S1ae5m8FesD8BZvVCZRsCUe3FcCsoKjMY/1) |
| Magnetic Blue | Adriano C | 2160 × 2160 | [objkt](https://objkt.com/tokens/KT1D4coe8Md5EW8qUWFY1wntgaSuADzrFJpj/21) |
| spiral | plastekpet | 1614 × 1080 | [objkt](https://objkt.com/tokens/KT18tNPjWjqUaxUZw68MCXHSnkvazoueT3TV/2) |
| Pain visualised #2 (slow healing) | side effects - Plektani Art (Christina S.) | 2976 × 1440 | [objkt](https://objkt.com/tokens/KT1HSzXNvRsjFuJh9kpyC1XcqR5V5EqFKzsc/156) |
| The Perpetual Magnetic Monitoring System | Kira Risugawa | 956 × 720 | [objkt](https://objkt.com/tokens/KT1RCp3crAHbhos5DVbr9hBQVVgyKu1s89qa/7) |
| Acid Meditation | natcat | 1920 × 1080 | [objkt](https://objkt.com/tokens/KT1Nu9Wrtg19qrpW5Lj9DUveJWS3t8mhCfVc/4) |
| Crimson Nebula | BlackLoopLab | 1440 × 2160 | [objkt](https://objkt.com/tokens/KT1VHoxXoYX9LYEKe1AjPHaRq3zPZ4cZd6my/11154) |
| Field of Convergence | LUANOTX | 3840 × 2160 | [objkt](https://objkt.com/tokens/KT19wRN6ozmy7nzC5drKi8RLyNvodsVqeS2T/4) |
| The Pull Beyond | FotoGraaGHanneke Visuals | 1280 × 1080 | [objkt](https://objkt.com/tokens/KT1F4zusCE7on7HiDUQ5MDwQz6gXzDYmHJqc/6) |
| IOR | Rapha Mey | 3840 × 2160 | [objkt](https://objkt.com/tokens/KT19wRN6ozmy7nzC5drKi8RLyNvodsVqeS2T/3) |
| dream_amnesia_ | ex_mortal_ | 1400 × 1008 | [objkt](https://objkt.com/tokens/KT1NffzaN4wHEXviSXgAnwwxDHRUJ5g7ZC44/170) |
| Where There is Deception | Red Alark | 1080 × 1902 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/884894) |
| isoray_1786195941960-a | Yoshi Sodeoka | 1080 × 1080 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/43145) |
| Views of Seasons (fragmented) | Ivona Tau | 2560 × 1422 | [objkt](https://objkt.com/tokens/KT1HA1w8HJ4WeniFmLbibR6a1QkpTe69jeNM/5) |
| Shiraz: A Potential Memory | Benjamin Bardou | 1920 × 1080 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/42535) |
| Two Fingers Upon The Heartbeat Of The Universe | Somfay | 2160 × 2880 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/884117) |
| RGB Interchange | LibroBlock | 2560 × 2560 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/45287) |
| psalm 33 | lindadounia | 3086 × 2160 | [objkt](https://objkt.com/tokens/KT1D9k3A7Pyk7qq1sgEsKoqi7NCNXkNWaiqZ/5) |
| Layered Sketch 1 | V4w.enko | 800 × 1500 | [objkt](https://objkt.com/tokens/KT1SCRGYjcuMSqLAxTHzhhtoi6SonaKGMAWq/8) |
| Temporary Alluvial Deposits | Strakts | 3036 × 4096 | [objkt](https://objkt.com/tokens/KT1GGd7CLG1wRctFAXA19e3sJVSCnZoRS7Fb/18) |
| What Remains of a Line | .- NEOL -. | 1080 × 1130 | [objkt](https://objkt.com/tokens/KT1NEzFZtMwAqF3NAYaSZ25Goinq7yve4qEQ/10) |
| Into My Cells #15 | Samantha E. Harvey [SEH] | 1080 × 1920 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/883114) |
| Linear Orbit | Leotorcello | 3840 × 2160 | [objkt](https://objkt.com/tokens/KT1Qg5T8RutAtH1N6yFqMXho2JECLjvgWf7G/19) |
| Edge Of Tomorrow.mov | Mariuscarl | 2160 × 2904 | [objkt](https://objkt.com/tokens/KT1QLoo5Yn7Jp3j46LKtdZsTmVBwDKySpC2J/7) |
| Dance through the future | ZEROREZERO | 1920 × 1080 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/882986) |
| Node Based | Luiz André Gama | 1080 × 1920 | [objkt](https://objkt.com/tokens/KT1FoTrsVjDTmLbxmLgGwd9u7xW8itdzYQ8h/199) |
| Micro Macro Wall | rangga_purnama_aji | 1080 × 1920 | [objkt](https://objkt.com/tokens/KT1EEUYSxHeyS9J7euUVBCywLLtoqnx7nizA/25) |
| AETHER FORM III — Contained Current | PHILIPPE CEULEMANS - PHC ART | 2160 × 2160 | [objkt](https://objkt.com/tokens/KT1FwpZfQzp2Shjy78o8UFxUGbmSY2YxMEzz/2) |
| The Weight of Invisible Things | Muriel Lherm | 1792 × 2688 | [objkt](https://objkt.com/tokens/KT1HTXSevcJecVGdNRJpCNBLcyZowSkgbXzv/14) |
| Cosmic Drift | Artamis | 512 × 1088 | [objkt](https://objkt.com/tokens/KT1AJ6xdzVqEHCYWJ6TkVY5CfkX7jRuiQFjb/7) |
| Soloist #11 - Flow | Crawford Curates | 3840 × 2160 | [objkt](https://objkt.com/tokens/KT1T6f84Qf2c9T2XoAwSXcUJCk2HaQx1ZCtn/10) |
| Panorama 7 | Dr. Version | 3840 × 1600 | [objkt](https://objkt.com/tokens/KT1Upr1ZDomWVtDR47B9h19HJn2MRAdbCASw/6) |
| Recursive Gaze | Bita Ghasemi | 720 × 1280 | [objkt](https://objkt.com/tokens/KT1SDLrq8ZC4yH576D7svijzrc7afH6eaPKz/5) |
| nP1X-5WF71e | CIVIT | 2000 × 2000 | [objkt](https://objkt.com/tokens/KT1WcMRjTRBqruupHkQVTFzFCb9dUREgo5xb/45) |
| Noise Shot | EM ZEE | 1440 × 2560 | [objkt](https://objkt.com/tokens/KT1S1ae5m8FesD8BZvVCZRsCUe3FcCsoKjMY/0) |
| wings | plastekpet | 1618 × 1080 | [objkt](https://objkt.com/tokens/KT18tNPjWjqUaxUZw68MCXHSnkvazoueT3TV/1) |
| The Fluid Spore Coupling System | Kira Risugawa | 720 × 720 | [objkt](https://objkt.com/tokens/KT1RCp3crAHbhos5DVbr9hBQVVgyKu1s89qa/2) |
| psalm 32 | lindadounia | 3086 × 2160 | [objkt](https://objkt.com/tokens/KT1D9k3A7Pyk7qq1sgEsKoqi7NCNXkNWaiqZ/4) |
| RGB Interference | LibroBlock | 2560 × 2560 | [objkt](https://objkt.com/tokens/KT1XaCf6gkjFnKg3QmPfn6gep53moMvjkj1E/43696) |
| Perpetual Constraint | Leotorcello | 1080 × 1080 | [objkt](https://objkt.com/tokens/KT1Qg5T8RutAtH1N6yFqMXho2JECLjvgWf7G/18) |
| Palace Empath | Somfay | 2160 × 2880 | [objkt](https://objkt.com/tokens/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/884100) |
