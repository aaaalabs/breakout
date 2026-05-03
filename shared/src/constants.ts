// Game-world geometry. All units in pixels of the design-space.
// Both client (rendering) and server (simulation) import these.

export const ARENA_W = 800;
export const ARENA_H = 1000;

export const PADDLE_W = 110;
export const PADDLE_H = 14;
// 80px thumb zone (top + bottom) so finger control on mobile doesn't cover the paddle.
// Symmetric so Versus both players have breathing room on their own phone.
export const THUMB_ZONE = 80;
export const PADDLE_OFFSET_FROM_WALL = THUMB_ZONE + 36;

// Top paddle Y (player 1) and bottom paddle Y (player 2)
export const PADDLE_Y = {
    p1: PADDLE_OFFSET_FROM_WALL + PADDLE_H / 2,
    p2: ARENA_H - PADDLE_OFFSET_FROM_WALL - PADDLE_H / 2,
} as const;

// Brick grid
export const BRICK_COLS = 12;
export const BRICK_ROWS_PER_PLAYER = 4;
export const BRICK_GAP = 4;
export const BRICK_W = (ARENA_W - BRICK_GAP * (BRICK_COLS + 1)) / BRICK_COLS;
export const BRICK_H = 22;

// Vertical placement of brick bands
export const BRICK_BAND_GAP_FROM_CENTER = 64; // gap between two bands
export const BRICK_BAND_HEIGHT = BRICK_ROWS_PER_PLAYER * (BRICK_H + BRICK_GAP) - BRICK_GAP;
// P1 bricks: above center (top half of middle band)
export const BRICK_BAND_Y = {
    p1: ARENA_H / 2 - BRICK_BAND_GAP_FROM_CENTER / 2 - BRICK_BAND_HEIGHT,
    p2: ARENA_H / 2 + BRICK_BAND_GAP_FROM_CENTER / 2,
} as const;

// Ball
export const BALL_RADIUS = 9;
export const BALL_INITIAL_SPEED = 420; // px/s
export const BALL_SPEED_INCREMENT_PER_HIT = 1.04; // multiplied every BALL_SPEED_HITS_TO_RAMP brick hits
export const BALL_SPEED_HITS_TO_RAMP = 6;
export const BALL_MAX_SPEED = 1100;

// Paddle hit-angle: contact point on paddle controls deflection angle (Pong style)
export const PADDLE_MAX_DEFLECT_ANGLE = (Math.PI / 180) * 70; // 70 deg from straight

// Server tick + broadcast.
// Higher patch rate = smoother ball motion on client (less interpolation jank);
// trade-off is ~50% more bandwidth (~10 KB/s/player → ~15 KB/s/player). Trivial.
export const SERVER_TICK_HZ = 60;
export const SERVER_PATCH_HZ = 30;

// Match timing
export const COUNTDOWN_SECONDS = 3;
export const MATCH_TIMEOUT_SECONDS = 300; // 5 min soft cap

// Player roles
export type PlayerSlot = 'p1' | 'p2';

// Color palette (also used by client renderer)
export const COLORS = {
    bg: 0x0a0a14,
    arena: 0x13131f,
    arenaLine: 0x23233a,
    p1: 0x00f0f0, // cyan — top
    p2: 0xff5fb8, // magenta — bottom
    p1Brick: 0x00d4d4,
    p2Brick: 0xe048a0,
    ball: 0xfafaff,
    ballTrail: 0xfafaff,
    text: 0xe8e8f4,
    dim: 0x6c6c8a,
} as const;
