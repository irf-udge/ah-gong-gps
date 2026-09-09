# data/

## `amenities.json` — committed, hand-curated by machine

The comfort layer (shelter/bench/toilet) `core/comfort.ts` scores routes
against. Baked from OpenStreetMap via the Overpass API, **build-time only** —
nothing in the request path calls Overpass; see `etl.ts`'s file header for
why (OneMap and data.gov.sg were both dead ends for this data — full
investigation trail is there, not repeated here).

Regenerate with:

```bash
npm run etl
```

This overwrites `amenities.json` with a fresh pull. Only do this deliberately
— it's committed so nobody needs a network call (or the ODbL attribution
obligation reasoning) to run the app.

Shape:

```jsonc
{
  "_meta": {
    "source": "OpenStreetMap via Overpass API",
    "attribution": "© OpenStreetMap contributors (ODbL) — https://www.openstreetmap.org/copyright",
    "generatedAt": "...",
    "bbox": { "minLat": 1.36, "minLng": 103.84, "maxLat": 1.38, "maxLng": 103.86 },
    "counts": { "shelter": 164, "bench": 9, "toilet": 3 }
  },
  "pois": [ /* Poi[] from src/core/types — read this array, not _meta */ ]
}
```

## ⚠️ ODbL attribution is a real product obligation, not a formality

OSM data is licensed under the Open Database Licence, not Singapore's Open
Data Licence (what OneMap uses). The app must credit **"© OpenStreetMap
contributors"** somewhere a user can actually see it — About screen, footer,
or the pitch deck's data-sources slide. This wasn't a requirement before this
data source was added; don't drop it when refactoring the About screen.

## `full_theme_dump.txt`

Evidence artifact from enumerating all 165 OneMap Theme layers — kept to show
the "OneMap Themes has no comfort data" finding wasn't a shallow keyword grep.
See CONTRACTS.md § 2.3. Not consumed by any code.

## What's NOT committed

`data/raw/` and `data/*.full.geojson` are gitignored — nationwide Overpass
dumps are large and fully regenerable; only the demo-corridor slice above is
worth keeping in git.
