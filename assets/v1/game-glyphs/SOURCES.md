# Game glyphs (sources)

One-colour menu glyphs of the game (Arsenal categories, blueprint, prime parts, quest, gift …) for TennoDock (#138).
TennoDock draws them as a mask in the text colour (`mask-image`), so only the alpha channel matters and they follow light
and dark mode. File name = key in `src/core/ui/game-glyphs.ts`.

**Rights:** The images are © Digital Extremes (Warframe). Whether TennoDock may ship them in a published app is an open legal question for TennoDock's release phase (phase 9). They are used here for informative purposes only; TennoDock is not affiliated with Digital Extremes. The collection WFCD/genesis-assets is licensed Apache-2.0.

**Fetched** on 2026-11-06 from WFCD/genesis-assets, commit `730ff1a9211b249b3774dd7cc75fe353fd0b792a`, scaled with Lanczos and saved as lossless WebP.
`quest.webp`: alpha × 3, because the original has a soft glow that makes the mask too faint.
That the glyphs are the game's own menu graphics is derived from their file names (e.g. `QuestPickerActive`, `OwnedBlueprint`) and their look; genesis-assets does not document the origin of each file.

| File | Used for | Source in genesis-assets | Original | Here |
|---|---|---|---|---|
| warframe.webp | Category Warframes | `webp/menu/Warframe.webp` | 256×256 px, 4.8 KB | 96×96 px, 2.3 KB |
| primary.webp | Category Primary | `webp/menu/Rifle.webp` | 256×256 px, 1.9 KB | 96×96 px, 1.5 KB |
| secondary.webp | Category Secondary | `webp/menu/Pistol.webp` | 256×256 px, 3.6 KB | 96×96 px, 1.9 KB |
| melee.webp | Category Melee | `webp/menu/Melee.webp` | 256×256 px, 4.2 KB | 96×96 px, 2.1 KB |
| weapons.webp | Category Weapons (all) | `webp/menu/Weapons.webp` | 256×256 px, 5.1 KB | 96×96 px, 2.4 KB |
| companion.webp | Category Companions; source "comes with a companion" | `webp/menu/Kubrow.webp` | 256×256 px, 2.7 KB | 96×96 px, 1.5 KB |
| archwing.webp | Category Archwing / vehicles | `webp/menu/Archwing.webp` | 256×256 px, 6.8 KB | 96×96 px, 3.0 KB |
| modular.webp | Category Modular (kitguns, zaws, amps) | `webp/menu/ModularItem.webp` | 512×512 px, 2.3 KB | 96×96 px, 1.0 KB |
| operator.webp | Category Operator (outfits) | `webp/menu/Operator.webp` | 256×256 px, 1.4 KB | 96×96 px, 1.2 KB |
| gear.webp | Category Consumables / gear | `webp/menu/Gear.webp` | 256×256 px, 3.4 KB | 96×96 px, 2.3 KB |
| other.webp | Category Other | `webp/menu/Misc.webp` | 256×256 px, 3.3 KB | 96×96 px, 2.1 KB |
| blueprint.webp | Blueprint (recipe, blueprint missing) | `webp/menu/Blueprint.webp` | 256×256 px, 2.7 KB | 96×96 px, 2.1 KB |
| blueprint-owned.webp | Blueprint owned ("Have blueprint") | `webp/menu/OwnedBlueprint.webp` | 256×256 px, 5.1 KB | 96×96 px, 2.8 KB |
| prime-parts.webp | Prime parts (part needed, sets) | `webp/menu/PrimeParts.webp` | 256×256 px, 3.7 KB | 96×96 px, 2.2 KB |
| quest.webp | Quests (collectibles tile, source "quest") | `webp/menu/QuestPickerActive.webp` | 512×512 px, 93.2 KB | 128×128 px, 7.5 KB |
| vendor.webp | Source "vendor" | `webp/menu/Purchase.webp` | 256×256 px, 1.1 KB | 96×96 px, 0.8 KB |
| event.webp | Source "event" | `webp/menu/LimitedTime.webp` | 256×256 px, 3.7 KB | 96×96 px, 3.1 KB |
| tribute.webp | Source "daily tribute"; page Daily Tribute | `webp/menu/Gift.webp` | 256×256 px, 2.4 KB | 96×96 px, 1.7 KB |
| syndicate.webp | Source "syndicate" | `img/syndicate.png` | 40×42 px, 6.7 KB | 40×42 px, 0.9 KB |
| standing.webp | Standing (syndicates) | `webp/general/standing.webp` | 128×128 px, 3.2 KB | 96×96 px, 2.7 KB |
