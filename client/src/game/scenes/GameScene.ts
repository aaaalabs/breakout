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
import { sfx } from '../../audio/Sfx';
import { ComboMeter } from '../ComboMeter';
import { BackgroundFx } from '../BackgroundFx';
import { mountExitButton } from '../../ui/exitButton';

// 60Hz paddle sends — halves the worst-case "ball passed through paddle" window
// from ~33ms to ~17ms when a player flicks at the last moment.
const SEND_HZ = 60;
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
    // Optional emoji icon for special bricks (parallel arrays)
    private brickIconsP1: (Phaser.GameObjects.Text | null)[] = [];
    private brickIconsP2: (Phaser.GameObjects.Text | null)[] = [];

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
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    private keyA?: Phaser.Input.Keyboard.Key;
    private keyD?: Phaser.Input.Keyboard.Key;
    private kbPaddleX: number | null = null;
    private renderedPhase: string | null = null;
    // Smooth interpolation: render-state lerps toward latest server snapshot.
    private renderBallX = 0;
    private renderBallY = 0;
    private renderPaddleP1X = 0;
    private renderPaddleP2X = 0;
    private combo!: ComboMeter;
    private renderFrozenUntil = 0;
    private bgfx!: BackgroundFx;
    private unmountExit?: () => void;

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
        this.bgfx = new BackgroundFx(this, this.bgLayer);
        this.buildHud();
        this.buildPaddlesAndBall();
        this.buildParticleTexture();
        this.buildBricksFromState();

        // Combo meter — top center (above any HUD text)
        this.combo = new ComboMeter(this, { x: ARENA_W / 2, y: 110, layer: this.hudLayer });

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

        // Wire input: pointer (mouse + touch) → paddle X
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.handlePointerMove(pointer));
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handlePointerMove(pointer));

        // Keyboard control: arrow keys + A/D (held) move paddle left/right
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
            this.keyA = this.input.keyboard.addKey('A');
            this.keyD = this.input.keyboard.addKey('D');
        }

        // Wire room messages
        room.onMessage<BrickBreakEvent>('brickBreak', (ev) => this.handleBrickBreak(ev));
        room.onMessage<PaddleHitEvent>('paddleHit', (ev) => this.handlePaddleHit(ev));
        room.onMessage<{ side: string; x: number; y: number }>('wallHit', () => {
            // Tiny pulse on wall hit — leave subtle for now
        });

        // Garbage incoming — different cue based on whether you're being hit or hitting them
        room.onMessage<{ slot: PlayerSlot; count: number }>('garbage', (ev) => {
            const isMe = ev.slot === this.mySlot;
            if (isMe) sfx.garbageIn();
            else sfx.garbageOut();
            this.bgfx.pulse(isMe ? 0xff6b6b : 0x7ce38b, 0.22);
            this.flashGarbageBanner(isMe ? '🗑️  GARBAGE +' + ev.count : '⚔️  YOU GARBAGED THEM');
        });

        // Schema callbacks — Colyseus 0.16 pattern via getStateCallbacks(room).
        // This proxy mirrors the schema tree and exposes onChange/onAdd/onRemove.
        const $ = getStateCallbacks(room);

        // Listen for slot assignment after the fact (in case it changes)
        $(room.state).playerSlot.onChange((value: string, key: string) => {
            if (key === room.sessionId) this.mySlot = value as PlayerSlot;
        });

        // Brick state changes — Colyseus 0.16: ArraySchema.onChange does NOT fire
        // when a field of an existing element mutates. Subscribe per element.
        const subscribeBrickP1 = (brick: Brick, idx: number) => {
            $(brick).onChange(() => this.handleBrickChange('p1', idx, brick.alive));
        };
        const subscribeBrickP2 = (brick: Brick, idx: number) => {
            $(brick).onChange(() => this.handleBrickChange('p2', idx, brick.alive));
        };
        $(room.state).bricksP1.onAdd((brick: Brick, idx: number) => {
            subscribeBrickP1(brick, idx);
            // If we're seeing this onAdd after initial state (e.g. rematch), rebuild visuals
            if (this.bricksP1.length > 0 && this.bricksP1[idx] == null) this.rebuildBricks();
        });
        $(room.state).bricksP2.onAdd((brick: Brick, idx: number) => {
            subscribeBrickP2(brick, idx);
            if (this.bricksP2.length > 0 && this.bricksP2[idx] == null) this.rebuildBricks();
        });
        // Subscribe to existing bricks (state already populated when scene starts)
        room.state.bricksP1.forEach((b, i) => subscribeBrickP1(b, i));
        room.state.bricksP2.forEach((b, i) => subscribeBrickP2(b, i));

        // Phase changes — switch to EndScene when finished
        room.onStateChange((state) => {
            if (state.phase === 'finished' && this.renderedPhase !== 'finished') {
                this.renderedPhase = 'finished';
                this.handleMatchFinished();
            } else if (state.phase === 'countdown' || state.phase === 'playing') {
                this.renderedPhase = state.phase;
            }
        });

        // Mobile-friendly exit button (top-right). Forfeits the match by leaving room.
        this.unmountExit = mountExitButton(() => {
            void net.leave();
            this.scene.start('LobbyScene');
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
        this.combo?.tick(time);
        this.bgfx?.tick(time);

        // Frame-rate-independent smoothing factor (~30Hz half-life).
        // During hit-stop the lerp factor is zero so the ball appears frozen.
        const dtMs = this.game.loop.delta;
        const a = time < this.renderFrozenUntil ? 0 : 1 - Math.exp(-dtMs / 33);

        // Paddles — own paddle uses local prediction (already in sprite),
        // opponent paddle interpolates from server.
        if (state.paddleP1) {
            const target = state.paddleP1.x;
            if (this.mySlot === 'p1') {
                // local prediction already set this; just snap server correction softly
                this.renderPaddleP1X += (target - this.renderPaddleP1X) * a * 0.5;
                this.paddleP1.x = this.paddleP1.x; // keep local prediction
            } else {
                this.renderPaddleP1X += (target - this.renderPaddleP1X) * a;
                this.paddleP1.x = this.renderPaddleP1X;
            }
            this.paddleP1.width = state.paddleP1.width || this.paddleP1.width;
        }
        if (state.paddleP2) {
            const target = state.paddleP2.x;
            if (this.mySlot === 'p2') {
                this.renderPaddleP2X += (target - this.renderPaddleP2X) * a * 0.5;
                this.paddleP2.x = this.paddleP2.x;
            } else {
                this.renderPaddleP2X += (target - this.renderPaddleP2X) * a;
                this.paddleP2.x = this.renderPaddleP2X;
            }
            this.paddleP2.width = state.paddleP2.width || this.paddleP2.width;
        }

        // Ball — smooth lerp toward latest server position (kills 30Hz teleports)
        if (state.ball) {
            this.renderBallX += (state.ball.x - this.renderBallX) * a;
            this.renderBallY += (state.ball.y - this.renderBallY) * a;
            this.ball.setPosition(this.renderBallX, this.renderBallY);
            this.ballGlow.setPosition(this.renderBallX, this.renderBallY);

            // Update trail using rendered (smoothed) positions
            this.trailHistory.unshift({ x: this.renderBallX, y: this.renderBallY });
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

        // Keyboard movement (held cursor / WASD): integrate at constant speed
        this.handleKeyboardMovement(this.game.loop.delta);

        // Send pointer/keyboard X if changed and throttle elapsed
        this.maybeSendPaddleX(time);
    }

    private handleKeyboardMovement(deltaMs: number) {
        const left = this.cursors?.left.isDown || this.keyA?.isDown;
        const right = this.cursors?.right.isDown || this.keyD?.isDown;
        if (!left && !right) return;

        const speed = 980; // px/s — snappy but not twitchy
        const myPaddle = this.mySlot === 'p1' ? this.paddleP1 : this.mySlot === 'p2' ? this.paddleP2 : null;
        if (!myPaddle) return;

        const cur = this.kbPaddleX ?? myPaddle.x;
        const dir = (right ? 1 : 0) - (left ? 1 : 0);
        const next = Math.max(0, Math.min(ARENA_W, cur + dir * speed * (deltaMs / 1000)));
        this.kbPaddleX = next;
        myPaddle.x = next;
        (this as { _pendingX?: number })._pendingX = next;
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

        // Initialize render-state targets so first frame doesn't lerp from 0.
        const room = net.room;
        if (room?.state.ball) { this.renderBallX = room.state.ball.x; this.renderBallY = room.state.ball.y; }
        else { this.renderBallX = ARENA_W / 2; this.renderBallY = ARENA_H / 2; }
        this.renderPaddleP1X = room?.state.paddleP1?.x ?? ARENA_W / 2;
        this.renderPaddleP2X = room?.state.paddleP2?.x ?? ARENA_W / 2;
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
        this.brickIconsP1 = [];
        this.brickIconsP2 = [];

        room.state.bricksP1.forEach((brick) => {
            this.bricksP1.push(this.makeBrick(brick.x, brick.y, this.brickColor('p1', brick.maxHp, brick.hp, brick.kind), brick.alive === 1));
            this.brickIconsP1.push(this.makeBrickIcon(brick.x, brick.y, brick.kind, brick.alive === 1));
        });
        room.state.bricksP2.forEach((brick) => {
            this.bricksP2.push(this.makeBrick(brick.x, brick.y, this.brickColor('p2', brick.maxHp, brick.hp, brick.kind), brick.alive === 1));
            this.brickIconsP2.push(this.makeBrickIcon(brick.x, brick.y, brick.kind, brick.alive === 1));
        });
    }

    private brickColor(slot: PlayerSlot, maxHp: number, hp: number, kind?: string): number {
        if (kind === 'gift') return 0xffd166;
        if (kind === 'diamond') return 0x9d8df1;
        if (kind === 'bomb') return 0xff6b6b;
        if (maxHp >= 2) {
            return hp >= 2 ? COLORS.ironBrick : COLORS.ironBrickHurt;
        }
        return slot === 'p1' ? COLORS.p1Brick : COLORS.p2Brick;
    }

    private brickEmoji(kind: string | undefined): string | null {
        if (kind === 'gift')    return '🎁';
        if (kind === 'diamond') return '💎';
        if (kind === 'bomb')    return '💣';
        return null;
    }

    private makeBrickIcon(x: number, y: number, kind: string, alive: boolean): Phaser.GameObjects.Text | null {
        if (!alive) return null;
        const emoji = this.brickEmoji(kind);
        if (!emoji) return null;
        const t = this.add.text(x, y, emoji, {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '14px',
        }).setOrigin(0.5);
        this.brickLayer.add(t);
        this.tweens.add({
            targets: t,
            scale: { from: 0.92, to: 1.10 },
            duration: 1200,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
        return t;
    }

    private rebuildBricks() {
        this.buildBricksFromState();
    }

    private makeBrick(x: number, y: number, color: number, alive: boolean): Phaser.GameObjects.Rectangle | null {
        if (!alive) return null;
        const r = this.add.rectangle(x, y, BRICK_W, BRICK_H, color);
        r.setStrokeStyle(1, color, 1);
        this.brickLayer.add(r);
        return r;
    }

    // ------------------------------------------------------------------
    // Event handlers
    // ------------------------------------------------------------------

    private handlePointerMove(pointer: Phaser.Input.Pointer) {
        // pointer.worldX is in scaled coords → use Phaser's translation.
        // Works for mouse, touch (drag), and tap (pointerdown).
        const x = Math.max(0, Math.min(ARENA_W, pointer.worldX));
        // We update local paddle prediction immediately (instant feedback).
        if (this.mySlot === 'p1') this.paddleP1.x = x;
        else if (this.mySlot === 'p2') this.paddleP2.x = x;
        // Pointer overrides keyboard tracking
        this.kbPaddleX = x;
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
        const iconArr = slot === 'p1' ? this.brickIconsP1 : this.brickIconsP2;
        const sprite = arr[idx];
        const icon = iconArr[idx];
        const stateArr = slot === 'p1' ? net.room?.state.bricksP1 : net.room?.state.bricksP2;
        const stateBrick = stateArr?.at(idx);

        if (alive === 0 && sprite) {
            // Destruction tween + particle burst
            const x = sprite.x;
            const y = sprite.y;
            const color = stateBrick ? this.brickColor(slot, stateBrick.maxHp, 0, stateBrick.kind) : (slot === 'p1' ? COLORS.p1Brick : COLORS.p2Brick);
            this.tweens.add({
                targets: sprite,
                scale: 0,
                alpha: 0,
                duration: 200,
                ease: THEME.ease.in,
                onComplete: () => sprite.destroy(),
            });
            arr[idx] = null;
            // Remove emoji icon if any
            if (icon) {
                this.tweens.killTweensOf(icon);
                icon.destroy();
                iconArr[idx] = null;
            }
            this.spawnBrickBurst(x, y, color);
        } else if (alive === 1 && stateBrick && sprite) {
            // Iron brick took damage but survived — flip color to "hurt" tint
            const newColor = this.brickColor(slot, stateBrick.maxHp, stateBrick.hp);
            sprite.setFillStyle(newColor, 1);
            sprite.setStrokeStyle(1, newColor, 1);
            const ox = sprite.x;
            this.tweens.killTweensOf(sprite);
            this.tweens.add({
                targets: sprite,
                x: { from: ox - 2, to: ox + 2 },
                duration: 40,
                yoyo: true,
                repeat: 1,
                ease: 'Sine.easeInOut',
                onComplete: () => sprite.setX(ox),
            });
        } else if (alive === 1 && !sprite && stateBrick) {
            // Resurrection — either rematch (instant) or garbage (animated drop-in)
            const color = this.brickColor(slot, stateBrick.maxHp, stateBrick.hp, stateBrick.kind);
            const newSprite = this.makeBrick(stateBrick.x, stateBrick.y, color, true);
            arr[idx] = newSprite;
            iconArr[idx] = this.makeBrickIcon(stateBrick.x, stateBrick.y, stateBrick.kind, true);
            // Garbage drop-in: brick falls from above with a small bounce
            if (newSprite) {
                const targetY = stateBrick.y;
                newSprite.y = targetY - 60;
                newSprite.setScale(0);
                this.tweens.add({
                    targets: newSprite,
                    y: targetY,
                    scale: 1,
                    duration: 360,
                    ease: 'Back.easeOut',
                });
                if (iconArr[idx]) {
                    const ic = iconArr[idx]!;
                    ic.y = targetY - 60;
                    ic.setAlpha(0);
                    this.tweens.add({ targets: ic, y: targetY, alpha: 1, duration: 360, ease: 'Back.easeOut' });
                }
            }
        }
    }

    private flashGarbageBanner(text: string) {
        const t = this.add.text(ARENA_W / 2, ARENA_H / 2, text, {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '24px', fontStyle: '800',
            color: '#ffd166',
        }).setOrigin(0.5).setAlpha(0).setScale(0.7);
        t.setLetterSpacing(3);
        this.hudLayer.add(t);
        this.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 200, ease: 'Back.easeOut' });
        this.tweens.add({
            targets: t, alpha: 0, y: t.y - 20,
            duration: 600, delay: 700, ease: 'Cubic.easeIn',
            onComplete: () => t.destroy(),
        });
    }

    private handleBrickBreak(ev: BrickBreakEvent) {
        sfx.brickBreak();
        sfx.maybeCombo();
        this.squashBall('y', 0.5);

        // Special-brick sound cues (read from current schema state by position match)
        const stateArr = ev.slot === 'p1' ? net.room?.state.bricksP1 : net.room?.state.bricksP2;
        if (stateArr) {
            const hit = stateArr.find((b) => b.alive === 0 && Math.abs(b.x - ev.x) < 1 && Math.abs(b.y - ev.y) < 1);
            if (hit) {
                if (hit.kind === 'bomb') sfx.bomb();
                else if (hit.kind === 'diamond') sfx.diamond();
                else if (hit.kind === 'gift') sfx.gift();
            }
        }

        if (ev.slot === this.mySlot) {
            const result = this.combo.register(this.time.now);
            if (result.tier >= 4) {
                this.freezeRender(50);
                const tierColor = result.tier >= 6 ? COLORS.p2 : result.tier >= 5 ? 0xffd166 : 0x7ce38b;
                this.bgfx.pulse(tierColor, 0.14);
                if (result.tier >= 6) sfx.tier7Fanfare(0.45);
            }
        }
    }

    private handlePaddleHit(ev: PaddleHitEvent) {
        // Camera shake + ball-trail flash. Intensity scales subtly.
        const intensity = Math.max(0.2, Math.min(1, ev.intensity ?? 0.5));
        this.cameras.main.shake(80, 0.0035 * intensity);
        this.trailFlashUntil = this.time.now + 100;
        sfx.paddleHit(intensity);
        this.squashBall('y', intensity);

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
                sfx.tick();
            }
        } else if (phase === 'playing') {
            this.hudCenter.setText('');
            if (this.lastCountdownNumber !== -1) {
                this.lastCountdownNumber = -1;
                this.popCountdown('GO', true);
                sfx.go();
                sfx.matchFanfare();
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
        // Did we win?
        if (this.mySlot && room.state.winnerSlot === this.mySlot) sfx.win();
        else sfx.lose();
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

    private freezeRender(ms: number) {
        this.renderFrozenUntil = this.time.now + ms;
    }

    /** Brief squash-and-stretch on impact. axis = main impact direction. */
    private squashBall(axis: 'x' | 'y', intensity = 1) {
        const compression = 0.55 + (1 - intensity) * 0.3;
        const stretch = 1.45 - (1 - intensity) * 0.2;
        const sx = axis === 'x' ? compression : stretch;
        const sy = axis === 'y' ? compression : stretch;
        this.tweens.killTweensOf([this.ball, this.ballGlow]);
        this.tweens.add({
            targets: [this.ball, this.ballGlow],
            scaleX: sx,
            scaleY: sy,
            duration: 55,
            yoyo: true,
            ease: 'Quint.easeOut',
            onComplete: () => {
                this.ball.setScale(1);
                this.ballGlow.setScale(1);
            },
        });
    }

    private cleanup() {
        this.unmountExit?.();
        this.unmountExit = undefined;
    }
}
