# Sources of `sources/v1/`

| File | Content | Source | License |
|---|---|---|---|
| `collectibles.json` | Place of every lore fragment, Somachord song and Frame Fighter fragment | WARFRAME Wiki (wiki.warframe.com): *Fragments/Cephalon*, *Fragments/Fish*, *Fragments/Glass*, *Fragments/Ghoul*, *Fragments/Revenant*, *Fragments/Solaris United*, *Fragments/Partnership*, *Fragments/The Tenets*, *Fragments/Duviri*, *Fragments/Albrecht*, *Fragments/Isleweaver*, *Somachord/Tones*, *Frame Fighter* | CC BY-NC-SA 3.0 |
| `items.json` | How to get Captura scenes, Sigils, Syandanas and Ephemeras; names of vendors | WARFRAME Wiki: *Captura*, *Syandana*, *Ephemera*, *Module:Sigils/data*, *Module:Vendors/data* | CC BY-NC-SA 3.0 |
| `missing.json` | Items of these kinds without an entry | Digital Extremes public export (game paths and names), warframe-public-export-plus `ExportCodex` and `dict.en` (MIT) | game data © Digital Extremes |

- Game paths and English names come from the public export of Digital Extremes (content.warframe.com), with
  warframe-public-export-plus as fallback; they only connect the wiki entries to the game.
- Texts are copied from the wiki without changes of meaning (markup removed, long texts cut at the first sentence).
- Built by `sources-file/build.mjs` (workflow `sources.yml`), once a week. The wiki is asked once per run.
- Warframe and all game names are © Digital Extremes. TennoDock is not affiliated with Digital Extremes or the WARFRAME Wiki.
