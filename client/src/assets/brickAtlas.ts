// Loads the fantasy bricks-sheet.png and registers it as a Phaser texture atlas
// with chroma-key transparency (pure green #00FF00 → alpha 0). Each cell becomes
// a named frame: 'brick-cyan' / 'brick-magenta' / 'brick-iron' / 'brick-gift' /
// 'brick-diamond' / 'brick-bomb' / 'brick-skull' / 'brick-heart'.
//
// Done at runtime via Canvas2D (no build-step image processing needed).

const SHEET_URL = '/assets/bricks-sheet.png';
const SHEET_KEY = 'bricks';
const COLS = 4;
const ROWS = 2;

const FRAME_NAMES: string[] = [
    // Row 1
    'cyan', 'magenta', 'iron', 'gift',
    // Row 2
    'diamond', 'bomb', 'skull', 'heart',
];

let loadPromise: Promise<void> | null = null;

export function preloadBrickAtlas(scene: Phaser.Scene): Promise<void> {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        // 1. Fetch and decode the PNG into an HTMLImageElement
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = SHEET_URL;
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = reject;
        });

        // 2. Render to a canvas, then process pixels: green → alpha 0
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            // Pure-green chroma-key match: high green, low red+blue.
            // Tolerant enough to catch anti-aliased edges that are 80% green.
            if (g > 160 && r < 120 && b < 120 && (g - r) > 60 && (g - b) > 60) {
                data[i + 3] = 0; // alpha 0
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // 3. Register the canvas as a Phaser texture
        scene.textures.addCanvas(SHEET_KEY, canvas);

        // 4. Add a frame for each grid cell using Phaser's frame-add API
        const tex = scene.textures.get(SHEET_KEY);
        const cellW = canvas.width / COLS;
        const cellH = canvas.height / ROWS;
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                const idx = row * COLS + col;
                const name = FRAME_NAMES[idx];
                tex.add(name, 0, col * cellW, row * cellH, cellW, cellH);
            }
        }
    })();
    return loadPromise;
}

export const BRICK_ATLAS_KEY = SHEET_KEY;

/** Map our schema brick.kind + slot → frame name in the atlas. */
export function brickFrame(kind: string, slot: 'p1' | 'p2'): string {
    if (kind === 'iron')    return 'iron';
    if (kind === 'gift')    return 'gift';
    if (kind === 'diamond') return 'diamond';
    if (kind === 'bomb')    return 'bomb';
    if (kind === 'skull')   return 'skull';
    if (kind === 'heart')   return 'heart';
    // normal — use player's color tint
    return slot === 'p1' ? 'cyan' : 'magenta';
}
