// GameScene — renders the authoritative server state every frame and forwards
// pointer X to the server as paddle position. No local physics. The server
// owns truth; we own the *feel* (motion, particles, screen-shake).

import { Scene } from 'phaser';
import { getStateCallbacks } from 'colyseus.js';
import {
    ARENA_W,
    ARENA_H,
    BALL_RADIUS,
    BRICK_W,
    BRICK_H,
    COLORS,
    PADDLE_H,
    PADDLE_Y,
    COUNTDOWN_SECONDS,
} from '@breakout/shared';
import type {
    Brick,
    BrickBreakEvent,
    PaddleHitEvent,
    PlayerSlot,
} from '@breakout/shared';
import { net } from '../../network/Net';
import { THEME } from '../../ui/theme';

const SEND_HZ = 30;
const SEND_INTERVAL_MS = 1000 / SEND_HZ;

const TRAIL_LEN = 6;

export class GameScene extends Scene {
    // Layers
    private bgLayer!: Phaser.GameObjects.Container;
    private brickLayer!: Phaser.GameObjects.Container;
    private playLayer!: Phaser.GameObjects.Container;
    private hudLayer!: Phaser.GameObjects.Container;

    // Game-objects representing server state
    private paddleP1!: Phaser.GameObjects.Rectangle;
    private paddleP2!: Phaser.GameObjects.Rectangle;
    private ball!: Phaser.GameObjects.Arc;
    private ballGlow!: Phaser.GameObjects.Arc;
    private trail: Phaser.GameObjects.Arc[] = [];
    private trailHistory: Array<{ x: number; y: number }> = [];

    // Brick sprite arrays match index of bricksP1 / bricksP2 in state
    private bricksP1: (Phaser.GameObjects.Rectangle | null)[] = [];
    private bricksP2: (Phaser.GameObjects.Rectangle | null)[] = [];

    // HUD
    private hudP1!: Phaser.GameObjects.Text;
    private hudP2!: Phaser.GameObjects.Text;
    private hudCenter!: Phaser.GameObjects.Text;

    // Countdown
    private countdownText!: Phaser.GameObjects.Text;

    // Particle texture key
    private particleKey = 'spark';

    // State
    private mySlot: PlayerSlot | null = null;
    private lastSendAt = 0;
    private lastSentX = -1;
    private trailFlashUntil = 0;
    private renderedPhase: string | null = null;

    constructor() {
        super({ key: 'GameScene' });
    }

    // ------------------------------------------------------------------

    create() {
        const room = net.room;
        if (!room) {
            this.scene.start('LobbyScene');
            return;
        }

        this.cameras.main.setBackgroundColor(`#${COLORS.bg.toString(16).padStart(6, '0')}`);

        // Build layers
        this.bgLayer = this.add.container(0, 0);
        this.brickLayer = this.add.container(0, 0);
        this.playLayer = this.add.container(0, 0);
        this.hudLayer = this.add.container(0, 0);

        this.buildBackground();
        this.buildHud();
        this.buildPaddlesAndBall();
        this.buildParticleTexture();
        this.buildBricksFromState();

        // Determine our slot
        this.mySlot = (room.state.playerSlot.get(room.sessionId) as PlayerSlot | undefined) ?? null;

        // Slide-up entrance for the entire arena
        const containers = [this.bgLayer, this.brickLayer, this.playLayer, this.hudLayer];
        containers.forEach((c) => c.setY(40));
        this.tweens.add({
            targets: containers,
            y: 0,
            alpha: { from: 0, to: 1 },
            duration: THEME.dur.long,
            ease: THEME.ease.out,
        });

        // Wire input — send pointer X (in game-world coords) to server, throttled.
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.handlePointerMove(pointer));
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handlePointerMove(pointer));

        // Wire room messages
        room.onMessage<BrickBreakEvent>('brickBreak', (ev) => this.handleBrickBreak(ev));
        room.onMessage<PaddleHitEvent>('paddleHit', (ev) => this.handlePaddleHit(ev));
        room.onMessage<{ side: string; x: number; y: number }>('wallHit', () => {
            // Tiny pulse on wall hit — leave subtle for now
        });

        // Schema callbacks — Colyseus 0.16 pattern via getStateCallbacks(room).
        // This proxy mirrors the schema tree and exposes onChange/onAdd/onRemove.
        const $ = getStateCallbacks(room);

        // Listen for slot assignment after the fact (in case it changes)
        $(room.state).playerSlot.onChange((value: string, key: string) => {
            if (key === room.sessionId) this.mySlot = value as PlayerSlot;
        });

        // Brick state changes (per-brick alive flag flips to 0)
        $(room.state).bricksP1.onChange((brick: Brick, idx: number) =>
            this.handleBrickChange('p1', idx, brick.alive),
        );
        $(room.state).bricksP2.onChange((brick: Brick, idx: number) =>
            this.handleBrickChange('p2', idx, brick.alive),
        );

        // Brick adds (rematch / regenerate). Rebuild visuals fresh.
        $(room.state).bricksP1.onAdd(() => this.rebuildBricks());
        $(room.state).bricksP2.onAdd(() => this.rebuildBricks());

        // Phase changes — switch to EndScene when finished
        room.onStateChange((state) => {
            if (state.phase === 'finished' && this.renderedPhase !== 'finished') {
                this.renderedPhase = 'finished';
                this.handleMatchFinished();
            } else if (state.phase === 'countdown' || state.phase === 'playing') {
                this.renderedPhase = state.phase;
            }
        });

        // Cleanup
        this.events.once('shutdown', () => this.cleanup());
        this.events.once('destroy', () => this.cleanup());
    }

    // ------------------------------------------------------------------

    update(time: number) {
        const room = net.room;
        if (!room) return;
        const state = room.state;

        // Render paddles (interpolation = direct copy; Colyseus already smooths
        // server-side broadcast at 20 Hz; we render at 60).
        if (state.paddleP1) {
            this.paddleP1.x = state.paddleP1.x;
            this.paddleP1.width = state.paddleP1.width || this.paddleP1.width;
        }
        if (state.paddleP2) {
            this.paddleP2.x = state.paddleP2.x;
            this.paddleP2.width = state.paddleP2.width || this.paddleP2.width;
        }

        // Render ball
        if (state.ball) {
            const bx = state.ball.x;
            const by = state.ball.y;
            this.ball.setPosition(bx, by);
            this.ballGlow.setPosition(bx, by);

            // Update trail
            this.trailHistory.unshift({ x: bx, y: by });
            if (this.trailHistory.length > TRAIL_LEN) this.trailHistory.length = TRAIL_LEN;
            const flashing = time < this.trailFlashUntil;
            for (let i = 0; i < this.trail.length; i++) {
                const sample = this.trailHistory[i + 1];
                const arc = this.trail[i];
                if (sample) {
                    arc.setPosition(sample.x, sample.y);
                    const baseAlpha = (1 - i / TRAIL_LEN) * 0.34;
                    arc.setAlpha(flashing ? Math.min(1, baseAlpha + 0.45) : baseAlpha);
                    arc.setRadius(Math.max(2, BALL_RADIUS - i * 1.1));
                } else {
                    arc.setAlpha(0);
                }
            }
        }

        // HUD updates
        this.hudP1.setText(`${state.aliveCountP1}`);
        this.hudP2.setText(`${state.aliveCountP2}`);

        // Phase-driven center text
        this.renderCenterByPhase(state.phase, state.countdownEndsAt);

        // Send pointer X if changed and throttle elapsed
        this.maybeSendPaddleX(time);
    }

    // ------------------------------------------------------------------
    // Builders
    // ------------------------------------------------------------------

    private buildBackground() {
        // Arena rectangle
        const bg = this.add.rectangle(ARENA_W / 2, ARENA_H / 2, ARENA_W, ARENA_H, COLORS.arena);
        bg.setStrokeStyle(1, COLORS.arenaLine, 1);
        this.bgLayer.add(bg);

        // Center divider line — soft
        const g = this.add.graphics();
        g.lineStyle(1, COLORS.arenaLine, 0.5);
        g.beginPath();
        g.moveTo(24, ARENA_H / 2);
        g.lineTo(ARENA_W - 24, ARENA_H / 2);
        g.strokePath();
        this.bgLayer.add(g);

        // Faint corner brackets — Apple-style detail
        const bracketLen = 18;
        const bracket = (cx: number, cy: number, sx: number, sy: number) => {
            const gg = this.add.graphics();
            gg.lineStyle(1, COLORS.arenaLine, 1);
            gg.beginPath();
            gg.moveTo(cx + bracketLen * sx, cy);
            gg.lineTo(cx, cy);
            gg.lineTo(cx, cy + bracketLen * sy);
            gg.strokePath();
            this.bgLayer.add(gg);
        };
        const inset = 8;
        bracket(inset, inset, 1, 1);
        bracket(ARENA_W - inset, inset, -1, 1);
        bracket(inset, ARENA_H - inset, 1, -1);
        bracket(ARENA_W - inset, ARENA_H - inset, -1, -1);
    }

    private buildHud() {
        const baseStyle = {
            fontFamily: THEME.fontFamily,
            color: `#${COLORS.text.toString(16).padStart(6, '0')}`,
            fontSize: '28px',
            fontStyle: '600',
        } satisfies Phaser.Types.GameObjects.Text.TextStyle;

        // P1 brick count (top-left)
        this.hudP1 = this.add.text(20, 8, '0', {
            ...baseStyle,
            color: `#${COLORS.p1.toString(16).padStart(6, '0')}`,
        }).setOrigin(0, 0);
        this.hudLayer.add(this.hudP1);

        // P2 brick count (bottom-right)
        this.hudP2 = this.add.text(ARENA_W - 20, ARENA_H - 8, '0', {
            ...baseStyle,
            color: `#${COLORS.p2.toString(16).padStart(6, '0')}`,
        }).setOrigin(1, 1);
        this.hudLayer.add(this.hudP2);

        // Center label (countdown / status)
        this.hudCenter = this.add.text(ARENA_W / 2, ARENA_H / 2, '', {
            fontFamily: THEME.fontFamily,
            color: `#${COLORS.dim.toString(16).padStart(6, '0')}`,
            fontSize: '12px',
            fontStyle: '600',
        }).setOrigin(0.5);
        this.hudCenter.setLetterSpacing(2.4);
        this.hudLayer.add(this.hudCenter);

        // Big countdown text (created hidden, reused per tick)
        this.countdownText = this.add.text(ARENA_W / 2, ARENA_H / 2, '', {
            fontFamily: THEME.fontFamily,
            color: `#${COLORS.text.toString(16).padStart(6, '0')}`,
            fontSize: '120px',
            fontStyle: '800',
        }).setOrigin(0.5);
        this.countdownText.setAlpha(0);
        this.hudLayer.add(this.countdownText);
    }

    private buildPaddlesAndBall() {
        const paddleW = ARENA_W / 8;
        this.paddleP1 = this.add.rectangle(ARENA_W / 2, PADDLE_Y.p1, paddleW, PADDLE_H, COLORS.p1);
        this.paddleP1.setOrigin(0.5);
        this.paddleP2 = this.add.rectangle(ARENA_W / 2, PADDLE_Y.p2, paddleW, PADDLE_H, COLORS.p2);
        this.paddleP2.setOrigin(0.5);
        this.playLayer.add([this.paddleP1, this.paddleP2]);

        // Soft glow under each paddle (a wider, dimmer rect)
        const glow1 = this.add.rectangle(ARENA_W / 2, PADDLE_Y.p1, paddleW * 1.4, PADDLE_H * 2.2, COLORS.p1, 0.08);
        const glow2 = this.add.rectangle(ARENA_W / 2, PADDLE_Y.p2, paddleW * 1.4, PADDLE_H * 2.2, COLORS.p2, 0.08);
        this.playLayer.addAt(glow1, 0);
        this.playLayer.addAt(glow2, 0);
        // Tie glow position to paddle each frame? Keep simple — glow stays centered.
        // Hide by default; show again when paddle settles. (Skip; static is fine.)

        // Trail circles (created behind ball)
        for (let i = 0; i < TRAIL_LEN; i++) {
            const arc = this.add.circle(ARENA_W / 2, ARENA_H / 2, BALL_RADIUS, COLORS.ballTrail, 0);
            this.trail.push(arc);
            this.playLayer.add(arc);
        }

        // Ball glow (larger, dim)
        this.ballGlow = this.add.circle(ARENA_W / 2, ARENA_H / 2, BALL_RADIUS * 2.4, COLORS.ball, 0.15);
        this.playLayer.add(this.ballGlow);

        // Ball
        this.ball = this.add.circle(ARENA_W / 2, ARENA_H / 2, BALL_RADIUS, COLORS.ball);
        this.playLayer.add(this.ball);
    }

    private buildParticleTexture() {
        // Create a 1x1 white texture once, used for procedural particle bursts via tween.
        if (this.textures.exists(this.particleKey)) return;
        const g = this.add.graphics();
        g.fillStyle(0xffffff, 1);
        g.fillCircle(3, 3, 3);
        g.generateTexture(this.particleKey, 6, 6);
        g.destroy();
    }

    private buildBricksFromState() {
        const room = net.room;
        if (!room) return;
        this.brickLayer.removeAll(true);
        this.bricksP1 = [];
        this.bricksP2 = [];

        room.state.bricksP1.forEach((brick, _idx) => {
            this.bricksP1.push(this.makeBrick(brick.x, brick.y, COLORS.p1Brick, brick.alive === 1));
        });
        room.state.bricksP2.forEach((brick, _idx) => {
            this.bricksP2.push(this.makeBrick(brick.x, brick.y, COLORS.p2Brick, brick.alive === 1));
        });
    }

    private rebuildBricks() {
        this.buildBricksFromState();
    }

    private makeBrick(x: number, y: number, color: number, alive: boolean): Phaser.GameObjects.Rectangle | null {
        if (!alive) return null;
        const r = this.add.rectangle(x, y, BRICK_W, BRICK_H, color);
        r.setStrokeStyle(1, color, 1);
        // Subtle inner darkening: stack a translucent rectangle on top
        this.brickLayer.add(r);
        return r;
    }

    // ------------------------------------------------------------------
    // Event handlers
    // ------------------------------------------------------------------

    private handlePointerMove(pointer: Phaser.Input.Pointer) {
        // pointer.worldX is in scaled coords → use Phaser's translation
        const x = Phaser.Math.Clamp(pointer.worldX, 0, ARENA_W);
        // We update local paddle prediction immediately (instant feedback).
        if (this.mySlot === 'p1') this.paddleP1.x = x;
        else if (this.mySlot === 'p2') this.paddleP2.x = x;
        // Send is throttled in update()
        (this as { _pendingX?: number })._pendingX = x;
    }

    private maybeSendPaddleX(time: number) {
        const room = net.room;
        if (!room) return;
        const pending = (this as { _pendingX?: number })._pendingX;
        if (pending === undefined) return;
        if (time - this.lastSendAt < SEND_INTERVAL_MS) return;
        if (pending === this.lastSentX) return;
        room.send('paddleMove', { x: pending });
        this.lastSentX = pending;
        this.lastSendAt = time;
    }

    private handleBrickChange(slot: PlayerSlot, idx: number, alive: number) {
        const arr = slot === 'p1' ? this.bricksP1 : this.bricksP2;
        const sprite = arr[idx];
        if (alive === 0 && sprite) {
            // Destruction tween + particle burst
            const x = sprite.x;
            const y = sprite.y;
            const color = slot === 'p1' ? COLORS.p1Brick : COLORS.p2Brick;
            this.tweens.add({
                targets: sprite,
                scale: 0,
                alpha: 0,
                duration: 200,
                ease: THEME.ease.in,
                onComplete: () => sprite.destroy(),
            });
            arr[idx] = null;
            this.spawnBrickBurst(x, y, color);
        } else if (alive === 1 && !sprite) {
            // Resurrection (rematch)
            const stateBrick =
                slot === 'p1' ? net.room?.state.bricksP1.at(idx) : net.room?.state.bricksP2.at(idx);
            if (!stateBrick) return;
            const color = slot === 'p1' ? COLORS.p1Brick : COLORS.p2Brick;
            arr[idx] = this.makeBrick(stateBrick.x, stateBrick.y, color, true);
        }
    }

    private handleBrickBreak(_ev: BrickBreakEvent) {
        // The actual destroy + particle burst is driven by state change — keeps
        // visuals consistent even if a message is dropped. The event hook is
        // available for future SFX/music triggers.
    }

    private handlePaddleHit(ev: PaddleHitEvent) {
        // Camera shake + ball-trail flash. Intensity scales subtly.
        const intensity = Phaser.Math.Clamp(ev.intensity ?? 0.5, 0.2, 1);
        this.cameras.main.shake(80, 0.0035 * intensity);
        this.trailFlashUntil = this.time.now + 100;

        // Pulse the paddle that got hit
        const target = ev.slot === 'p1' ? this.paddleP1 : this.paddleP2;
        this.tweens.add({
            targets: target,
            scaleY: 1.6,
            duration: 80,
            yoyo: true,
            ease: THEME.ease.out,
        });
    }

    private spawnBrickBurst(x: number, y: number, color: number) {
        // Single-frame white flash at impact point (Apple-style "tap feedback").
        const flash = this.add.image(x, y, this.particleKey);
        flash.setScale(2.4);
        flash.setTint(0xffffff);
        flash.setAlpha(0.95);
        this.playLayer.add(flash);
        this.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 1.0,
            duration: 140,
            ease: 'Cubic.easeOut',
            onComplete: () => flash.destroy(),
        });

        const COUNT = 6;
        for (let i = 0; i < COUNT; i++) {
            const angle = (Math.PI * 2 * i) / COUNT + Math.random() * 0.3;
            const dist = 26 + Math.random() * 14;
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            const p = this.add.image(x, y, this.particleKey);
            p.setTint(color);
            p.setScale(0.9 + Math.random() * 0.4);
            this.playLayer.add(p);
            this.tweens.add({
                targets: p,
                x: x + dx,
                y: y + dy,
                alpha: 0,
                scale: 0.1,
                duration: 380 + Math.random() * 80,
                ease: THEME.ease.out,
                onComplete: () => p.destroy(),
            });
        }
    }

    // ------------------------------------------------------------------
    // Phase-driven center text (countdown + "GO")
    // ------------------------------------------------------------------

    private lastCountdownNumber = 0;

    private renderCenterByPhase(phase: string, countdownEndsAt: number) {
        if (phase === 'countdown') {
            // Compute remaining seconds (1..N). Server timestamps are ms.
            const remainingMs = Math.max(0, countdownEndsAt - Date.now());
            const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));
            const display = Math.min(remainingSec, COUNTDOWN_SECONDS);
            this.hudCenter.setText('GET READY');
            if (display !== this.lastCountdownNumber) {
                this.lastCountdownNumber = display;
                this.popCountdown(`${display}`);
            }
        } else if (phase === 'playing') {
            this.hudCenter.setText('');
            if (this.lastCountdownNumber !== -1) {
                this.lastCountdownNumber = -1;
                this.popCountdown('GO', true);
            }
        } else if (phase === 'waiting') {
            this.hudCenter.setText('STANDBY');
        } else if (phase === 'finished') {
            this.hudCenter.setText('');
        }
    }

    private popCountdown(text: string, isGo = false) {
        this.countdownText.setText(text);
        this.countdownText.setAlpha(0);
        // Start small, overshoot toward 1.0 — feels like the number "arrives" rather than retreats.
        this.countdownText.setScale(isGo ? 1.0 : 0.6);
        this.tweens.killTweensOf(this.countdownText);

        if (isGo) {
            // GO: bloom outward while fading — release energy
            this.tweens.add({
                targets: this.countdownText,
                scale: 1.25,
                alpha: 0,
                duration: 360,
                ease: 'Quint.easeOut',
            });
        } else {
            // Number arrives with a confident overshoot, then exits
            this.tweens.add({
                targets: this.countdownText,
                scale: 1.0,
                alpha: 1,
                duration: 280,
                ease: 'Back.easeOut',
            });
            this.tweens.add({
                targets: this.countdownText,
                alpha: 0,
                duration: 380,
                delay: 560,
                ease: THEME.ease.in,
            });
        }
    }

    // ------------------------------------------------------------------
    // Match end → EndScene
    // ------------------------------------------------------------------

    private handleMatchFinished() {
        const room = net.room;
        if (!room) return;
        // Dim arena before handing off
        this.tweens.add({
            targets: [this.bgLayer, this.brickLayer, this.playLayer, this.hudLayer],
            alpha: 0.3,
            duration: THEME.dur.long,
            ease: THEME.ease.out,
        });
        this.time.delayedCall(THEME.dur.long, () => {
            this.scene.launch('EndScene', {
                winnerSlot: room.state.winnerSlot,
                mySlot: this.mySlot,
                aliveCountP1: room.state.aliveCountP1,
                aliveCountP2: room.state.aliveCountP2,
            });
            this.scene.bringToTop('EndScene');
        });
    }

    private cleanup() {
        // Defensive listener-removal via reset on next mount; Phaser auto-cleans events.
    }
}
