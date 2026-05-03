# Fantasy Brick Sprite Sheet — Image-Gen Prompt

Goal: replace the procedurally-rendered colored rectangles with hand-illustrated **fantasy-style brick sprites** for normal + special types. Use chroma-key green background so transparency masking works downstream.

---

## In-game brick dimensions (the source of truth)

```
BRICK_W   = 62.33 px  (≈ 62)
BRICK_H   = 22 px
ASPECT    = 62 : 22  ≈  31 : 11  ≈  2.83 : 1
```

For sprite generation, render at **8× scale** so downscaling to game resolution is sharp:

```
SPRITE_W  = 496 px   (8 × 62)
SPRITE_H  = 176 px   (8 × 22)
ASPECT    = exactly 2.818 : 1   (must be respected EXACTLY)
```

If your image-gen tool can only do square outputs, **request 512×512 with the brick centered, surrounded by green background**, then crop in Photoshop.

---

## Chroma-key requirement

Background must be **pure green `#00FF00`** (RGB `0, 255, 0`) — no anti-aliased fade, no off-shades, no shadows on the green. The brick edges should sit cleanly on solid green so the chroma-key shader / Photoshop "Magic Wand" tolerance can pull it perfectly.

After download, in Photoshop / Affinity / GIMP:
1. Magic Wand on green with tolerance ~10
2. Refine Edge → Decontaminate Colors (kills green halos)
3. Export as PNG with transparent background

---

## The 8 brick types to generate

Generate as a **single 4×2 sprite sheet**, total dimensions **1984 × 352 px** (4 cols × 496 wide, 2 rows × 176 tall, no gaps).

Layout grid (row × column):

```
[ 1 stone-cyan   ] [ 2 stone-magenta ] [ 3 iron-block   ] [ 4 gift-box     ]
[ 5 diamond-gem  ] [ 6 bomb-fuse     ] [ 7 skull-cursed ] [ 8 heart-glow   ]
```

Each cell is exactly 496 × 176 px. Bricks fill ~90% of cell width and ~85% of cell height (leaving narrow green margin so the chroma-key has room to bleed).

---

## Master prompt (paste this into Midjourney / DALL-E / Stable Diffusion)

```
Fantasy game sprite sheet, 4 columns by 2 rows, 8 brick types arranged in a grid,
total image 1984 by 352 pixels, pure solid green chroma-key background (#00FF00,
no gradient, no shadow on background), each brick exactly 496 by 176 pixels with
2.83:1 aspect ratio (much wider than tall), no spacing between cells:

Row 1:
- Stone-cyan: medieval stone block, weathered teal-cyan glow, runic etching
- Stone-magenta: same medieval stone block, weathered magenta-pink glow, runic etching
- Iron-block: heavy gray riveted iron plate with bolts at corners, industrial
- Gift-box: wrapped fantasy gift box, golden ribbon bow, glowing yellow seams,
  shaped like a brick (wider than tall, NOT a cube)

Row 2:
- Diamond-gem: large purple-violet faceted gem set in a stone frame, sparkle highlights
- Bomb-fuse: round black cartoon bomb embedded in stone frame, lit fuse with spark
- Skull-cursed: stone-carved animal skull set in dark ominous frame, ancient curse aura
- Heart-glow: pulsing red crystal heart in elegant brick-shaped frame, healing aura

Style: Hand-illustrated fantasy game art, painterly with crisp line work, similar
to Hearthstone or Slay the Spire card art. NOT pixel art. NOT photorealistic.
Soft inner shadows, bold rim lighting, vibrant saturated colors that read at 1/8
size when downscaled to 62 by 22 pixels.

Background: pure flat #00FF00 chroma green, NO anti-aliasing on the brick edges
that bleeds into green, NO drop shadows on the green, bricks must sit cleanly
on solid color for chroma-key extraction.

Composition: 4 columns by 2 rows grid, brick rectangles inside each cell,
~10% margin around each brick of pure green, no labels, no text, no borders
between cells.

--ar 1984:352  --quality 2  --stylize 250
```

---

## Alternative: 8 individual sprites

If your tool struggles with sprite-sheet grids, generate each brick **individually** as a 512×192 image (rounding 496×176 up to common multiples), then crop to 496×176 in Photoshop.

Per-brick prompt template:

```
{BRICK_DESCRIPTION}, fantasy game sprite, exactly 2.83:1 aspect ratio
(wider than tall), pure solid green #00FF00 chroma-key background, no
shadows on background, hand-illustrated painterly style like Hearthstone
card art, vibrant saturated colors, soft inner shadow, rim lighting,
clean edges for chroma-key extraction, 512 by 192 pixels.
```

Replace `{BRICK_DESCRIPTION}` with each of the 8 specs above.

---

## Loading into the game (Phaser code)

Once you have the cropped PNGs:

1. Drop into `client/public/assets/bricks/` (create dir if missing)
2. Update `BootScene` to preload:
   ```ts
   this.load.image('brick-cyan',    '/assets/bricks/cyan.png');
   this.load.image('brick-magenta', '/assets/bricks/magenta.png');
   this.load.image('brick-iron',    '/assets/bricks/iron.png');
   this.load.image('brick-gift',    '/assets/bricks/gift.png');
   this.load.image('brick-diamond', '/assets/bricks/diamond.png');
   this.load.image('brick-bomb',    '/assets/bricks/bomb.png');
   this.load.image('brick-skull',   '/assets/bricks/skull.png');
   this.load.image('brick-heart',   '/assets/bricks/heart.png');
   ```
3. In `SoloScene.buildBricks()` and `GameScene.buildBricksFromState()`, replace:
   ```ts
   const sprite = this.add.rectangle(x, y, BRICK_W, BRICK_H, color, 0.92);
   ```
   with:
   ```ts
   const key = this.brickSpriteKey(kind, slot);    // 'brick-cyan' / etc.
   const sprite = this.add.image(x, y, key)
       .setDisplaySize(BRICK_W, BRICK_H);          // scales 496×176 → 62×22
   ```
4. The `brickSpriteKey` helper picks the right asset based on kind + player slot
5. Particle bursts on destroy still use the procedural texture — no change
6. Build + test — bricks should render the fantasy art, ball physics + collision unchanged

---

## Expected output preview

```
Row 1: [ stone-cyan ] [ stone-magenta ] [ iron-block ] [ gift-box ]
Row 2: [ diamond-gem ] [ bomb-fuse    ] [ skull-curse ] [ heart-glow ]
```

Each tile rendered painterly fantasy, on green, 2.83:1 ratio, ready to drop into Phaser's image loader.

---

## New brick types unlocked by these sprites

The sheet introduces TWO new types not yet in code:

- **🦴 SKULL** — danger brick. When destroyed, ball gets +30% speed for 5s (cursed). Risk-reward: avoid breaking unless you're confident.
- **❤️ HEART** — solo only: when destroyed, restores 1 life. In versus: heals 4 dead bricks on your side.

Once sprites are in, I'll add these 2 types to the code (matching the patterns of bomb / gift respectively). Update `BrickKind` union, distribution weights, and effect handlers.
