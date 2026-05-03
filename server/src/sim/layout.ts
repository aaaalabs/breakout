import { ArraySchema } from '@colyseus/schema';
import {
    Brick,
    BRICK_BAND_Y,
    BRICK_COLS,
    BRICK_GAP,
    BRICK_H,
    BRICK_ROWS_PER_PLAYER,
    BRICK_W,
    PADDLE_W,
    PADDLE_Y,
    ARENA_W,
    ARENA_H,
    type PlayerSlot,
} from '@breakout/shared';

export function buildBrickGrid(slot: PlayerSlot): ArraySchema<Brick> {
    const list = new ArraySchema<Brick>();
    const yStart = BRICK_BAND_Y[slot];
    const ironRow = slot === 'p1' ? 0 : BRICK_ROWS_PER_PLAYER - 1;

    // Pick 3 special-brick positions among non-iron cells per side. Distribution:
    // 40% gift / 35% diamond / 25% bomb. Same odds as Solo, fewer total to keep
    // 1v1 pace tight (specials become high-stakes events instead of constant chaos).
    const totalCells = BRICK_ROWS_PER_PLAYER * BRICK_COLS;
    const specialIndexes = new Map<number, string>();
    while (specialIndexes.size < 3) {
        const idx = Math.floor(Math.random() * totalCells);
        const row = Math.floor(idx / BRICK_COLS);
        if (row === ironRow) continue;
        if (specialIndexes.has(idx)) continue;
        const r = Math.random();
        const kind = r < 0.40 ? 'gift' : r < 0.75 ? 'diamond' : 'bomb';
        specialIndexes.set(idx, kind);
    }

    let cellIdx = 0;
    for (let row = 0; row < BRICK_ROWS_PER_PLAYER; row++) {
        for (let col = 0; col < BRICK_COLS; col++, cellIdx++) {
            const b = new Brick();
            b.x = BRICK_GAP + col * (BRICK_W + BRICK_GAP) + BRICK_W / 2;
            b.y = yStart + row * (BRICK_H + BRICK_GAP) + BRICK_H / 2;
            b.alive = 1;
            if (row === ironRow) { b.hp = 2; b.maxHp = 2; b.kind = 'iron'; }
            else if (specialIndexes.has(cellIdx)) {
                b.hp = 1; b.maxHp = 1;
                b.kind = specialIndexes.get(cellIdx)!;
            } else {
                b.hp = 1; b.maxHp = 1; b.kind = 'normal';
            }
            list.push(b);
        }
    }
    return list;
}

export function initialPaddleX(): number {
    return ARENA_W / 2;
}

export function initialBallVelocity(): { vx: number; vy: number } {
    // Ball heads toward whichever paddle was scored against (or random first time).
    // Slight horizontal randomness so opening shot isn't deterministic.
    const dirY = Math.random() < 0.5 ? -1 : 1;
    const angle = (Math.random() - 0.5) * 0.5; // ±0.25 rad
    return {
        vx: Math.sin(angle),
        vy: Math.cos(angle) * dirY,
    };
}

export function clampPaddleX(requestedX: number): number {
    const half = PADDLE_W / 2;
    return Math.max(half, Math.min(ARENA_W - half, requestedX));
}
