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
    // Iron row: closest to opponent (back row). Adds strategic depth without
    // overwhelming a new player — frontline bricks are still single-hit.
    const ironRow = slot === 'p1' ? 0 : BRICK_ROWS_PER_PLAYER - 1;
    for (let row = 0; row < BRICK_ROWS_PER_PLAYER; row++) {
        for (let col = 0; col < BRICK_COLS; col++) {
            const b = new Brick();
            b.x = BRICK_GAP + col * (BRICK_W + BRICK_GAP) + BRICK_W / 2;
            b.y = yStart + row * (BRICK_H + BRICK_GAP) + BRICK_H / 2;
            b.alive = 1;
            // Iron bricks need 2 hits, scored same as 2 normal bricks
            if (row === ironRow) { b.hp = 2; b.maxHp = 2; }
            else { b.hp = 1; b.maxHp = 1; }
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
