# TennoDock data

Public data files for [TennoDock](https://github.com/nxtdxve), a Warframe companion app for Overwolf. The app downloads
them at most once or twice a day; nothing in this repository is personal data.

## Market prices

`prices/v1/prices.json` holds a usual platinum price for every tradable item that sold in the last 14 days.

- **What the price is:** the median of the daily median prices of completed trades over the last 14 days (UTC), weighted
  by the number of items sold. If the median sell offer of the newest day is lower, that offer is used instead.
  Mods and arcanes have a price per rank, relics per refinement, Ayatan sculptures per number of stars.
- **Source:** the daily statistics files of [relics.run](https://relics.run/history/), which come from
  [warframe.market](https://warframe.market). If relics.run has no new file for two days, the workflow falls back to
  warframe.market itself (the daily list of Prime prices).
- **Updated:** every day, for the previous day, usually between 02:30 and 04:30 UTC. GitHub starts scheduled runs hours
  late, so the workflow is scheduled every hour from 18:17 to 04:17 UTC: a run before relics.run has the new day asks
  once and ends, the first run after it builds the files, later runs fetch nothing. A run at 10:17 UTC catches a day
  when all of them failed.
- TennoDock is not affiliated with Digital Extremes, warframe.market or relics.run.

### Format (version 1)

```json
{
  "format": "tennodock-prices",
  "v": 1,
  "asOf": "2026-10-22",
  "generatedAt": "2026-10-23T04:21:07Z",
  "windowDays": 14,
  "minTrades": 3,
  "source": "relics.run",
  "items": 3512,
  "dirs": {
    "Powersuits/Rhino/": { "RhinoPrime": [59, 535, 0] },
    "Upgrades/Mods/Rifle/": { "WeaponDamageAmountMod": { "r0": [3, 3, 9], "r10": [40, 25, 0] } }
  }
}
```

- `dirs`: game paths (`gameRef` on warframe.market) without the leading `/Lotus/`, grouped by folder. The full path of the
  first entry above is `/Lotus/Powersuits/Rhino/RhinoPrime`.
- Each price is `[platinum, sold, daysSinceLastSale]`: the price, the number of items sold in the window and the days
  between the last sale and `asOf`. Below `minTrades` sold, treat the price as uncertain.
- An item with variants has one entry per variant: `r<rank>`, a subtype such as `intact` … `radiant`, or
  `a<amber>c<cyan>` for sculptures. An item without variants has the price array directly.
- `asOf` is the newest day in the window. Items without a sale in the window are missing.
- An incompatible change gets a new folder (`prices/v2/`); `v1` keeps being written while apps still read it.

### Other files

- `prices/days/<day>.json`: the trades and offers of each day in the window, as read from the source. The workflow needs
  them to compute the 14-day price from one download a day.
- `prices/items.json`: warframe.market item ids with their game path and slug.
- `price-file/`: the script (Node 20 or newer, no dependencies) and its tests: `node --test "price-file/**/*.test.mjs"`.
  Run it locally with `node price-file/build.mjs`; `REBUILD=1` rebuilds the file without a new day. It also writes the
  price trends and the market analytics (below).
- `.github/workflows/prices.yml`: the daily workflow. Run it by hand under *Actions › Prices › Run workflow*.

## Price trends

`prices/v1/trends.json` holds the price history of every Prime set: one value per week for two years and one value per
day for the last 90 days. TennoDock shows it on its Vault Tracker page, next to the times a Prime was back at Varzia.

- **What a value is:** the median price of the completed trades of the set on that day (warframe.market slug
  `…_prime_set`), rounded to whole platinum. A week is the median of its days; older weeks keep their value after their
  days leave the 90-day part.
- **Source and update:** the same daily files as the market prices, in the same run. The file is also its own store:
  each run adds the days in `prices/days/` and drops values older than the range. Weeks before the first run were
  backfilled once from relics.run, one day (the Thursday) per week.
- **Backfill:** *Actions › Prices › Run workflow* with *backfill* fetches the Thursday of every week without any value,
  3 seconds apart (about 105 files of 4 MB the first time, then only weeks that are still empty). Locally:
  `TRENDS_BACKFILL=1 node price-file/build.mjs`. A file that is missing or not readable costs only its week.
- **Errors:** a failing trends build never holds back the price file. The workflow commits what is ready and fails
  afterwards (step *Report trends*), so GitHub sends a mail. An unreadable `trends.json` is never replaced silently.

### Format (version 1)

```json
{
  "format": "tennodock-trends",
  "v": 1,
  "asOf": "2026-10-25",
  "generatedAt": "2026-10-26T04:18:30Z",
  "source": "relics.run",
  "weekStart": "2024-10-28",
  "dayStart": "2026-07-28",
  "items": 165,
  "dirs": {
    "Powersuits/Odalisk/": { "ProteaPrime": { "w": [41, 43, null, 40], "d": [36, 35, null, 35] } }
  }
}
```

- `dirs`: game paths without the leading `/Lotus/`, grouped by folder, as in the price file. The path of a set is the
  path of the Prime itself (`/Lotus/Powersuits/Odalisk/ProteaPrime` is the Protea Prime set).
- `w`: 105 weekly values; index `i` is the week (Monday to Sunday, UTC) starting `weekStart + 7·i` days. The last one is the
  running week.
- `d`: 90 daily values; index `i` is the day `dayStart + i`, the last one is `asOf`.
- `null`: no trade that week or day (or no data yet). A set without any value is missing.
- An incompatible change gets a new folder (`prices/v2/`).

## Market analytics

`analytics/v1/market.json` tells, for every item that sold in the last 14 days, how much platinum changed hands, how
many sold and how its price moved. TennoDock shows it on its Analytics page, next to the items the player owns.

- **What the numbers are:** the last 7 days (UTC, up to `asOf`) and the 7 days before, from the same daily files as the
  market prices, in the same run, without any extra download. Platinum is the daily median price times the number sold,
  summed over all ranks or refinements of an item.
- **Outliers:** players report their sales on warframe.market themselves, and some report absurd prices (99,999
  platinum). A day of an item is left out when its median is more than `outlierFactor` (5) times the reference and at
  least 100 platinum. The reference is the lower of the median sell offer that day and the median of the item's other
  days; without either, a day above 5,000 platinum is left out. The number of rows left out is in the workflow log.
- **Price change:** only for the main variant (the rank or refinement with the most platinum), with at least `minTrades`
  (10) sales in both weeks and a price of at least `minPrice` (10) platinum in one of them. Otherwise `null`.
- **Errors:** like the price trends, a failing analytics build never holds back the price file. The workflow fails after
  the commit (step *Report analytics*), so GitHub sends a mail. The file is only written when something changed.

### Format (version 1)

```json
{
  "format": "tennodock-market",
  "v": 1,
  "asOf": "2026-11-06",
  "generatedAt": "2026-11-07T03:12:00Z",
  "source": "relics.run",
  "windowDays": 7,
  "minTrades": 10,
  "minPrice": 10,
  "outlierFactor": 5,
  "items": 3550,
  "days": [["2026-10-24", 2384205, 102325], ["2026-11-06", 1847896, 80454]],
  "dirs": {
    "Powersuits/Geode/": { "CitrinePrime": [214167, 3031, 252014, 3535, 70, 0] },
    "Upgrades/Mods/Warframe/Expert/": { "AvatarPowerMaxModExpert": [55672, 906, 47586, 829, 92, 2, "r10", 38.5, 10] }
  }
}
```

- `days`: the whole market per day, oldest first, up to 14 days: `[day, platinum, items sold]`, without outliers. A
  fourth value `"partial"` marks a day from the warframe.market fallback, which only knows Prime items.
- `dirs`: game paths without the leading `/Lotus/`, grouped by folder, as in the price file. Per item:
  `[platinum last 7 days, sold last 7 days, platinum 7 days before, sold 7 days before, price, change, variant, base price, base change]`.
  - `price`: price of the main variant in the last 7 days, the median of its daily medians weighted by the number sold
    (from the week before when it did not sell since).
  - `change`: price change of the main variant in percent against the week before, rounded, or `null` (see above).
  - `variant`: the main variant as in the price file (`r5`, `intact`, …); missing for items without variants.
  - `base price`, `base change`: the same for the base variant (rank 0 for mods and arcanes, intact for relics), the
    form most players own, when it is not the main variant and sold in the last 14 days; otherwise missing. The base
    change is `null` under the same rules as `change`.
- An incompatible change gets a new folder (`analytics/v2/`).

## KIM conversations

`kim/v1/en.json` and `kim/v1/de.json` hold the KIM conversations of the Protoframes in Warframe 1999: for every
conversation the choices, the chemistry each answer gives and whether it starts or rules out a romance. TennoDock shows
them in its in-game overlay, hidden until the player asks for them (story spoilers).

- **Source:** [Sainan/warframe-kim-dialogues](https://github.com/Sainan/warframe-kim-dialogues) (`data/` and `dicts/`),
  read from the game files by its author. Each file names the commit it was built from (`commit`, `asOf`).
- **License:** the source repository has no license. A request to its author is pending; until it is answered, these
  files are a copy for testing and may be removed. The conversation texts are © Digital Extremes.
- **Updated:** the workflow checks the source once a day at about 05:43 UTC and rebuilds only after a new commit.
- TennoDock is not affiliated with Digital Extremes or the author of the source.

### Format (version 1)

```json
{
  "format": "tennodock-kim",
  "v": 1,
  "lang": "en",
  "asOf": "2026-06-17",
  "generatedAt": "2026-10-27T05:43:12Z",
  "source": "Sainan/warframe-kim-dialogues",
  "commit": "fc6affb35380324297b29eb75e06619f767078da",
  "texts": true,
  "people": {
    "Arthur": {
      "ArthurRank2Convo3": {
        "r": 2,
        "first": "First message of the conversation",
        "c": [
          { "p": "Message before the choice", "a": [{ "t": "Answer", "c": 10 }, { "t": "Other answer", "c": 20, "m": 5, "f": "n" }] },
          { "p": "…", "a": [{ "t": "…" }, { "t": "…", "c": 5 }], "af": [0, [0]], "if": ["ArthurLikesCats", true] }
        ]
      }
    }
  }
}
```

- `people`: one entry per dialogue file (`/Lotus/Types/Gameplay/1999Wf/Dialogue/<Person>Dialogue_rom.dialogue`), then
  one per conversation. The key is the id the game stores in `DialogueHistory.Dialogues[].Completed[].Id`. Files without
  chemistry (group chat, Loid, introductions) and birthday messages are missing.
- `r`: the chemistry rank of the conversation (`…Rank3Convo2`), missing for special conversations. `first`: its first
  message, at most 160 characters.
- `c`: the choices with at least two answers, in the order of the conversation (empty for a conversation without a
  choice). `p`: the message before the choice (at
  most 160 characters). `af: [i, [j…]]`: the choice only comes after one of the answers `j` of choice `i`.
  `if: [name, value]`: it only comes if the flag `name` from an earlier conversation is set (`true`) or not (`false`).
- Answers: `t` the text, `c` the chemistry until the next choice (the highest of all paths, missing for 0), `m` the
  lowest one if it is lower (the path depends on a flag), `f` flags: `n` rules out a romance with the person, `d` starts
  one (derived from the flag names, e.g. `AoiNoDate`, `AoiDating`). Answers keep the order of the source.
- `texts: false`: the files were built without game texts (repository variable `KIM_TEXTS=none`): no `t` and no `p`, and
  `first` holds only the first three words.
- An incompatible change gets a new folder (`kim/v2/`).

### Other files

- `kim-file/`: the script (Node 20 or newer, no dependencies) and its tests: `node --test "kim-file/**/*.test.mjs"`.
  Run it locally with `node kim-file/build.mjs`; `REBUILD=1` rebuilds without a new commit. A file whose content did
  not change is not written again (same file, same ETag, no new download in the app).
- `.github/workflows/kim.yml`: the daily workflow. Run it by hand under *Actions › KIM › Run workflow*.

## Game assets

`assets/v1/` holds images from the game that TennoDock needs but Digital Extremes does not serve in its Public Export:
the frame parts of mod cards, ten syndicate logos, the glyphs of the focus nodes, the game's one-colour menu glyphs,
pictures of collectibles, the icons of the profile challenges and the symbols of damage types and intrinsics. TennoDock
downloads a family only when a page needs it, or at start when an in-game overlay card that needs it is switched on, and
keeps it on disk; without a network it shows simple cards and icons instead.

- **Families:** `mod-frames` (frame parts of mod, riven and arcane cards), `syndicate-logos` (one-colour logos, tinted by
  the app), `focus-glyphs` (masks of the 75 focus nodes), `game-glyphs` (one-colour menu glyphs of the game for item
  categories and sources, drawn as masks), `collectibles` (lore and Somachord fragments, tiles of the page Collectibles),
  `challenges` (the icon of each profile challenge, named by its key), `damage-types` (the 13 damage-type symbols, in
  colour), `intrinsics` (the nine Railjack and Drifter intrinsic classes, drawn as masks). Each folder has a
  `SOURCES.md` (origin, licence, date and size of every file) and an `origin.json` (source of every file for the
  manifest).
- **Rights:** the images are © Digital Extremes. They come from the WARFRAME Wiki (content CC BY-NC-SA 3.0) and from
  [WFCD/genesis-assets](https://github.com/WFCD/genesis-assets) (Apache-2.0 for the collection, the licence text lies in
  each folder that uses it). The challenge icons are textures from the game files, unpacked and served by
  [browse.wf](https://browse.wf) at the paths listed in
  [warframe-public-export-plus](https://github.com/calamity-inc/warframe-public-export-plus); the MIT licence of both
  projects covers their code and data, not these images, and no licence covers the images themselves. Two white sigils in
  `game-glyphs` are copies from Digital Extremes' Public Export, kept here because the app draws them as masks. Whether
  an app may ship them is an open question that TennoDock settles before its release; the folders may change or be
  removed until then.
- **Updated:** by hand, when TennoDock needs a new part. There is no schedule.
- TennoDock is not affiliated with Digital Extremes or WFCD.

### Format (version 1)

`assets/v1/manifest.json`:

```json
{
  "format": "tennodock-assets",
  "v": 1,
  "asOf": "2026-11-06",
  "sources": { "wiki": "WARFRAME Wiki …", "genesis-assets": "WFCD/genesis-assets …" },
  "families": {
    "mod-frames": {
      "pack": "packs/mod-frames.json",
      "sha256": "07286c59…",
      "bytes": 650045,
      "files": {
        "GoldFrameTop": { "file": "mod-frames/GoldFrameTop.webp", "sha256": "…", "bytes": 2662, "w": 281, "h": 117, "src": "wiki" }
      }
    }
  }
}
```

- `asOf`: the day of the last change to any family. A rebuild without a change keeps it.
- `pack`: one file per family with every image as a data URL: `{ "format": "tennodock-asset-pack", "v": 1, "family": …,
  "parts": { "GoldFrameTop": "data:image/webp;base64,…" } }`. `sha256` and `bytes` are those of the pack file; TennoDock
  downloads a pack only when its hash changes and checks the hash before it uses the pack.
- `files`: every image with hash, size, width and height in pixels and its source (`src`, a key of `sources`).
- An incompatible change gets a new folder (`assets/v2/`).

### Other files

- `assets-file/`: the script (Node 20 or newer, no dependencies) and its tests: `node --test "assets-file/**/*.test.mjs"`.
  After adding or changing an image (and its line in `SOURCES.md`), run `node assets-file/build.mjs` and commit the
  packs and the manifest with it.
- `.github/workflows/assets.yml`: runs the tests and `node assets-file/build.mjs --check` on every push that touches the
  assets. It commits nothing.

## Creator glyph codes

`glyph-codes/v1/codes.json` holds the promo codes of creator glyphs: for every glyph its code, its name if it differs
from the code, and its image on the wiki. TennoDock shows the code on the sheet of a glyph the player does not have yet,
with a button to copy it and a link to redeem it on warframe.com.

- **Source:** the [WARFRAME Wiki](https://wiki.warframe.com/w/Glyph#Creator_Glyphs), page *Glyph*, section
  *Creator Glyphs* (template `GlyphBoxPromo`). The wiki says the list is incomplete; codes can change or stop working.
- **License:** the wiki content is licensed under
  [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). This file is an extract of it under the same
  license; the file names its source page, the revision it was built from and the license.
- **Updated:** once a week, on Mondays at about 06:29 UTC. A new file is written only when the list or the revision of
  the page changed (same file, same ETag, no new download in the app).
- TennoDock is not affiliated with Digital Extremes or the WARFRAME Wiki.

### Format (version 1)

```json
{
  "format": "tennodock-glyph-codes",
  "v": 1,
  "asOf": "2026-10-22",
  "revisedAt": "2026-10-22T18:20:30Z",
  "generatedAt": "2026-11-09T06:29:12Z",
  "source": "wiki.warframe.com",
  "page": "https://wiki.warframe.com/w/Glyph#Creator_Glyphs",
  "revision": 2820835,
  "license": "CC BY-NC-SA 3.0",
  "codes": [
    { "code": "ExampleCreator", "image": "ExampleCreatorGlyph.png" },
    { "code": "EXAMPLECODE", "image": "ExampleGlyphW2.png", "name": "Example Name" }
  ]
}
```

- `asOf` and `revisedAt`: day and time of the revision of the wiki page the file was built from (`revision`).
- `codes`: in the order of the wiki, each code once (compared without case). `code` is what the player types in;
  `name` is only there if the wiki shows a name that differs from the code; `image` is the file name on the wiki.
- Entries the script cannot read as a code (empty, with spaces) are left out. A run that reads fewer than 50 codes, or
  fewer than half of the codes before, fails and keeps the file as it was.
- An incompatible change gets a new folder (`glyph-codes/v2/`).

### Other files

- `glyph-codes-file/`: the script (Node 20 or newer, no dependencies) and its tests:
  `node --test "glyph-codes-file/**/*.test.mjs"`. Run it locally with `node glyph-codes-file/build.mjs`.
- `.github/workflows/glyph-codes.yml`: the weekly workflow. Run it by hand under *Actions › Glyph codes › Run workflow*.

## Promo codes

`promo-codes/v1/codes.json` holds the active promo codes for WARFRAME: for every code the occasion, the dates if known,
the day it first showed up in the list and its rewards, matched to items of the game where possible. TennoDock shows the
codes on its Checklist page and under *Ready now*, with a button to copy a code and a link to redeem it on
warframe.com, and can notify the player when a new code shows up. The app checks the file at most every 12 hours.

- **Source:** the [WARFRAME Wiki](https://wiki.warframe.com/w/Promo_Codes), page *Promo Codes*, table *Active Codes*.
  The table *Inactive Codes* is only used to check that the page is complete. The wiki says the list is incomplete;
  codes can expire or stop working at any time. Creator glyph codes are in `glyph-codes/` instead.
- **Item names:** the English names of the game's public export by Digital Extremes (`index_en.txt.lzma` from
  content.warframe.com, or from origin.warframe.com if that fails, unpacked with `xz`, and the export files from
  content.warframe.com), the same source as the item images in the app. origin.warframe.com refused the GitHub runner
  (HTTP 403); content.warframe.com serves the same index. They are loaded only when a reward is new. If the public export cannot be read, the names of
  [warframe-public-export-plus](https://github.com/calamity-inc/warframe-public-export-plus) (export files and
  `dict.en`) are used instead; that repository can lag behind new game updates. If neither can be read, the file is
  still written and the names are matched on a later run. A reward without a match keeps its text from the wiki.
- **License:** the wiki content is licensed under
  [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). This file is an extract of it under the same
  license; the file names its source page, the revision it was built from and the license.
- **Updated:** every 6 hours (01:11, 07:11, 13:11 and 19:11 UTC). A new file is written only when the content changed,
  that is the list or the revision of the wiki page (same file, same ETag, no new download in the app). On Wednesdays,
  rewards without an item are matched again, but only if the index of the public export changed since the last match
  (`namesIndex`).
- TennoDock is not affiliated with Digital Extremes or the WARFRAME Wiki.

### Format (version 1)

```json
{
  "format": "tennodock-promo-codes",
  "v": 1,
  "asOf": "2026-11-02",
  "revisedAt": "2026-11-02T18:28:15Z",
  "generatedAt": "2026-11-06T07:11:04Z",
  "source": "wiki.warframe.com",
  "page": "https://wiki.warframe.com/w/Promo_Codes",
  "revision": 2822826,
  "license": "CC BY-NC-SA 3.0",
  "namesIndex": "e6c0051daa63817a",
  "codes": [
    {
      "code": "EXAMPLE2026",
      "context": "Example event 2026",
      "from": "2026-11-02",
      "until": "2026-11-16",
      "firstSeen": "2026-11-02",
      "rewards": [
        { "text": "3 Day Affinity Booster", "path": "/Lotus/Types/StoreItems/Boosters/AffinityBooster3DayStoreItem" },
        { "text": "One-time 20% Platinum discount" }
      ]
    }
  ],
  "removed": [{ "code": "OLDCODE", "firstSeen": "2026-10-01", "removedOn": "2026-11-05" }]
}
```

- `asOf` and `revisedAt`: day and time of the revision of the wiki page the file was built from (`revision`).
- `codes`: only active codes, in the order of the wiki, each code once (compared without case), at most 40. Codes whose
  end date has passed are left out, even if the wiki still lists them as active. Words such as "None" or "TBA" in the
  code column are never a code; a row with only such a word, or with no code and no reward, is skipped. A row whose code
  column describes a code instead of naming one (text with spaces or brackets, such as `DUVIRI-(Warframe name)`) is
  skipped with a warning in the run's log, as is a row whose rewards cannot be read (for example only an unknown
  template). Occasions and rewards are cut at 120 characters, at most 20 rewards per code.
- `from` and `until`: first and last day (UTC) from the column *Dates Active*, only from a clear range such as
  `2026-07-01 to 2027-05-31`. A single date is left out: on the wiki it is sometimes the start, sometimes the end. A
  range that ends before it starts is left out as well. A code whose start lies ahead is listed; the app shows it as
  coming up and announces it on its first day.
- `firstSeen`: the day the workflow first saw the code in the table. Codes that were already there on the first run get
  their start date, or no value if it is unknown.
- `removed`: codes that left the table, with their `firstSeen` if they had one, kept for 30 days after `removedOn`. If
  such a code comes back (for example after a revert), it keeps its old `firstSeen` (or none) and the app does not
  announce it again. The app ignores this list.
- `rewards[].text`: the reward as written on the wiki (English). `rewards[].path`: the item in the game, if its English
  name matches; the app then shows the name in its own language and the image from the game's public export.
- `namesIndex`: a short hash of the public export's index entries the item names came from. The workflow uses it to
  skip the download when nothing changed; the app ignores it.
- A run fails and keeps the file as it was if a section, its table or a known column is missing; if the table of
  inactive codes has fewer than 20 rows (a blanked page); if an active row lists rewards but its code column cannot be
  read (for example a code inside a template, or a single word that is not a valid code); if there are more than 40 active codes; or if at least 3 codes, and more
  than half of them, leave the active table at once without having reached their end date and without showing up under
  *Inactive Codes* (a damaged table rather than a clean-up). An empty list of active codes is allowed.
- An incompatible change gets a new folder (`promo-codes/v2/`).

### Other files

- `promo-codes-file/`: the script (Node 20 or newer and `xz`, no npm dependencies) and its tests:
  `node --test "promo-codes-file/**/*.test.mjs"`. Run it locally with `node promo-codes-file/build.mjs`;
  `REBUILD=1` also matches rewards without an item again. It shares the wiki helpers in `glyph-codes-file/`.
- `.github/workflows/promo-codes.yml`: the workflow. Run it by hand under *Actions › Promo codes › Run workflow*.

## Built-in polarities

`polarities/v1/polarities.json` holds the polarities that Warframes, weapons and companions have from the start: on
their mod slots, the Aura slot, the Exilus slot and the Stance slot. TennoDock shows them next to the polarities the
player set with Forma.

- **Source:** [WFCD/warframe-items](https://github.com/WFCD/warframe-items) (`data/json/`, values from the WARFRAME
  Wiki). Each file names the commit it was built from (`commit`, `asOf`).
- **License:** MIT (WFCD/warframe-items). WFCD takes the values from the WARFRAME Wiki, whose content is licensed
  CC BY-NC-SA 3.0; whether that covers plain game facts like polarities is an open question that TennoDock settles before
  its release.
- **Mod slot positions (`pm`):** no open source says which mod slot a built-in polarity sits on. Positions are kept by
  hand in `polarity-file/positions.json`, one entry per item with its source and date, and merged as `pm` while they still
  match the WFCD list. The file is empty for now; an item without `pm` keeps `p` as a list. See *Mod slot positions* below.
- **Updated:** the workflow checks the source once a week (Monday, about 06:29 UTC) and writes the file only when the
  polarities changed.
- TennoDock is not affiliated with Digital Extremes or WFCD.

### Format (version 1)

```json
{
  "format": "tennodock-polarities",
  "v": 1,
  "asOf": "2026-11-06",
  "generatedAt": "2026-11-06T06:29:12Z",
  "source": "WFCD/warframe-items",
  "commit": "…",
  "license": "MIT",
  "items": {
    "/Lotus/Powersuits/Volt/Volt": { "p": ["AP_TACTIC", "AP_ATTACK"], "a": "AP_ATTACK" },
    "/Lotus/Weapons/Tenno/Rifle/BratonPrime": { "x": "AP_TACTIC" }
  }
}
```

- `items`: game path → `p` built-in polarities of the mod slots (order as on the wiki), `pm` the mod slot of each entry of
  `p` in the same order (only when known), `a` Aura slot (a list for frames with two Aura slots), `x` Exilus slot, `s`
  Stance slot. A missing key means no built-in polarity (or, for `pm`, unknown positions).
- Mod slots count like the game data: the highest slot is top left of the in-game mod grid, slot 0 bottom right (for 8 slots:
  top row 7 6 5 4, bottom row 3 2 1 0).
- `positionSources`: the sources of the `pm` values in this file, only when there are any.
- Polarities use the names of the game data: `AP_ATTACK` (Madurai), `AP_DEFENSE` (Vazarin), `AP_TACTIC` (Naramon),
  `AP_POWER` (Zenurik), `AP_WARD` (Unairu), `AP_PRECEPT` (Penjaga), `AP_UMBRA`, `AP_ANY` (universal, Aura or Omni Forma).

### Mod slot positions

`polarity-file/positions.json` is edited by hand, never fetched by the workflow:

```json
{
  "format": "tennodock-polarity-positions",
  "v": 1,
  "items": {
    "/Lotus/Powersuits/Example/Example": { "p": ["AP_TACTIC", "AP_ATTACK"], "pm": [7, 0], "source": "…", "date": "2026-11-08", "note": "…" }
  }
}
```

- `p` is the WFCD list the positions belong to. If WFCD later changes the list of an item (rework), its positions are left
  out and the workflow log names the item.
- `source`, `date` and `note` say where a position comes from. Data from a third party is only added with its permission;
  the source and the terms are named here before such entries are published.

### Other files

- `polarity-file/`: the script (Node 20 or newer, no dependencies) and its tests:
  `node --test "polarity-file/**/*.test.mjs"`. Run it locally with `node polarity-file/build.mjs`; `REBUILD=1` rebuilds
  without a new commit. A file whose content did not change is not written again.
- `.github/workflows/polarities.yml`: the weekly workflow. Run it by hand under *Actions › Polarities › Run workflow*.

## Item sources

`sources/v1/` holds where to find items that the game data does not tell: the place of every lore fragment, Somachord
song and Frame Fighter fragment (`collectibles.json`), how to get Captura scenes, Sigils, Syandanas and Ephemeras and the
names of some vendors (`items.json`), and the items of these kinds that still have no source (`missing.json`). TennoDock
shows them on the item sheet and in its Collectibles page, next to what it reads from the game data itself.

- **Source:** the [WARFRAME Wiki](https://wiki.warframe.com): the pages *Fragments/…*, *Somachord/Tones*,
  *Frame Fighter*, *Captura*, *Syandana*, *Ephemera*, *Sigils* (only for Sigils the module leaves without a source),
  *Decorations/Orbiter Decorations* (Prex cards) and the modules *Sigils/data* and *Vendors/data*, all in one request
  to the MediaWiki API per run. Game paths and English names come from Digital Extremes' public export (fallback:
  [warframe-public-export-plus](https://github.com/calamity-inc/warframe-public-export-plus), MIT), the lists of
  fragments from public-export-plus (`ExportCodex`, names from `dict.en`), vendor manifests from its `ExportVendors`.
- **What counts as missing:** an item of these kinds with no entry in the two wiki files and no source that TennoDock
  reads from the game data itself (`sources-file/lib/covered.mjs`, the same rules as the app): sold in the Market or in
  a Market bundle, sold by a vendor or syndicate, a standard item, unlocked with another item, not available on PC,
  in a Supporter Pack, replaced by a newer version, or a rule by name or path (Prime Access, Twitch, TennoCon, clan and
  alliance sigils). For this, the build also reads `ExportCustoms`, `ExportResources`, `ExportBundles` and
  `ExportSyndicates` from public-export-plus.
- **License:** the wiki content is licensed under
  [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). `collectibles.json` and `items.json` are
  extracts of it under the same license; both files name their source and license. `missing.json` holds only game paths
  and names. Details per file: `sources/v1/SOURCES.md`.
- **Updated:** once a week, on Tuesdays at about 06:37 UTC. A file is written only when its content changed.
- **Switch:** `SOURCES_WIKI: 'off'` in `.github/workflows/sources.yml` stops all requests to the wiki; the two wiki files
  stay as they are and `missing.json` is still checked against the public export. `SOURCES_ISSUE: 'on'` opens an issue on
  the first run of a month with the items that have had no source since the previous month (off by default).
- TennoDock is not affiliated with Digital Extremes or the WARFRAME Wiki.

### Format (version 1)

```json
{
  "format": "tennodock-sources-collectibles",
  "v": 1,
  "asOf": "2026-10-29",
  "generatedAt": "2026-11-10T06:37:12Z",
  "source": "wiki.warframe.com",
  "license": "CC BY-NC-SA 3.0",
  "fragments": { "/Lotus/Types/Lore/Fragments/EarthFragmentA": "Earth" },
  "songs": { "/Lotus/Types/Lore/Fragments/MusicFragments/ArchwingSongFragment": { "place": "Neptune" } },
  "fighters": { "/Lotus/Types/Lore/Fragments/FrameFighterFragments/AshFighterFragment": "Uranus" }
}
```

```json
{
  "format": "tennodock-sources-items",
  "v": 1,
  "asOf": "2026-10-29",
  "generatedAt": "2026-11-10T06:37:12Z",
  "source": "wiki.warframe.com",
  "license": "CC BY-NC-SA 3.0",
  "items": {
    "/Lotus/Types/Items/MiscItems/PhotoboothTileCetusTown": [{ "k": "syndicate", "t": "Purchased from Ostron offerings (Rank 5: Kin)" }]
  },
  "vendors": { "Deimos/OtakLastWishManifest": "Otak" }
}
```

- `asOf`: day of the newest revision among the wiki pages. Places and texts are English, as on the wiki.
- `fragments`, `fighters`: game path → place. `songs`: game path → `place` (where the fragment is), `vendor` (who sells
  the song) and/or `how` (another way, e.g. a quest).
- `items`: game path → list of sources, each with a rough kind `k` (`market`, `baro`, `varzia`, `primeAccess`, `event`,
  `syndicate`, `vendor`, `nightwave`, `quest`, `drop`, `tribute`, `reward`, `default`, `unavailable`, `other`) and the
  text `t` from the wiki (cut at the first sentence when longer than 160 characters).
- `vendors`: vendor manifest (without `/Lotus/Types/Game/VendorManifests/`) → name of the vendor on the wiki, when at
  least three and more than half of its items match one vendor.
- `missing.json` (`tennodock-sources-missing`): per kind (`fragments`, `songs`, `fighters`, `captura`, `sigils`,
  `syandanas`, `ephemeras`) the number of items and the list of items without an entry, each with `path`, `name` and
  `since` (the day it was first seen without one).
- A run that reads fewer than a minimum, or fewer than half of the entries before, fails and keeps the files as they were.
  If the public export delivers almost no items, or one of the four rule files from public-export-plus is missing or
  almost empty, `missing.json` stays as it is. An incompatible change gets a new folder
  (`sources/v2/`).

### Other files

- `sources-file/`: the script (Node 22 or newer, no dependencies; `xz` for the public export) and its tests:
  `node --test "sources-file/**/*.test.mjs"`. Run it locally with `node sources-file/build.mjs`.
- `.github/workflows/sources.yml`: the weekly workflow. Run it by hand under *Actions › Sources › Run workflow*.
