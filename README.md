# TennoDock data

Public data files for [TennoDock](https://github.com/nxtdxve), a Warframe companion app for Overwolf. The app downloads
them once a day; nothing in this repository is personal data.

## Market prices

`prices/v1/prices.json` holds a usual platinum price for every tradable item that sold in the last 14 days.

- **What the price is:** the median of the daily median prices of completed trades over the last 14 days (UTC), weighted
  by the number of items sold. If the median sell offer of the newest day is lower, that offer is used instead.
  Mods and arcanes have a price per rank, relics per refinement, Ayatan sculptures per number of stars.
- **Source:** the daily statistics files of [relics.run](https://relics.run/history/), which come from
  [warframe.market](https://warframe.market). If relics.run has no new file for two days, the workflow falls back to
  warframe.market itself (the daily list of Prime prices).
- **Updated:** every day at about 04:20 UTC, for the previous day. A second run at 10:20 UTC catches a late or failed run.
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
  Run it locally with `node price-file/build.mjs`; `REBUILD=1` rebuilds the file without a new day.
- `.github/workflows/prices.yml`: the daily workflow. Run it by hand under *Actions › Prices › Run workflow*.
