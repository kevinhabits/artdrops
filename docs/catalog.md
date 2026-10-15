# Artwork catalog

ArtDrops ships a curated snapshot of 36 moving artworks by 33 artist identities, drawn from public objkt and Verse records. It is an editorial selection for exploring exhibition playback, not a sales ranking or a live marketplace feed. No artwork files are copied into the repository. The browser streams the original source-hosted media.

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

## Validation

On 2026-10-15 every selected source page, MP4, and poster responded successfully; all MP4s were identified as `video/mp4` and supported byte ranges. FFmpeg 7.1 decoded three sampled frames for every video, scaled to at most 96×96 at two frames per second. Every sample contained at least two distinct decoded frame hashes. Larry Cuba was sampled eight seconds into the film to avoid its opening. This confirms decodability and changing sampled frames; it does not certify a complete screening, seamless looping, long-term availability, a native 4K master, or quality on every browser/network.

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

`--write` always includes motion validation. It updates timestamps only after the entire current selection passes, using an atomic file replacement. Any HTTP, decode, dimension, attribution, diversity, or empty-catalog failure leaves the existing catalog untouched and exits nonzero. The script preserves the editorial selection and does not silently replace unavailable pieces with random new results. Update metadata/selections deliberately in `public/catalog.json`, then run both checks. URLs can change or become unavailable after validation.

## Initial checked selection

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
