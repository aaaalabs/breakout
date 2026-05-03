// SoloScene — single-player Breakout. Pure local simulation, no server.
// Classic loop: paddle at bottom, ball ricochets, full brick wall above.
// Lose ball → -1 life. All bricks gone → win. Lives = 3.

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
} from '@breakout/shared';
import { THEME } from '../../ui/theme';

const SOLO_ROWS = BRICK_ROWS_PER_PLAYER * 2; // double the wall vs vs-mode (8 rows)
const PADDLE_Y_SOLO = ARENA_H - 60;
const STARTING_LIVES = 3;

interface Brick {
    x: number;
    y: number;
    alive: boolean;
    sprite: Phaser.GameObjects.Rectangle;
    color: number;
}

interface BallState {
    x: number;
    y: number;
    vx: number;
    vy: number;
    onPaddle: boolean;
}

export class SoloScene extends Scene {
    private bgLayer!: Phaser.GameObjects.Container;
    private brickLayer!: Phaser.GameObjects.Container;
    private playLayer!: Phaser.GameObjects.Container;
    private hudLayer!: Phaser.GameObjects.Container;

    private paddle!: Phaser.GameObjects.Rectangle;
    private ball!: Phaser.GameObjects.Arc;
    private ballGlow!: Phaser.GameObjects.Arc;

    private bricks: Brick[] = [];
    private aliveCount = 0;
    private lives = STARTING_LIVES;
    private score = 0;
    private speedTier = 0;
    private ballState: BallState = { x: 0, y: 0, vx: 0, vy: 0, onPaddle: true };
    private finished = false;

    private hudScore!: Phaser.GameObjects.Text;
    private hudLives!: Phaser.GameObjects.Text;
    private hudHint!: Phaser.GameObjects.Text;

    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    private keyA?: Phaser.Input.Keyboard.Key;
    private keyD?: Phaser.Input.Keyboard.Key;
    private kbPaddleX: number | null = null;
    private particleKey = 'spark-solo';

    constructor() {
        super({ key: 'SoloScene' });
    }

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
        this.buildPaddleAndBall();

        // Slide-in entrance
        const containers = [this.bgLayer, this.brickLayer, this.playLayer, this.hudLayer];
        containers.forEach((c) => c.setY(40));
        this.tweens.add({
            targets: containers,
            y: 0,
            alpha: { from: 0, to: 1 },
            duration: THEME.dur.long,
            ease: THEME.ease.out,
        });

        // Input
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.handlePointer(p));
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            this.handlePointer(p);
            if (this.ballState.onPaddle) this.launchBall();
        });
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
            this.keyA = this.input.keyboard.addKey('A');
            this.keyD = this.input.keyboard.addKey('D');
            this.input.keyboard.on('keydown-SPACE', () => {
                if (this.ballState.onPaddle) this.launchBall();
            });
            this.input.keyboard.on('keydown-ESC', () => this.exit());
        }

        this.events.once('shutdown', () => this.cleanup());
        this.events.once('destroy', () => this.cleanup());
    }

    update(_time: number, deltaMs: number) {
        const dt = Math.min(0.05, deltaMs / 1000);

        // Keyboard movement
        const left = this.cursors?.left.isDown || this.keyA?.isDown;
        const right = this.cursors?.right.isDown || this.keyD?.isDown;
        if (left || right) {
            const speed = 980;
            const cur = this.kbPaddleX ?? this.paddle.x;
            const dir = (right ? 1 : 0) - (left ? 1 : 0);
            const next = Math.max(PADDLE_W / 2, Math.min(ARENA_W - PADDLE_W / 2, cur + dir * speed * dt));
            this.kbPaddleX = next;
            this.paddle.x = next;
        }

        if (this.finished) return;

        if (this.ballState.onPaddle) {
            this.ballState.x = this.paddle.x;
            this.ballState.y = PADDLE_Y_SOLO - PADDLE_H / 2 - BALL_RADIUS - 4;
        } else {
            this.stepBall(dt);
        }

        this.ball.setPosition(this.ballState.x, this.ballState.y);
        this.ballGlow.setPosition(this.ballState.x, this.ballState.y);
    }

    // ---- Sim ----------------------------------------------------------

    private stepBall(dt: number) {
        const SUBSTEPS = 4;
        const sub = dt / SUBSTEPS;
        for (let i = 0; i < SUBSTEPS; i++) {
            if (this.stepBallOnce(sub)) break;
        }
    }

    private stepBallOnce(dt: number): boolean {
        const b = this.ballState;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        if (b.x - BALL_RADIUS < 0) { b.x = BALL_RADIUS; b.vx = Math.abs(b.vx); }
        if (b.x + BALL_RADIUS > ARENA_W) { b.x = ARENA_W - BALL_RADIUS; b.vx = -Math.abs(b.vx); }
        if (b.y - BALL_RADIUS < 0) { b.y = BALL_RADIUS; b.vy = Math.abs(b.vy); }

        // Ball drops below paddle = lose a life
        if (b.y - BALL_RADIUS > ARENA_H) {
            this.loseLife();
            return true;
        }

        // Paddle
        const halfW = PADDLE_W / 2;
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
        }

        // Bricks
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
            this.killBrick(brick);
            return false;
        }
        return false;
    }

    private killBrick(brick: Brick) {
        brick.alive = false;
        this.aliveCount--;
        this.score += 10;
        this.hudScore.setText(`${this.score}`);

        // Visual: white flash, scale-down, particle burst
        const x = brick.x;
        const y = brick.y;
        const color = brick.color;
        const flash = this.add.image(x, y, this.particleKey).setScale(2.6).setTint(0xffffff).setAlpha(0.95);
        this.playLayer.add(flash);
        this.tweens.add({ targets: flash, alpha: 0, scale: 1, duration: 140, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });

        this.tweens.add({
            targets: brick.sprite,
            scale: 0,
            alpha: 0,
            duration: 200,
            ease: THEME.ease.in,
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
                alpha: 0,
                scale: 0.1,
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
            const cur = Math.hypot(this.ballState.vx, this.ballState.vy);
            if (cur > 0) {
                const k = target / cur;
                this.ballState.vx *= k;
                this.ballState.vy *= k;
            }
        }

        if (this.aliveCount === 0) this.win();
    }

    private launchBall() {
        const speed = BALL_INITIAL_SPEED;
        const angle = (Math.random() - 0.5) * 0.6;
        this.ballState.vx = Math.sin(angle) * speed;
        this.ballState.vy = -Math.cos(angle) * speed;
        this.ballState.onPaddle = false;
        this.hudHint.setText('');
    }

    private loseLife() {
        this.lives -= 1;
        this.hudLives.setText('●'.repeat(this.lives) + '○'.repeat(STARTING_LIVES - this.lives));
        if (this.lives <= 0) {
            this.lose();
            return;
        }
        this.ballState.onPaddle = true;
        this.ballState.vx = 0;
        this.ballState.vy = 0;
        this.cameras.main.flash(160, 30, 30, 30);
        this.hudHint.setText('Tap or SPACE to launch');
    }

    private win() {
        this.finished = true;
        this.hudHint.setText('');
        this.cameras.main.flash(220, 0, 240, 240);
        this.showResult('YOU CLEARED THE WALL.', `${this.score} POINTS · ${this.lives} LIVES LEFT`);
    }

    private lose() {
        this.finished = true;
        this.ballState.onPaddle = true;
        this.cameras.main.flash(220, 240, 60, 60);
        this.showResult('THE WALL HELD.', `${this.score} POINTS · ${this.bricks.length - this.aliveCount} BRICKS BROKEN`);
    }

    private showResult(headline: string, subline: string) {
        const dim = this.add.rectangle(ARENA_W / 2, ARENA_H / 2, ARENA_W, ARENA_H, 0x0a0a14, 0.55);
        this.hudLayer.add(dim);

        const head = this.add
            .text(ARENA_W / 2, ARENA_H / 2 - 36, headline, {
                fontFamily: '"SF Pro Display", -apple-system, sans-serif',
                fontSize: '40px',
                fontStyle: '800',
                color: '#e8e8f4',
                align: 'center',
            })
            .setOrigin(0.5)
            .setAlpha(0)
            .setScale(1.18);
        head.setLetterSpacing(4);
        this.hudLayer.add(head);
        this.tweens.add({ targets: head, alpha: 1, scale: 1, duration: 520, ease: 'Quint.easeOut' });

        const sub = this.add
            .text(ARENA_W / 2, ARENA_H / 2 + 14, subline, {
                fontFamily: '"SF Pro Display", -apple-system, sans-serif',
                fontSize: '14px',
                color: '#9292b0',
                align: 'center',
            })
            .setOrigin(0.5)
            .setAlpha(0);
        sub.setLetterSpacing(2);
        this.hudLayer.add(sub);
        this.tweens.add({ targets: sub, alpha: 1, duration: 480, delay: 180, ease: 'Cubic.easeOut' });

        // Buttons (HTML overlay for accessibility / tap reliability)
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

    private exit() {
        this.scene.start('LobbyScene');
    }

    // ---- Builders -----------------------------------------------------

    private buildBackground() {
        const bg = this.add.rectangle(ARENA_W / 2, ARENA_H / 2, ARENA_W, ARENA_H, COLORS.arena);
        bg.setStrokeStyle(1, COLORS.arenaLine, 1);
        this.bgLayer.add(bg);

        // Corner brackets
        const len = 18;
        const bracket = (cx: number, cy: number, sx: number, sy: number) => {
            const g = this.add.graphics();
            g.lineStyle(1, COLORS.arenaLine, 1);
            g.beginPath();
            g.moveTo(cx + len * sx, cy);
            g.lineTo(cx, cy);
            g.lineTo(cx, cy + len * sy);
            g.strokePath();
            this.bgLayer.add(g);
        };
        bracket(2, 2, 1, 1);
        bracket(ARENA_W - 2, 2, -1, 1);
        bracket(2, ARENA_H - 2, 1, -1);
        bracket(ARENA_W - 2, ARENA_H - 2, -1, -1);
    }

    private buildHud() {
        this.hudScore = this.add
            .text(24, 24, '0', {
                fontFamily: '"SF Pro Display", -apple-system, sans-serif',
                fontSize: '24px',
                color: '#e8e8f4',
                fontStyle: '800',
            })
            .setOrigin(0, 0);
        this.hudScore.setLetterSpacing(2);
        this.hudLayer.add(this.hudScore);

        this.hudLives = this.add
            .text(ARENA_W - 24, 24, '●●●', {
                fontFamily: '"SF Pro Display", -apple-system, sans-serif',
                fontSize: '20px',
                color: `#${COLORS.p1.toString(16)}`,
            })
            .setOrigin(1, 0);
        this.hudLives.setLetterSpacing(4);
        this.hudLayer.add(this.hudLives);

        this.hudHint = this.add
            .text(ARENA_W / 2, ARENA_H - 28, 'Tap, drag, or arrow keys · SPACE to launch · ESC for lobby', {
                fontFamily: '"SF Pro Display", -apple-system, sans-serif',
                fontSize: '11px',
                color: '#6c6c8a',
            })
            .setOrigin(0.5);
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
        for (let row = 0; row < SOLO_ROWS; row++) {
            // Color rows from p1 (cyan) at top to p2 (magenta) at bottom — palette ramp
            const ratio = row / (SOLO_ROWS - 1);
            const color = ratio < 0.5 ? COLORS.p1Brick : COLORS.p2Brick;
            for (let col = 0; col < BRICK_COLS; col++) {
                const x = BRICK_GAP + col * (BRICK_W + BRICK_GAP) + BRICK_W / 2;
                const y = yStart + row * (BRICK_H + BRICK_GAP) + BRICK_H / 2;
                const sprite = this.add.rectangle(x, y, BRICK_W, BRICK_H, color, 0.92);
                sprite.setStrokeStyle(1, color, 0.6);
                this.brickLayer.add(sprite);
                this.bricks.push({ x, y, alive: true, sprite, color });
            }
        }
        this.aliveCount = this.bricks.length;
    }

    private buildPaddleAndBall() {
        this.paddle = this.add.rectangle(ARENA_W / 2, PADDLE_Y_SOLO, PADDLE_W, PADDLE_H, COLORS.p1, 0.96);
        this.paddle.setStrokeStyle(1, COLORS.p1, 0.4);
        this.playLayer.add(this.paddle);

        this.ballGlow = this.add.circle(ARENA_W / 2, PADDLE_Y_SOLO - 30, BALL_RADIUS + 6, COLORS.ball, 0.18);
        this.ball = this.add.circle(ARENA_W / 2, PADDLE_Y_SOLO - 30, BALL_RADIUS, COLORS.ball, 1);
        this.playLayer.add([this.ballGlow, this.ball]);

        this.ballState = { x: this.paddle.x, y: this.paddle.y - 30, vx: 0, vy: 0, onPaddle: true };
        this.hudHint.setText('Tap or SPACE to launch');
    }

    private handlePointer(pointer: Phaser.Input.Pointer) {
        const x = Math.max(PADDLE_W / 2, Math.min(ARENA_W - PADDLE_W / 2, pointer.worldX));
        this.paddle.x = x;
        this.kbPaddleX = x;
    }

    private cleanup() {
        document.querySelectorAll('.end-actions').forEach((el) => el.remove());
    }
}
