import { Room, Client } from 'colyseus';
import {
    GameState,
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

        const result = stepBall(this.state, dt);

        // Forward one-shot events to clients
        for (const ev of result.events) {
            this.broadcast(ev.kind, ev);
        }

        if (result.scoredAgainst) {
            // Ball passed loser's paddle. Respawn at center, send toward the OTHER
            // side (away from where it just exited) so it doesn't immediately fly
            // back out the same wall. Speed reset to BALL_INITIAL_SPEED in resetBall().
            const opponent: PlayerSlot = result.scoredAgainst === 'p1' ? 'p2' : 'p1';
            resetBall(this.state, opponent);
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
