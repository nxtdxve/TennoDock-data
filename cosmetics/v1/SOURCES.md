# Sources of cosmetics/v1

- `availability.json` and `unknown.json` are built every week by `cosmetics-file/build.mjs` (workflow `cosmetics.yml`).
- Game data: [warframe-public-export-plus](https://github.com/calamity-inc/warframe-public-export-plus) (MIT), files
  `ExportCustoms`, `ExportFlavour`, `ExportResources`, `ExportBundles`, `ExportVendors`, `ExportSyndicates`,
  `ExportChallenges`, `ExportEmailItems` and `dict.en` (English names and descriptions by Digital Extremes).
- States come from fixed patterns over these files (`cosmetics-file/lib/rules.mjs`) and from entries made by hand
  (`cosmetics-file/exceptions.json`, each with a note, a source link and the day it was checked).
- No content from the WARFRAME Wiki. TennoDock is not affiliated with Digital Extremes.
