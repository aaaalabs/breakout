// Lobby scene. Transparent Phaser scene; the lobby UI lives as HTML in the
// overlay div for accessibility (real input fields, copy buttons). Phaser
// renders only a tasteful animated background — a slow drifting arena outline
// — so the user sees something living the moment the page loads.

import { Scene } from 'phaser';
import {
    COLORS,
    BALL_RADIUS,
    PADDLE_W,
    PADDLE_H,
} from '@breakout/shared';
import { net, generateHandle } from '../../network/Net';
import { THEME } from '../../ui/theme';
import { sfx } from '../../audio/Sfx';
import { BackgroundFx } from '../BackgroundFx';

interface LobbyData {
    autoJoinRoomId?: string;
}

type LobbyMode = 'idle' | 'connecting' | 'waiting' | 'error';

export class LobbyScene extends Scene {
    private overlay!: HTMLElement;
    private lobbyEl!: HTMLDivElement;
    private mode: LobbyMode = 'idle';
    private handle = generateHandle();

    // Tiny live breakout sim in the center — paddles chase a bouncing ball.
    // Confined to ±AMBIENT_HALF_W around the canvas center so it never reads as offset.
    private ambientGroup!: Phaser.GameObjects.Container;
    private ambientBall!: Phaser.GameObjects.Arc;
    private ambientPaddleTop!: Phaser.GameObjects.Rectangle;
    private ambientPaddleBottom!: Phaser.GameObjects.Rectangle;
    private ambientState = { bx: 0, by: 0, bvx: 1, bvy: 1 };
    private bgfx!: BackgroundFx;
    private bgLayer!: Phaser.GameObjects.Container;

    constructor() {
        super({ key: 'LobbyScene' });
    }

    create(data: LobbyData) {
        // Solid background (Phaser scale handles letterboxing of the arena box itself)
        this.cameras.main.setBackgroundColor(`#${COLORS.bg.toString(16).padStart(6, '0')}`);

        // Background motes layer (subtle drifting depth)
        this.bgLayer = this.add.container(0, 0);
        this.bgfx = new BackgroundFx(this, this.bgLayer);

        // Build ambient backdrop
        this.buildAmbientBackdrop();

        // Build HTML lobby UI in overlay
        this.overlay = document.getElementById('ui-overlay')!;
        this.lobbyEl = document.createElement('div');
        this.lobbyEl.className = 'lobby';
        this.overlay.appendChild(this.lobbyEl);

        this.renderIdle();

        // Fade-in next tick so CSS transition fires
        requestAnimationFrame(() => this.lobbyEl.classList.add('is-visible'));

        // Auto-join if landed via shared URL
        if (data?.autoJoinRoomId) {
            // Defer slightly so user sees a flash of context
            this.time.delayedCall(180, () => this.handleJoinById(data.autoJoinRoomId!));
        }

        // Cleanup on shutdown
        this.events.once('shutdown', () => this.cleanup());
        this.events.once('destroy', () => this.cleanup());
    }

    update(time: number, deltaMs: number) {
        this.bgfx?.tick(time);
        this.tickAmbientSim(deltaMs);
    }

    private tickAmbientSim(deltaMs: number) {
        if (!this.ambientBall) return;
        const dt = Math.min(0.05, deltaMs / 1000);
        const HALF_W = 130;   // ball oscillates within ±130px (well inside lobby column)
        const HALF_H = 200;   // tall thin "arena"
        const SPEED = 110;    // px/s — slow & tasteful
        const PADDLE_LERP = 0.06; // sluggish chase = visual interest

        // Ball motion in ambient state (relative to group center 0,0)
        const s = this.ambientState;
        s.bx += s.bvx * SPEED * dt;
        s.by += s.bvy * SPEED * dt;
        if (s.bx < -HALF_W) { s.bx = -HALF_W; s.bvx = Math.abs(s.bvx); }
        if (s.bx > HALF_W)  { s.bx = HALF_W;  s.bvx = -Math.abs(s.bvx); }
        if (s.by < -HALF_H) { s.by = -HALF_H; s.bvy = Math.abs(s.bvy); }
        if (s.by > HALF_H)  { s.by = HALF_H;  s.bvy = -Math.abs(s.bvy); }

        this.ambientBall.setPosition(s.bx, s.by);

        // Paddles lerp toward ball X — sluggish, gives a "trying to catch" feel
        const topX = this.ambientPaddleTop.x + (s.bx - this.ambientPaddleTop.x) * PADDLE_LERP;
        const botX = this.ambientPaddleBottom.x + (s.bx - this.ambientPaddleBottom.x) * PADDLE_LERP;
        this.ambientPaddleTop.x = Math.max(-HALF_W, Math.min(HALF_W, topX));
        this.ambientPaddleBottom.x = Math.max(-HALF_W, Math.min(HALF_W, botX));
    }

    // -- Ambient backdrop ------------------------------------------------

    private buildAmbientBackdrop() {
        const { width, height } = this.scale.gameSize;

        this.ambientGroup = this.add.container(width / 2, height / 2);
        this.ambientGroup.setAlpha(0.42);

        // Mini-paddles ABOVE and BELOW the lobby card column (centered in canvas).
        this.ambientPaddleTop = this.add.rectangle(0, -210, PADDLE_W * 0.7, PADDLE_H * 0.85, COLORS.p1, 0.6);
        this.ambientPaddleBottom = this.add.rectangle(0, 210, PADDLE_W * 0.7, PADDLE_H * 0.85, COLORS.p2, 0.6);
        this.ambientBall = this.add.circle(0, 0, BALL_RADIUS * 1.1, COLORS.ball, 0.95);
        this.ambientGroup.add([this.ambientPaddleTop, this.ambientPaddleBottom, this.ambientBall]);

        // Initial ball trajectory — random angle, normalized
        const a = Math.random() * Math.PI * 2;
        this.ambientState.bvx = Math.cos(a);
        this.ambientState.bvy = Math.sin(a) * 0.8;

        // Subtle ball pulse so it reads as alive even when stationary moments
        this.tweens.add({
            targets: this.ambientBall,
            scale: { from: 0.92, to: 1.08 },
            duration: 1800,
            yoyo: true,
            repeat: -1,
            ease: THEME.ease.sine,
        });

        // Very gentle vertical drift of the whole sim — ±20px (barely perceptible)
        this.tweens.add({
            targets: this.ambientGroup,
            y: { from: height / 2 - 20, to: height / 2 + 20 },
            duration: 8000,
            yoyo: true,
            repeat: -1,
            ease: THEME.ease.sine,
        });
    }

    // -- HTML rendering --------------------------------------------------

    private renderIdle() {
        this.mode = 'idle';
        this.lobbyEl.innerHTML = '';

        const title = document.createElement('h1');
        title.className = 'lobby__title';
        title.innerHTML = `BREAK<span class="accent">OUT</span>`;
        this.lobbyEl.appendChild(title);

        const sub = document.createElement('p');
        sub.className = 'lobby__sub';
        sub.textContent = '1v1  ·  Real-time  ·  No accounts';
        this.lobbyEl.appendChild(sub);

        const cards = document.createElement('div');
        cards.className = 'lobby__cards';

        // Quick match (primary)
        const quick = document.createElement('button');
        quick.className = 'card card--primary';
        quick.innerHTML = `
            <span class="card__icon" aria-hidden="true">⚔️</span>
            <span class="card__text">
                <span class="card__label">Quick Match</span>
                <span class="card__hint">Find an opponent now</span>
            </span>
            <span class="card__chev" aria-hidden="true">▶</span>
        `;
        quick.addEventListener('click', () => { sfx.unlock(); sfx.uiClick(); this.handleQuickMatch(); });
        cards.appendChild(quick);

        // Solo practice (no opponent needed)
        const solo = document.createElement('button');
        solo.className = 'card';
        solo.innerHTML = `
            <span class="card__icon" aria-hidden="true">🧱</span>
            <span class="card__text">
                <span class="card__label">Solo Practice</span>
                <span class="card__hint">Classic single-player</span>
            </span>
            <span class="card__chev" aria-hidden="true">▶</span>
        `;
        solo.addEventListener('click', () => { sfx.unlock(); sfx.uiClick(); this.handleSolo(); });
        cards.appendChild(solo);

        // Private room
        const priv = document.createElement('button');
        priv.className = 'card';
        priv.innerHTML = `
            <span class="card__icon" aria-hidden="true">🔗</span>
            <span class="card__text">
                <span class="card__label">Create Private Room</span>
                <span class="card__hint">Get a link to share</span>
            </span>
            <span class="card__chev" aria-hidden="true">▶</span>
        `;
        priv.addEventListener('click', () => { sfx.unlock(); sfx.uiClick(); this.handleCreatePrivate(); });
        cards.appendChild(priv);

        // Join by code
        const join = document.createElement('div');
        join.className = 'card join';
        const icon = document.createElement('span');
        icon.className = 'card__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '🎟️';
        const input = document.createElement('input');
        input.className = 'join__input';
        input.placeholder = 'Paste room code';
        input.spellcheck = false;
        input.autocapitalize = 'characters';
        const btn = document.createElement('button');
        btn.className = 'join__btn';
        btn.textContent = 'Join';
        const submit = () => {
            sfx.unlock();
            sfx.uiClick();
            const id = this.extractRoomId(input.value);
            if (id) this.handleJoinById(id);
        };
        btn.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
        });
        join.appendChild(icon);
        join.appendChild(input);
        join.appendChild(btn);
        cards.appendChild(join);

        this.lobbyEl.appendChild(cards);
    }

    private renderWaiting(opts: { shareUrl?: string; title?: string }) {
        this.mode = 'waiting';
        this.lobbyEl.innerHTML = '';

        const title = document.createElement('h1');
        title.className = 'lobby__title';
        title.innerHTML = `BREAK<span class="accent">OUT</span>`;
        this.lobbyEl.appendChild(title);

        const status = document.createElement('div');
        status.className = 'status';

        const head = document.createElement('p');
        head.className = 'status__title';
        head.innerHTML = `${opts.title ?? 'Searching for opponent'}<span class="status__dots"><span></span><span></span><span></span></span>`;
        status.appendChild(head);

        if (opts.shareUrl) {
            const share = document.createElement('button');
            share.className = 'status__share';
            share.innerHTML = `
                <span class="status__share-url">${opts.shareUrl}</span>
                <span class="status__share-hint">Tap to copy</span>
            `;
            share.addEventListener('click', () => this.handleCopy(share, opts.shareUrl!));
            status.appendChild(share);
        }

        const cancel = document.createElement('button');
        cancel.className = 'status__cancel';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => this.handleCancel());
        status.appendChild(cancel);

        this.lobbyEl.appendChild(status);
    }

    private renderError(message: string) {
        this.mode = 'error';
        this.lobbyEl.innerHTML = '';

        const title = document.createElement('h1');
        title.className = 'lobby__title';
        title.innerHTML = `BREAK<span class="accent">OUT</span>`;
        this.lobbyEl.appendChild(title);

        const status = document.createElement('div');
        status.className = 'status';
        const head = document.createElement('p');
        head.className = 'status__title';
        head.textContent = 'Something went sideways';
        status.appendChild(head);

        const err = document.createElement('p');
        err.className = 'status__error';
        err.textContent = message;
        status.appendChild(err);

        const cancel = document.createElement('button');
        cancel.className = 'status__cancel';
        cancel.textContent = 'Back';
        cancel.addEventListener('click', () => this.renderIdle());
        status.appendChild(cancel);

        this.lobbyEl.appendChild(status);
    }

    // -- Handlers --------------------------------------------------------

    private handleSolo() {
        if (this.mode !== 'idle') return;
        this.lobbyEl.classList.remove('is-visible');
        this.time.delayedCall(220, () => this.scene.start('SoloScene'));
    }

    private async handleQuickMatch() {
        if (this.mode !== 'idle') return;
        this.renderWaiting({ title: 'Searching for opponent' });
        try {
            const room = await net.quickMatch(this.handle);
            this.waitForOpponentThenStart(room.state.phase === 'waiting');
        } catch (err) {
            this.renderError(this.errorMessage(err));
        }
    }

    private async handleCreatePrivate() {
        if (this.mode !== 'idle') return;
        this.renderWaiting({ title: 'Hosting room' });
        try {
            const room = await net.createPrivate(this.handle);
            const shareUrl = this.buildShareUrl(room.roomId);
            this.renderWaiting({ title: 'Waiting for friend', shareUrl });
            // Update browser URL so refresh keeps working
            history.replaceState(null, '', `?room=${encodeURIComponent(room.roomId)}`);
            this.waitForOpponentThenStart(true);
        } catch (err) {
            this.renderError(this.errorMessage(err));
        }
    }

    private async handleJoinById(roomId: string) {
        if (this.mode === 'connecting' || this.mode === 'waiting') return;
        this.renderWaiting({ title: 'Joining room' });
        try {
            await net.joinById(roomId, this.handle);
            // We just joined a room that already had a host. Server will move us to countdown.
            this.waitForOpponentThenStart(false);
        } catch (err) {
            this.renderError(this.errorMessage(err));
        }
    }

    private handleCancel() {
        net.leave().finally(() => {
            history.replaceState(null, '', window.location.pathname);
            this.renderIdle();
        });
    }

    private handleCopy(btn: HTMLElement, url: string) {
        const hint = btn.querySelector('.status__share-hint') as HTMLElement | null;
        const finish = () => {
            if (!hint) return;
            const original = 'Tap to copy';
            hint.textContent = 'Copied';
            hint.style.opacity = '1';
            setTimeout(() => {
                hint.textContent = original;
            }, 1400);
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(url).then(finish, finish);
        } else {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = url;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* ignore */ }
            ta.remove();
            finish();
        }
    }

    // -- Wait + handoff --------------------------------------------------

    private waitForOpponentThenStart(_isHost: boolean) {
        const room = net.room;
        if (!room) {
            this.renderError('Connection lost.');
            return;
        }

        // Listen for state phase changes. When server sets phase to "countdown"
        // (i.e. both players present), transition to GameScene.
        const tryAdvance = () => {
            if (!net.room) return;
            const phase = net.room.state.phase;
            if (phase === 'countdown' || phase === 'playing') {
                this.transitionToGame();
            }
        };

        // Hook listener
        room.onStateChange((state) => {
            if (state.phase === 'countdown' || state.phase === 'playing') {
                this.transitionToGame();
            }
        });

        // Server may have already advanced before our listener attached.
        tryAdvance();

        room.onLeave((code) => {
            // 1000 = normal close (user clicked cancel / nav); not an error
            if (code === 1000) return;
            if (this.mode === 'waiting') {
                this.renderError(`Disconnected (${code}).`);
            }
        });

        room.onError((_code, message) => {
            this.renderError(message ?? 'Unknown room error.');
        });
    }

    private transitionToGame() {
        if (this.scene.isActive('GameScene')) return;

        // Slide lobby out, then start GameScene
        this.lobbyEl.classList.remove('is-visible');
        this.tweens.add({
            targets: this.ambientGroup,
            alpha: 0,
            y: this.scale.gameSize.height / 2 + 40,
            duration: THEME.dur.long,
            ease: THEME.ease.in,
        });
        this.time.delayedCall(THEME.dur.short, () => {
            this.cleanup();
            this.scene.start('GameScene');
        });
    }

    // -- Helpers ---------------------------------------------------------

    private buildShareUrl(roomId: string): string {
        const base = `${window.location.origin}${window.location.pathname}`;
        return `${base}?room=${encodeURIComponent(roomId)}`;
    }

    private extractRoomId(input: string): string | null {
        const trimmed = input.trim();
        if (!trimmed) return null;
        // If it looks like a URL with ?room=, extract.
        const match = trimmed.match(/[?&]room=([^&\s]+)/);
        if (match) return decodeURIComponent(match[1]);
        return trimmed;
    }

    private errorMessage(err: unknown): string {
        if (err instanceof Error) return err.message;
        if (typeof err === 'string') return err;
        return 'Unable to reach server.';
    }

    private cleanup() {
        if (this.lobbyEl?.parentNode) this.lobbyEl.parentNode.removeChild(this.lobbyEl);
    }
}
