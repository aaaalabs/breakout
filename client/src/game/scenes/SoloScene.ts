// SoloScene — single-player Breakout. Pure local simulation, no server.
// Supports N balls (multi-ball power-up) and falling power-up pickups.

import { Scene } from 'phaser';
import {
    ARENA_W,
    ARENA_H,
    BALL_RADIUS,
    BALL_INITIAL_SPEED,
    BALL_MAX_SPEED,
    BALL_SPEED_INCREMENT_PER_HIT,
    BALL_SPEED_HITS_TO_RAMP,
    BRICK_COLS,
    BRICK_GAP,
    BRICK_H,
    BRICK_ROWS_PER_PLAYER,
    BRICK_W,
    COLORS,
    PADDLE_H,
    PADDLE_MAX_DEFLECT_ANGLE,
    PADDLE_W,
    THUMB_ZONE,
} from '@breakout/shared';
import { THEME } from '../../ui/theme';
import { sfx } from '../../audio/Sfx';
import { ComboMeter } from '../ComboMeter';

const SOLO_ROWS = BRICK_ROWS_PER_PLAYER * 2;
const PADDLE_Y_SOLO = ARENA_H - THUMB_ZONE - PADDLE_H / 2 - 20;
const STARTING_LIVES = 3;

const POWERUP_DROP_CHANCE = 0.10;        // base chance per non-iron brick
const IRON_POWERUP_DROP_CHANCE = 0.30;   // higher chance for iron (risk → reward)
const POWERUP_FALL_SPEED = 220;          // px/s

interface Brick {
    x: number; y: number;
    alive: boolean;
    sprite: Phaser.GameObjects.Rectangle;
    color: number;
    hp: number; maxHp: number;
}

interface BallEntity {
    x: number; y: number; vx: number; vy: number;
    onPaddle: boolean;        // true only for the very first ball before launch
    sprite: Phaser.GameObjects.Arc;
    glow: Phaser.GameObjects.Arc;
}

type PowerUpType = 'multi-ball' | 'long-paddle' | 'slow-mo';

interface PowerUp {
    type: PowerUpType;
    x: number; y: number;
    container: Phaser.GameObjects.Container;
}

const POWERUP_VISUAL: Record<PowerUpType, { emoji: string; color: number; label: string }> = {
    'multi-ball':  { emoji: '⚡', color: 0xffd166, label: 'MULTI-BALL'  },
    'long-paddle': { emoji: '📏', color: 0x00f0f0, label: 'LONG PADDLE' },
    'slow-mo':     { emoji: '🕒', color: 0x9d8df1, label: 'SLOW MOTION' },
};

// Weighted drop pool — each type's slice of the pie
const POWERUP_POOL: PowerUpType[] = [
    'multi-ball', 'multi-ball', 'multi-ball',           // 30%
    'long-paddle', 'long-paddle', 'long-paddle', 'long-paddle', // 40%
    'slow-mo', 'slow-mo', 'slow-mo',                    // 30%
];

const LONG_PADDLE_DURATION_MS = 15_000;
const LONG_PADDLE_WIDTH_MULT = 1.6;
const SLOW_MO_DURATION_MS = 5_000;
const SLOW_MO_FACTOR = 0.5;

interface ActiveEffect {
    type: PowerUpType;
    expiresAt: number;
}

export class SoloScene extends Scene {
    private bgLayer!: Phaser.GameObjects.Container;
    private brickLayer!: Phaser.GameObjects.Container;
    private playLayer!: Phaser.GameObjects.Container;
    private hudLayer!: Phaser.GameObjects.Container;

    private paddle!: Phaser.GameObjects.Rectangle;
    private bricks: Brick[] = [];
    private aliveCount = 0;
    private lives = STARTING_LIVES;
    private score = 0;
    private speedTier = 0;
    private finished = false;

    private balls: BallEntity[] = [];
    private powerUps: PowerUp[] = [];
    private activeEffects: ActiveEffect[] = [];
    private effectIcons = new Map<PowerUpType, { container: Phaser.GameObjects.Container; bar: Phaser.GameObjects.Rectangle; }>();

    private hudScore!: Phaser.GameObjects.Text;
    private hudLives!: Phaser.GameObjects.Text;
    private hudHint!: Phaser.GameObjects.Text;
    private combo!: ComboMeter;

    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    private keyA?: Phaser.Input.Keyboard.Key;
    private keyD?: Phaser.Input.Keyboard.Key;
    private kbPaddleX: number | null = null;
    private particleKey = 'spark-solo';
    private freezeUntil = 0;

    constructor() { super({ key: 'SoloScene' }); }

    create() {
        this.cameras.main.setBackgroundColor(`#${COLORS.bg.toString(16).padStart(6, '0')}`);
        this.bgLayer = this.add.container(0, 0);
        this.brickLayer = this.add.container(0, 0);
        this.playLayer = this.add.container(0, 0);
        this.hudLayer = this.add.container(0, 0);

        this.buildBackground();
        this.buildHud();
        this.buildParticleTexture();
        this.buildBricks();
        this.buildPaddle();
        this.spawnBall(true); // initial sticky ball

        this.combo = new ComboMeter(this, { x: ARENA_W / 2, y: 64, layer: this.hudLayer });

        const containers = [this.bgLayer, this.brickLayer, this.playLayer, this.hudLayer];
        containers.forEach((c) => c.setY(40));
        this.tweens.add({
            targets: containers,
            y: 0, alpha: { from: 0, to: 1 },
            duration: THEME.dur.long, ease: THEME.ease.out,
        });

        this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.handlePointer(p));
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            sfx.unlock();
            this.handlePointer(p);
            this.tryLaunchAll();
        });
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
            this.keyA = this.input.keyboard.addKey('A');
            this.keyD = this.input.keyboard.addKey('D');
            this.input.keyboard.on('keydown-SPACE', () => { sfx.unlock(); this.tryLaunchAll(); });
            this.input.keyboard.on('keydown-ESC', () => this.exit());
        }

        this.time.delayedCall(220, () => sfx.soloStart());

        this.events.once('shutdown', () => this.cleanup());
        this.events.once('destroy', () => this.cleanup());
    }

    update(time: number, deltaMs: number) {
        const dt = Math.min(0.05, deltaMs / 1000);
        this.combo?.tick(time);
        this.updateActiveEffects(time);
        const frozen = time < this.freezeUntil;

        // Keyboard movement (clamp respects current paddle width with long-paddle)
        const left = this.cursors?.left.isDown || this.keyA?.isDown;
        const right = this.cursors?.right.isDown || this.keyD?.isDown;
        if (left || right) {
            const speed = 980;
            const halfW = (PADDLE_W * this.paddle.scaleX) / 2;
            const cur = this.kbPaddleX ?? this.paddle.x;
            const dir = (right ? 1 : 0) - (left ? 1 : 0);
            const next = Math.max(halfW, Math.min(ARENA_W - halfW, cur + dir * speed * dt));
            this.kbPaddleX = next;
            this.paddle.x = next;
        }

        if (this.finished) return;

        // Step every ball
        for (const b of this.balls) {
            if (b.onPaddle) {
                b.x = this.paddle.x;
                b.y = PADDLE_Y_SOLO - PADDLE_H / 2 - BALL_RADIUS - 4;
            } else if (!frozen) {
                this.stepBall(b, dt);
            }
            b.sprite.setPosition(b.x, b.y);
            b.glow.setPosition(b.x, b.y);
        }

        // Step power-ups (gravity)
        if (!frozen) {
            for (let i = this.powerUps.length - 1; i >= 0; i--) {
                const pu = this.powerUps[i];
                pu.y += POWERUP_FALL_SPEED * dt;
                pu.container.y = pu.y;
                // Caught by paddle?
                if (
                    pu.y > PADDLE_Y_SOLO - PADDLE_H / 2 - 18 &&
                    pu.y < PADDLE_Y_SOLO + PADDLE_H / 2 + 18 &&
                    Math.abs(pu.x - this.paddle.x) < PADDLE_W / 2 + 16
                ) {
                    this.applyPowerUp(pu.type);
                    this.removePowerUp(i);
                } else if (pu.y > ARENA_H + 40) {
                    this.removePowerUp(i);
                }
            }
        }

        // Remove balls that dropped (below bottom)
        for (let i = this.balls.length - 1; i >= 0; i--) {
            const b = this.balls[i];
            if (!b.onPaddle && b.y - BALL_RADIUS > ARENA_H) {
                b.sprite.destroy();
                b.glow.destroy();
                this.balls.splice(i, 1);
            }
        }

        // Out of balls = lose a life
        if (this.balls.length === 0 && !this.finished) {
            this.loseLife();
        }
    }

    // ---- Sim ----------------------------------------------------------

    private stepBall(b: BallEntity, dt: number) {
        const SUBSTEPS = 4;
        const sub = dt / SUBSTEPS;
        for (let i = 0; i < SUBSTEPS; i++) {
            this.stepBallOnce(b, sub);
        }
    }

    private stepBallOnce(b: BallEntity, dt: number) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        if (b.x - BALL_RADIUS < 0) { b.x = BALL_RADIUS; b.vx = Math.abs(b.vx); sfx.wallHit(); this.squashBall(b, 'x', 0.6); }
        if (b.x + BALL_RADIUS > ARENA_W) { b.x = ARENA_W - BALL_RADIUS; b.vx = -Math.abs(b.vx); sfx.wallHit(); this.squashBall(b, 'x', 0.6); }
        if (b.y - BALL_RADIUS < 0) { b.y = BALL_RADIUS; b.vy = Math.abs(b.vy); sfx.wallHit(); this.squashBall(b, 'y', 0.6); }

        // Below paddle = ball dropped (handled by main update loop)
        if (b.y - BALL_RADIUS > ARENA_H) return;

        // Paddle collision (paddle width adjusts via scaleX during long-paddle effect)
        const halfW = (PADDLE_W * this.paddle.scaleX) / 2;
        const halfH = PADDLE_H / 2;
        const dx = b.x - this.paddle.x;
        const dy = b.y - PADDLE_Y_SOLO;
        if (Math.abs(dx) <= halfW + BALL_RADIUS && Math.abs(dy) <= halfH + BALL_RADIUS && b.vy > 0) {
            const contact = Math.max(-1, Math.min(1, dx / halfW));
            const angle = contact * PADDLE_MAX_DEFLECT_ANGLE;
            const speed = Math.hypot(b.vx, b.vy);
            b.vx = Math.sin(angle) * speed;
            b.vy = -Math.abs(Math.cos(angle) * speed);
            b.y = PADDLE_Y_SOLO - halfH - BALL_RADIUS - 0.5;
            this.cameras.main.shake(80, 0.0015 + Math.abs(contact) * 0.003);
            sfx.paddleHit(Math.abs(contact));
            this.squashBall(b, 'y');
            const wasClose = (PADDLE_Y_SOLO - b.y) < 70;
            if (wasClose) this.freezeUntil = this.scene.systems.game.loop.time + 70;
        }

        // Brick collisions
        for (const brick of this.bricks) {
            if (!brick.alive) continue;
            const bdx = b.x - brick.x;
            const bdy = b.y - brick.y;
            const bhW = BRICK_W / 2;
            const bhH = BRICK_H / 2;
            if (Math.abs(bdx) > bhW + BALL_RADIUS) continue;
            if (Math.abs(bdy) > bhH + BALL_RADIUS) continue;

            const overlapX = bhW + BALL_RADIUS - Math.abs(bdx);
            const overlapY = bhH + BALL_RADIUS - Math.abs(bdy);
            if (overlapX < overlapY) {
                b.vx = bdx > 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
                b.x += bdx > 0 ? overlapX : -overlapX;
            } else {
                b.vy = bdy > 0 ? Math.abs(b.vy) : -Math.abs(b.vy);
                b.y += bdy > 0 ? overlapY : -overlapY;
            }
            brick.hp -= 1;
            if (brick.hp > 0) this.damageBrick(brick);
            else this.killBrick(brick);
            return;
        }
    }

    private damageBrick(brick: Brick) {
        sfx.wallHit();
        if (this.balls[0]) this.squashBall(this.balls[0], 'y', 0.5);
        brick.sprite.setFillStyle(COLORS.ironBrickHurt, 0.92);
        brick.sprite.setStrokeStyle(1, COLORS.ironBrickHurt, 0.8);
        const ox = brick.sprite.x;
        this.tweens.killTweensOf(brick.sprite);
        this.tweens.add({
            targets: brick.sprite,
            x: { from: ox - 2, to: ox + 2 },
            duration: 40, yoyo: true, repeat: 1,
            ease: 'Sine.easeInOut',
            onComplete: () => brick.sprite.setX(ox),
        });
    }

    private killBrick(brick: Brick) {
        brick.alive = false;
        this.aliveCount--;
        const result = this.combo.register(this.time.now);
        this.score += 10 + result.bonus;
        this.hudScore.setText(`${this.score}`);
        sfx.brickBreak();
        sfx.maybeCombo();
        if (this.balls[0]) this.squashBall(this.balls[0], 'y', 0.5);
        if (this.aliveCount === 0) this.freezeUntil = this.time.now + 140;
        else if (result.tier >= 4) this.freezeUntil = this.time.now + 50;

        // Visual destroy
        const x = brick.x, y = brick.y, color = brick.color;
        const flash = this.add.image(x, y, this.particleKey).setScale(2.6).setTint(0xffffff).setAlpha(0.95);
        this.playLayer.add(flash);
        this.tweens.add({ targets: flash, alpha: 0, scale: 1, duration: 140, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
        this.tweens.add({
            targets: brick.sprite,
            scale: 0, alpha: 0,
            duration: 200, ease: THEME.ease.in,
            onComplete: () => brick.sprite.destroy(),
        });
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.3;
            const dist = 26 + Math.random() * 14;
            const p = this.add.image(x, y, this.particleKey).setTint(color).setScale(0.9 + Math.random() * 0.4);
            this.playLayer.add(p);
            this.tweens.add({
                targets: p,
                x: x + Math.cos(angle) * dist,
                y: y + Math.sin(angle) * dist,
                alpha: 0, scale: 0.1,
                duration: 380 + Math.random() * 80,
                ease: THEME.ease.out,
                onComplete: () => p.destroy(),
            });
        }

        // Speed ramp
        const totalKilled = this.bricks.length - this.aliveCount;
        const newTier = Math.floor(totalKilled / BALL_SPEED_HITS_TO_RAMP);
        if (newTier > this.speedTier) {
            this.speedTier = newTier;
            const target = Math.min(BALL_MAX_SPEED, BALL_INITIAL_SPEED * Math.pow(BALL_SPEED_INCREMENT_PER_HIT, newTier));
            for (const ball of this.balls) {
                const cur = Math.hypot(ball.vx, ball.vy);
                if (cur > 0) { const k = target / cur; ball.vx *= k; ball.vy *= k; }
            }
        }

        // Power-up drop — pick weighted random type from pool
        const dropChance = brick.maxHp >= 2 ? IRON_POWERUP_DROP_CHANCE : POWERUP_DROP_CHANCE;
        if (Math.random() < dropChance) {
            const type = POWERUP_POOL[Math.floor(Math.random() * POWERUP_POOL.length)];
            this.spawnPowerUp(x, y, type);
        }

        if (this.aliveCount === 0) this.win();
    }

    // ---- Balls --------------------------------------------------------

    private spawnBall(onPaddle: boolean, x?: number, y?: number, vx?: number, vy?: number): BallEntity {
        const sx = x ?? this.paddle?.x ?? ARENA_W / 2;
        const sy = y ?? PADDLE_Y_SOLO - 30;
        const glow = this.add.circle(sx, sy, BALL_RADIUS + 6, COLORS.ball, 0.18);
        const sprite = this.add.circle(sx, sy, BALL_RADIUS, COLORS.ball, 1);
        this.playLayer.add([glow, sprite]);
        const b: BallEntity = { x: sx, y: sy, vx: vx ?? 0, vy: vy ?? 0, onPaddle, sprite, glow };
        this.balls.push(b);
        return b;
    }

    private tryLaunchAll() {
        let launched = false;
        for (const b of this.balls) {
            if (b.onPaddle) {
                const angle = (Math.random() - 0.5) * 0.6;
                const speed = BALL_INITIAL_SPEED;
                b.vx = Math.sin(angle) * speed;
                b.vy = -Math.cos(angle) * speed;
                b.onPaddle = false;
                launched = true;
            }
        }
        if (launched) {
            sfx.launch();
            this.hudHint.setText('');
        }
    }

    // ---- Power-ups ----------------------------------------------------

    private spawnPowerUp(x: number, y: number, type: PowerUpType) {
        const visual = POWERUP_VISUAL[type];
        const container = this.add.container(x, y);
        const bg = this.add.circle(0, 0, 18, visual.color, 0.16);
        const ring = this.add.circle(0, 0, 18, visual.color, 0).setStrokeStyle(2, visual.color, 0.9);
        const icon = this.add.text(0, 1, visual.emoji, {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '22px',
        }).setOrigin(0.5);
        container.add([bg, ring, icon]);
        this.playLayer.add(container);
        // Bob/pulse
        this.tweens.add({
            targets: ring,
            scaleX: 1.18, scaleY: 1.18,
            duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        this.powerUps.push({ type, x, y, container });
    }

    private removePowerUp(idx: number) {
        const pu = this.powerUps[idx];
        pu.container.destroy();
        this.powerUps.splice(idx, 1);
    }

    private applyPowerUp(type: PowerUpType) {
        sfx.playSample('combo', { volume: 0.5 });
        this.flashPickupBanner(POWERUP_VISUAL[type].emoji + '  ' + POWERUP_VISUAL[type].label);
        if (type === 'multi-ball') {
            this.spawnExtraBalls();
        } else if (type === 'long-paddle') {
            this.refreshEffect('long-paddle', LONG_PADDLE_DURATION_MS);
            this.applyLongPaddle();
        } else if (type === 'slow-mo') {
            this.refreshEffect('slow-mo', SLOW_MO_DURATION_MS);
            this.applySlowMo();
        }
    }

    /** Add or refresh a timed effect. Renders an indicator. */
    private refreshEffect(type: PowerUpType, durationMs: number) {
        const expiresAt = this.time.now + durationMs;
        const existing = this.activeEffects.find((e) => e.type === type);
        if (existing) {
            existing.expiresAt = expiresAt;
        } else {
            this.activeEffects.push({ type, expiresAt });
            this.spawnEffectIcon(type, durationMs);
        }
    }

    private applyLongPaddle() {
        const targetWidth = PADDLE_W * LONG_PADDLE_WIDTH_MULT;
        this.tweens.add({
            targets: this.paddle,
            scaleX: targetWidth / PADDLE_W,
            duration: 220,
            ease: 'Back.easeOut',
        });
    }

    private removeLongPaddle() {
        this.tweens.add({
            targets: this.paddle,
            scaleX: 1,
            duration: 320,
            ease: 'Cubic.easeInOut',
        });
    }

    private applySlowMo() {
        // Multiply all current ball velocities. New balls (e.g. multi-ball spawn
        // during slow-mo) inherit the slowed speed naturally because the speed
        // ramp uses absolute targets — no additional scaling needed.
        for (const b of this.balls) { b.vx *= SLOW_MO_FACTOR; b.vy *= SLOW_MO_FACTOR; }
    }

    private removeSlowMo() {
        const inv = 1 / SLOW_MO_FACTOR;
        for (const b of this.balls) { b.vx *= inv; b.vy *= inv; }
    }

    private updateActiveEffects(now: number) {
        for (let i = this.activeEffects.length - 1; i >= 0; i--) {
            const eff = this.activeEffects[i];
            const remaining = eff.expiresAt - now;
            const slot = this.effectIcons.get(eff.type);
            if (slot) {
                // Update countdown bar (right→left fill)
                const total = eff.type === 'long-paddle' ? LONG_PADDLE_DURATION_MS : SLOW_MO_DURATION_MS;
                const ratio = Math.max(0, remaining / total);
                slot.bar.setScale(ratio, 1);
            }
            if (remaining <= 0) {
                if (eff.type === 'long-paddle') this.removeLongPaddle();
                else if (eff.type === 'slow-mo') this.removeSlowMo();
                this.removeEffectIcon(eff.type);
                this.activeEffects.splice(i, 1);
            }
        }
    }

    private spawnEffectIcon(type: PowerUpType, _durationMs: number) {
        const visual = POWERUP_VISUAL[type];
        const yBase = ARENA_H - THUMB_ZONE - 28;
        const slotIdx = this.effectIcons.size;
        const x = ARENA_W / 2 - 80 + slotIdx * 80;

        const container = this.add.container(x, yBase);
        const bg = this.add.rectangle(0, 0, 64, 28, 0x13131f, 0.85).setStrokeStyle(1, visual.color, 0.6);
        const icon = this.add.text(-18, 1, visual.emoji, {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '14px',
        }).setOrigin(0.5);
        const bar = this.add.rectangle(-30, 11, 60, 2, visual.color, 0.85).setOrigin(0, 0.5);
        const label = this.add.text(8, 1, type === 'long-paddle' ? 'LONG' : 'SLOW', {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '9px', color: `#${visual.color.toString(16).padStart(6, '0')}`,
            fontStyle: '700',
        }).setOrigin(0.5);
        label.setLetterSpacing(1.5);
        container.add([bg, icon, label, bar]);
        container.setAlpha(0).setScale(0.85);
        this.hudLayer.add(container);
        this.tweens.add({ targets: container, alpha: 1, scale: 1, duration: 240, ease: 'Back.easeOut' });
        this.effectIcons.set(type, { container, bar });
    }

    private removeEffectIcon(type: PowerUpType) {
        const slot = this.effectIcons.get(type);
        if (!slot) return;
        this.tweens.add({
            targets: slot.container,
            alpha: 0, scale: 0.85,
            duration: 200, ease: 'Cubic.easeIn',
            onComplete: () => slot.container.destroy(),
        });
        this.effectIcons.delete(type);
    }

    private spawnExtraBalls() {
        if (this.balls.length === 0) return;
        // Use the first non-stuck ball as the source; if all stuck, launch all + spawn from ball[0] center
        let source = this.balls.find((b) => !b.onPaddle) ?? this.balls[0];
        if (source.onPaddle) {
            this.tryLaunchAll();
            source = this.balls[0];
        }
        const speed = Math.max(BALL_INITIAL_SPEED, Math.hypot(source.vx, source.vy));
        const baseAngle = Math.atan2(source.vy, source.vx);
        for (let i = 0; i < 2; i++) {
            const offset = i === 0 ? -0.5 : 0.5;
            const a = baseAngle + offset;
            this.spawnBall(false, source.x, source.y, Math.cos(a) * speed, Math.sin(a) * speed);
        }
    }

    private flashPickupBanner(text: string) {
        const t = this.add.text(ARENA_W / 2, ARENA_H / 2 - 100, text, {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '26px', fontStyle: '800',
            color: '#ffd166',
        }).setOrigin(0.5).setAlpha(0).setScale(0.7);
        t.setLetterSpacing(3);
        this.hudLayer.add(t);
        this.tweens.add({ targets: t, alpha: 1, scale: 1.0, duration: 200, ease: 'Back.easeOut' });
        this.tweens.add({
            targets: t, alpha: 0, y: t.y - 24,
            duration: 700, delay: 700, ease: 'Cubic.easeIn',
            onComplete: () => t.destroy(),
        });
    }

    // ---- Squash ------------------------------------------------------

    private squashBall(b: BallEntity, axis: 'x' | 'y', intensity = 1) {
        const compression = 0.55 + (1 - intensity) * 0.3;
        const stretch = 1.45 - (1 - intensity) * 0.2;
        const sx = axis === 'x' ? compression : stretch;
        const sy = axis === 'y' ? compression : stretch;
        this.tweens.killTweensOf([b.sprite, b.glow]);
        this.tweens.add({
            targets: [b.sprite, b.glow],
            scaleX: sx, scaleY: sy,
            duration: 55, yoyo: true, ease: 'Quint.easeOut',
            onComplete: () => { b.sprite.setScale(1); b.glow.setScale(1); },
        });
    }

    // ---- Game state --------------------------------------------------

    private loseLife() {
        this.lives -= 1;
        this.hudLives.setText('●'.repeat(this.lives) + '○'.repeat(STARTING_LIVES - this.lives));
        sfx.loseLife();
        if (this.lives <= 0) { this.lose(); return; }
        // Drop all power-ups in flight (they'd be confusing on respawn)
        while (this.powerUps.length > 0) this.removePowerUp(0);
        // Respawn one ball stuck on paddle
        this.spawnBall(true);
        this.cameras.main.flash(160, 30, 30, 30);
        this.hudHint.setText('👆 tap or SPACE to launch');
    }

    private win() {
        this.finished = true;
        this.hudHint.setText('');
        this.cameras.main.flash(220, 0, 240, 240);
        sfx.win();
        this.showResult('🏆  YOU CLEARED THE WALL!', `${this.score} POINTS · ${this.lives} LIVES LEFT`);
    }

    private lose() {
        this.finished = true;
        this.cameras.main.flash(220, 240, 60, 60);
        sfx.lose();
        this.showResult('💔  THE WALL HELD.', `${this.score} POINTS · ${this.bricks.length - this.aliveCount} BRICKS BROKEN`);
    }

    private showResult(headline: string, subline: string) {
        const dim = this.add.rectangle(ARENA_W / 2, ARENA_H / 2, ARENA_W, ARENA_H, 0x0a0a14, 0.55);
        this.hudLayer.add(dim);
        const head = this.add.text(ARENA_W / 2, ARENA_H / 2 - 36, headline, {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '40px', fontStyle: '800', color: '#e8e8f4', align: 'center',
        }).setOrigin(0.5).setAlpha(0).setScale(1.18);
        head.setLetterSpacing(4);
        this.hudLayer.add(head);
        this.tweens.add({ targets: head, alpha: 1, scale: 1, duration: 520, ease: 'Quint.easeOut' });
        const sub = this.add.text(ARENA_W / 2, ARENA_H / 2 + 14, subline, {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '14px', color: '#9292b0', align: 'center',
        }).setOrigin(0.5).setAlpha(0);
        sub.setLetterSpacing(2);
        this.hudLayer.add(sub);
        this.tweens.add({ targets: sub, alpha: 1, duration: 480, delay: 180, ease: 'Cubic.easeOut' });

        const overlay = document.getElementById('ui-overlay')!;
        const actions = document.createElement('div');
        actions.className = 'end-actions';
        actions.innerHTML = `
            <button class="end-btn end-btn--primary" data-action="again">PLAY AGAIN</button>
            <button class="end-btn" data-action="back">BACK TO LOBBY</button>
        `;
        overlay.appendChild(actions);
        requestAnimationFrame(() => actions.classList.add('is-visible'));
        actions.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('button');
            if (!btn) return;
            const a = btn.getAttribute('data-action');
            actions.remove();
            if (a === 'again') this.scene.restart();
            else this.exit();
        });
        this.events.once('shutdown', () => actions.remove());
    }

    private exit() { this.scene.start('LobbyScene'); }

    // ---- Builders -----------------------------------------------------

    private buildBackground() {
        const bg = this.add.rectangle(ARENA_W / 2, ARENA_H / 2, ARENA_W, ARENA_H, COLORS.arena);
        bg.setStrokeStyle(1, COLORS.arenaLine, 1);
        this.bgLayer.add(bg);
        const len = 18;
        const bracket = (cx: number, cy: number, sx: number, sy: number) => {
            const g = this.add.graphics();
            g.lineStyle(1, COLORS.arenaLine, 1);
            g.beginPath();
            g.moveTo(cx + len * sx, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + len * sy);
            g.strokePath();
            this.bgLayer.add(g);
        };
        bracket(2, 2, 1, 1);
        bracket(ARENA_W - 2, 2, -1, 1);
        bracket(2, ARENA_H - 2, 1, -1);
        bracket(ARENA_W - 2, ARENA_H - 2, -1, -1);
    }

    private buildHud() {
        this.hudScore = this.add.text(24, 24, '0', {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '24px', color: '#e8e8f4', fontStyle: '800',
        }).setOrigin(0, 0);
        this.hudScore.setLetterSpacing(2);
        this.hudLayer.add(this.hudScore);

        this.hudLives = this.add.text(ARENA_W - 24, 24, '●●●', {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '20px', color: `#${COLORS.p1.toString(16)}`,
        }).setOrigin(1, 0);
        this.hudLives.setLetterSpacing(4);
        this.hudLayer.add(this.hudLives);

        this.hudHint = this.add.text(ARENA_W / 2, ARENA_H - 28, 'Tap, drag, or arrow keys · SPACE to launch · ESC for lobby', {
            fontFamily: '"SF Pro Display", -apple-system, sans-serif',
            fontSize: '11px', color: '#6c6c8a',
        }).setOrigin(0.5);
        this.hudHint.setLetterSpacing(2);
        this.hudLayer.add(this.hudHint);
    }

    private buildParticleTexture() {
        if (this.textures.exists(this.particleKey)) return;
        const g = this.add.graphics();
        g.fillStyle(0xffffff, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture(this.particleKey, 8, 8);
        g.destroy();
    }

    private buildBricks() {
        this.bricks = [];
        const yStart = 80;
        const ironRows = new Set([3, 4]);
        for (let row = 0; row < SOLO_ROWS; row++) {
            const ratio = row / (SOLO_ROWS - 1);
            const isIron = ironRows.has(row);
            const color = isIron ? COLORS.ironBrick : (ratio < 0.5 ? COLORS.p1Brick : COLORS.p2Brick);
            for (let col = 0; col < BRICK_COLS; col++) {
                const x = BRICK_GAP + col * (BRICK_W + BRICK_GAP) + BRICK_W / 2;
                const y = yStart + row * (BRICK_H + BRICK_GAP) + BRICK_H / 2;
                const sprite = this.add.rectangle(x, y, BRICK_W, BRICK_H, color, 0.92);
                sprite.setStrokeStyle(1, color, 0.6);
                this.brickLayer.add(sprite);
                this.bricks.push({ x, y, alive: true, sprite, color, hp: isIron ? 2 : 1, maxHp: isIron ? 2 : 1 });
            }
        }
        this.aliveCount = this.bricks.length;
    }

    private buildPaddle() {
        this.paddle = this.add.rectangle(ARENA_W / 2, PADDLE_Y_SOLO, PADDLE_W, PADDLE_H, COLORS.p1, 0.96);
        this.paddle.setStrokeStyle(1, COLORS.p1, 0.4);
        this.playLayer.add(this.paddle);
        this.hudHint.setText('👆 tap or SPACE to launch');
    }

    private handlePointer(pointer: Phaser.Input.Pointer) {
        const halfW = (PADDLE_W * this.paddle.scaleX) / 2;
        const x = Math.max(halfW, Math.min(ARENA_W - halfW, pointer.worldX));
        this.paddle.x = x;
        this.kbPaddleX = x;
    }

    private cleanup() {
        document.querySelectorAll('.end-actions').forEach((el) => el.remove());
    }
}
