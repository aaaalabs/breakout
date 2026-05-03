import {
    Ball,
    Brick,
    Paddle,
    GameState,
    ARENA_W,
    ARENA_H,
    BALL_RADIUS,
    BALL_INITIAL_SPEED,
    BALL_SPEED_INCREMENT_PER_HIT,
    BALL_SPEED_HITS_TO_RAMP,
    BALL_MAX_SPEED,
    BRICK_W,
    BRICK_H,
    PADDLE_W,
    PADDLE_H,
    PADDLE_MAX_DEFLECT_ANGLE,
    type PlayerSlot,
} from '@breakout/shared';

export interface SimEvent {
    kind: 'brickBreak' | 'paddleHit' | 'wallHit';
    slot?: PlayerSlot;
    side?: 'left' | 'right' | 'top' | 'bottom';
    intensity?: number;
    x?: number;
    y?: number;
}

export interface SimResult {
    events: SimEvent[];
    scoredAgainst: PlayerSlot | null; // null if still in play
}

const SUBSTEPS = 4; // sub-step collision check to avoid tunneling at high speed

export function stepBall(state: GameState, dt: number): SimResult {
    const events: SimEvent[] = [];
    let scoredAgainst: PlayerSlot | null = null;

    const subDt = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) {
        const r = stepBallOnce(state, subDt, events);
        if (r) {
            scoredAgainst = r;
            break;
        }
    }

    return { events, scoredAgainst };
}

function stepBallOnce(state: GameState, dt: number, events: SimEvent[]): PlayerSlot | null {
    const ball = state.ball;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Side walls
    if (ball.x - BALL_RADIUS < 0) {
        ball.x = BALL_RADIUS;
        ball.vx = Math.abs(ball.vx);
        events.push({ kind: 'wallHit', side: 'left', x: 0, y: ball.y });
    } else if (ball.x + BALL_RADIUS > ARENA_W) {
        ball.x = ARENA_W - BALL_RADIUS;
        ball.vx = -Math.abs(ball.vx);
        events.push({ kind: 'wallHit', side: 'right', x: ARENA_W, y: ball.y });
    }

    // Top/bottom — scoring zones
    if (ball.y - BALL_RADIUS < 0) {
        return 'p1'; // P1 (top) was scored against
    }
    if (ball.y + BALL_RADIUS > ARENA_H) {
        return 'p2';
    }

    // Paddles
    if (handlePaddle(ball, state.paddleP1, 'p1', events)) {
        ball.vy = Math.abs(ball.vy);
    }
    if (handlePaddle(ball, state.paddleP2, 'p2', events)) {
        ball.vy = -Math.abs(ball.vy);
    }

    // Bricks
    handleBrickCollisions(ball, state.bricksP1, 'p1', events, state);
    handleBrickCollisions(ball, state.bricksP2, 'p2', events, state);

    return null;
}

function handlePaddle(
    ball: Ball,
    paddle: Paddle,
    slot: PlayerSlot,
    events: SimEvent[]
): boolean {
    const halfW = PADDLE_W / 2;
    const halfH = PADDLE_H / 2;
    const dx = ball.x - paddle.x;
    const dy = ball.y - paddle.y;

    if (Math.abs(dx) > halfW + BALL_RADIUS) return false;
    if (Math.abs(dy) > halfH + BALL_RADIUS) return false;

    // Direction check — only collide if ball is moving toward paddle
    if (slot === 'p1' && ball.vy >= 0) return false;
    if (slot === 'p2' && ball.vy <= 0) return false;

    // Compute deflection based on contact point along paddle
    const contact = Math.max(-1, Math.min(1, dx / halfW)); // -1 .. +1
    const angle = contact * PADDLE_MAX_DEFLECT_ANGLE;
    const speed = Math.hypot(ball.vx, ball.vy);
    ball.vx = Math.sin(angle) * speed;
    // vy sign set by caller

    // Push ball out so it doesn't get stuck overlapping
    if (slot === 'p1') {
        ball.y = paddle.y + halfH + BALL_RADIUS + 0.5;
    } else {
        ball.y = paddle.y - halfH - BALL_RADIUS - 0.5;
    }

    events.push({ kind: 'paddleHit', slot, intensity: Math.abs(contact) });
    return true;
}

function handleBrickCollisions(
    ball: Ball,
    bricks: { forEach: (cb: (b: Brick, i: number) => void) => void },
    slot: PlayerSlot,
    events: SimEvent[],
    state: GameState
): void {
    bricks.forEach((brick) => {
        if (!brick.alive) return;
        const dx = ball.x - brick.x;
        const dy = ball.y - brick.y;
        const halfW = BRICK_W / 2;
        const halfH = BRICK_H / 2;
        if (Math.abs(dx) > halfW + BALL_RADIUS) return;
        if (Math.abs(dy) > halfH + BALL_RADIUS) return;

        // Determine hit side by overlap depth — bounce off the shallower axis
        const overlapX = halfW + BALL_RADIUS - Math.abs(dx);
        const overlapY = halfH + BALL_RADIUS - Math.abs(dy);

        if (overlapX < overlapY) {
            ball.vx = dx > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx);
            ball.x += dx > 0 ? overlapX : -overlapX;
        } else {
            ball.vy = dy > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy);
            ball.y += dy > 0 ? overlapY : -overlapY;
        }

        // Multi-hit: decrement HP. Only destroy when HP reaches 0.
        brick.hp = Math.max(0, brick.hp - 1);
        if (brick.hp > 0) {
            // Keep brick alive, but emit hit event so client can play 'thunk' SFX + flash
            events.push({ kind: 'wallHit', side: 'top', x: brick.x, y: brick.y });
            return;
        }

        brick.alive = 0;
        if (slot === 'p1') state.aliveCountP1--;
        else state.aliveCountP2--;

        events.push({ kind: 'brickBreak', slot, x: brick.x, y: brick.y });

        // Speed ramp
        const totalKilled =
            (state.bricksP1.length - state.aliveCountP1) +
            (state.bricksP2.length - state.aliveCountP2);
        const newTier = Math.floor(totalKilled / BALL_SPEED_HITS_TO_RAMP);
        if (newTier > state.ballSpeedTier) {
            state.ballSpeedTier = newTier;
            const targetSpeed = Math.min(
                BALL_MAX_SPEED,
                BALL_INITIAL_SPEED * Math.pow(BALL_SPEED_INCREMENT_PER_HIT, newTier)
            );
            const cur = Math.hypot(ball.vx, ball.vy);
            if (cur > 0) {
                const k = targetSpeed / cur;
                ball.vx *= k;
                ball.vy *= k;
            }
        }
    });
}

export function resetBall(state: GameState, towardSlot: PlayerSlot): void {
    // Always respawn at INITIAL speed — the previous round's velocity should not
    // carry over. Speed tier is preserved so subsequent brick hits continue ramping
    // from where they left off (just from a calm reset, not a flying-cannon reset).
    state.ball.x = ARENA_W / 2;
    state.ball.y = ARENA_H / 2;
    const angle = (Math.random() - 0.5) * 0.6; // ±0.3 rad
    state.ball.vx = Math.sin(angle) * BALL_INITIAL_SPEED;
    state.ball.vy = Math.cos(angle) * BALL_INITIAL_SPEED * (towardSlot === 'p1' ? -1 : 1);
}
