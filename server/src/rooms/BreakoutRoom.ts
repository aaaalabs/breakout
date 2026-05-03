import { Room, Client } from 'colyseus';
import {
    GameState,
    ARENA_W,
    ARENA_H,
    PADDLE_W,
    PADDLE_H,
    PADDLE_Y,
    SERVER_TICK_HZ,
    SERVER_PATCH_HZ,
    COUNTDOWN_SECONDS,
    MATCH_TIMEOUT_SECONDS,
    type PlayerSlot,
} from '@breakout/shared';
import { buildBrickGrid, clampPaddleX, initialPaddleX } from '../sim/layout.js';
import { resetBall, stepBall } from '../sim/physics.js';

interface JoinOptions {
    name?: string;
    private?: boolean;
}

export class BreakoutRoom extends Room<GameState> {
    maxClients = 2;
    state = new GameState();

    private tickInterval?: NodeJS.Timeout;
    private lastTickAt = 0;
    private privateRoom = false;
    private rematchVotes = new Set<string>();
    private pendingLaunch: { dir: PlayerSlot; at: number } | null = null;
    // Garbage-system bookkeeping (server-only, not synced)
    private brickKillsTotal = 0;
    private prevAliveP1 = 0;
    private prevAliveP2 = 0;
    private static GARBAGE_THRESHOLD = 7; // every N total brick kills → 1 garbage delivery

    onCreate(options: JoinOptions = {}) {
        this.privateRoom = !!options.private;
        if (this.privateRoom) {
            this.setPrivate(true);
        }
        this.setPatchRate(1000 / SERVER_PATCH_HZ);

        this.initializeState();

        this.onMessage('paddleMove', (client, msg: { x: number }) => {
            const slot = this.state.playerSlot.get(client.sessionId);
            if (!slot) return;
            const x = clampPaddleX(Number(msg.x) || 0);
            if (slot === 'p1') this.state.paddleP1.x = x;
            else this.state.paddleP2.x = x;
        });

        this.onMessage('rematch', (client) => {
            if (this.state.phase !== 'finished') return;
            this.rematchVotes.add(client.sessionId);
            if (this.rematchVotes.size >= 2) {
                this.startNewMatch();
            }
        });
    }

    private initializeState() {
        this.state.phase = 'waiting';

        this.state.paddleP1.x = initialPaddleX();
        this.state.paddleP1.y = PADDLE_Y.p1;
        this.state.paddleP1.width = PADDLE_W;

        this.state.paddleP2.x = initialPaddleX();
        this.state.paddleP2.y = PADDLE_Y.p2;
        this.state.paddleP2.width = PADDLE_W;

        this.state.bricksP1 = buildBrickGrid('p1');
        this.state.bricksP2 = buildBrickGrid('p2');
        this.state.aliveCountP1 = this.state.bricksP1.length;
        this.state.aliveCountP2 = this.state.bricksP2.length;

        this.state.ballSpeedTier = 0;
        resetBall(this.state, Math.random() < 0.5 ? 'p1' : 'p2');

        this.state.winnerSlot = '';
    }

    onJoin(client: Client, options: JoinOptions = {}) {
        const slot: PlayerSlot = this.state.playerSlot.size === 0 ? 'p1' : 'p2';
        this.state.playerSlot.set(client.sessionId, slot);
        this.state.playerName.set(
            client.sessionId,
            (options.name || randomHandle()).slice(0, 24)
        );

        if (this.state.playerSlot.size === 2) {
            this.beginCountdown();
        }
    }

    onLeave(client: Client) {
        const slot = this.state.playerSlot.get(client.sessionId);
        this.state.playerSlot.delete(client.sessionId);
        this.state.playerName.delete(client.sessionId);
        this.rematchVotes.delete(client.sessionId);

        // If a player leaves mid-game, the other wins by default
        if (this.state.phase === 'playing' || this.state.phase === 'countdown') {
            this.state.phase = 'finished';
            this.state.winnerSlot = slot === 'p1' ? 'p2' : 'p1';
            this.stopTick();
        }
    }

    private beginCountdown() {
        this.initializeState(); // reset for fresh match
        this.state.phase = 'countdown';
        this.state.countdownEndsAt = Date.now() + COUNTDOWN_SECONDS * 1000;
        this.clock.setTimeout(() => this.beginPlay(), COUNTDOWN_SECONDS * 1000);
    }

    private beginPlay() {
        if (this.state.playerSlot.size < 2) {
            this.state.phase = 'waiting';
            return;
        }
        this.state.phase = 'playing';
        this.state.matchEndsAt = Date.now() + MATCH_TIMEOUT_SECONDS * 1000;
        this.lastTickAt = Date.now();
        // Snapshot alive counts for delta-tracking garbage triggers
        this.prevAliveP1 = this.state.aliveCountP1;
        this.prevAliveP2 = this.state.aliveCountP2;
        this.brickKillsTotal = 0;
        this.startTick();
    }

    private startNewMatch() {
        this.rematchVotes.clear();
        this.beginCountdown();
    }

    private startTick() {
        this.stopTick();
        this.tickInterval = setInterval(() => this.tick(), 1000 / SERVER_TICK_HZ);
    }

    private stopTick() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = undefined;
        }
    }

    private tick() {
        if (this.state.phase !== 'playing') return;

        const now = Date.now();
        const dt = Math.min(0.05, (now - this.lastTickAt) / 1000); // cap at 50ms to avoid huge jumps
        this.lastTickAt = now;

        // Pending launch: ball sits frozen at center for ~900ms after a score, then
        // serves toward the opponent of the loser at INITIAL_SPEED. Gives both
        // players a beat to reposition.
        if (this.pendingLaunch) {
            if (now >= this.pendingLaunch.at) {
                const dir = this.pendingLaunch.dir;
                resetBall(this.state, dir);
                this.pendingLaunch = null;
            }
            return; // do NOT step physics while frozen
        }

        const result = stepBall(this.state, dt);

        // Forward one-shot events to clients
        for (const ev of result.events) {
            this.broadcast(ev.kind, ev);
        }

        // Garbage delivery: count brick deaths since last tick, deliver when threshold hit
        const newKills = (this.prevAliveP1 - this.state.aliveCountP1) + (this.prevAliveP2 - this.state.aliveCountP2);
        if (newKills > 0) {
            this.brickKillsTotal += newKills;
            this.prevAliveP1 = this.state.aliveCountP1;
            this.prevAliveP2 = this.state.aliveCountP2;
            while (this.brickKillsTotal >= BreakoutRoom.GARBAGE_THRESHOLD) {
                this.brickKillsTotal -= BreakoutRoom.GARBAGE_THRESHOLD;
                this.deliverGarbage();
            }
        }

        if (result.scoredAgainst) {
            // Position ball at center but freeze until launch — feels like a reset
            const opponent: PlayerSlot = result.scoredAgainst === 'p1' ? 'p2' : 'p1';
            this.state.ball.x = ARENA_W / 2;
            this.state.ball.y = ARENA_H / 2;
            this.state.ball.vx = 0;
            this.state.ball.vy = 0;
            this.pendingLaunch = { dir: opponent, at: now + 900 };
        }

        // Win check: opponent's bricks at zero
        if (this.state.aliveCountP1 === 0) {
            this.endMatch('p2');
        } else if (this.state.aliveCountP2 === 0) {
            this.endMatch('p1');
        } else if (now >= this.state.matchEndsAt) {
            // Soft timeout: more bricks remaining loses
            if (this.state.aliveCountP1 < this.state.aliveCountP2) this.endMatch('p2');
            else if (this.state.aliveCountP2 < this.state.aliveCountP1) this.endMatch('p1');
            else this.state.matchEndsAt = now + 30_000; // sudden-death extension
        }
    }

    private endMatch(winner: PlayerSlot) {
        this.state.phase = 'finished';
        this.state.winnerSlot = winner;
        this.stopTick();
    }

    /** Garbage: revive up to N dead bricks on the LOSING player's side (catch-up
     * mechanic). 22% of revived bricks become specials (🎁 / 💎) — the surprise
     * goodies that make receiving garbage a moment of hope, not pure pain. */
    private deliverGarbage() {
        // Pick recipient = whoever has fewer alive bricks (the loser); ties → random
        let recipient: PlayerSlot;
        if (this.state.aliveCountP1 < this.state.aliveCountP2) recipient = 'p1';
        else if (this.state.aliveCountP2 < this.state.aliveCountP1) recipient = 'p2';
        else recipient = Math.random() < 0.5 ? 'p1' : 'p2';

        const bricks = recipient === 'p1' ? this.state.bricksP1 : this.state.bricksP2;
        const paddleY = recipient === 'p1' ? PADDLE_Y.p1 : PADDLE_Y.p2;

        // Find dead bricks, sort closest-to-paddle first (visceral "right in your face" feel)
        const dead: { brick: typeof bricks[0]; dist: number }[] = [];
        bricks.forEach((b) => {
            if (b.alive === 0) dead.push({ brick: b, dist: Math.abs(b.y - paddleY) });
        });
        if (dead.length === 0) return; // nothing to revive

        dead.sort((a, b) => a.dist - b.dist);
        const reviveCount = Math.min(4, dead.length);

        for (let i = 0; i < reviveCount; i++) {
            const { brick } = dead[i];
            brick.alive = 1;
            brick.hp = 1;
            brick.maxHp = 1;
            // Surprise! 22% of revived bricks are positive specials.
            // Bombs intentionally excluded — they'd be too punitive on garbage.
            const roll = Math.random();
            if (roll < 0.12) brick.kind = 'gift';
            else if (roll < 0.22) brick.kind = 'diamond';
            else brick.kind = 'normal';

            if (recipient === 'p1') this.state.aliveCountP1++;
            else this.state.aliveCountP2++;
        }

        this.broadcast('garbage', { slot: recipient, count: reviveCount });
    }

    onDispose() {
        this.stopTick();
    }
}

function randomHandle(): string {
    const adj = [
        'Brick', 'Paddle', 'Ball', 'Spin', 'Sharp', 'Quiet', 'Loud',
        'Smooth', 'Sudden', 'Lucky', 'Bold', 'Quick',
    ];
    const noun = [
        'Brigadier', 'Captain', 'Voyager', 'Falcon', 'Comet', 'Spark',
        'Echo', 'Whisper', 'Dasher', 'Pilot', 'Drifter', 'Scout',
    ];
    const a = adj[Math.floor(Math.random() * adj.length)];
    const b = noun[Math.floor(Math.random() * noun.length)];
    const n = Math.floor(1000 + Math.random() * 8999);
    return `${a} ${b} #${n}`;
}
