// EndScene — overlays on top of the dimmed GameScene. Big VICTORY/DEFEAT text
// in the winner's color, stats line, two action buttons (HTML for click/tap reliability).

import { Scene } from 'phaser';
import { ARENA_W, ARENA_H, BRICK_COLS, BRICK_ROWS_PER_PLAYER, COLORS } from '@breakout/shared';
import type { PlayerSlot } from '@breakout/shared';
import { net } from '../../network/Net';
import { THEME } from '../../ui/theme';

interface EndData {
    winnerSlot: '' | PlayerSlot;
    mySlot: PlayerSlot | null;
    aliveCountP1: number;
    aliveCountP2: number;
}

export class EndScene extends Scene {
    private overlay!: HTMLElement;
    private actionsEl: HTMLDivElement | null = null;

    constructor() {
        super({ key: 'EndScene' });
    }

    create(data: EndData) {
        const isWin = data.mySlot && data.winnerSlot === data.mySlot;
        const winnerColor = data.winnerSlot === 'p1' ? COLORS.p1 : COLORS.p2;
        const headline = isWin ? 'VICTORY' : data.mySlot ? 'DEFEAT' : 'MATCH OVER';
        const subhead = isWin
            ? 'You broke their world.'
            : data.mySlot
              ? 'They held the line.'
              : 'Well played.';

        // Big headline
        const headlineText = this.add.text(ARENA_W / 2, ARENA_H / 2 - 40, headline, {
            fontFamily: THEME.fontFamily,
            color: `#${(isWin ? winnerColor : COLORS.text).toString(16).padStart(6, '0')}`,
            fontSize: '88px',
            fontStyle: '800',
        }).setOrigin(0.5);
        headlineText.setLetterSpacing(6);
        headlineText.setAlpha(0);
        headlineText.setScale(0.96);

        const subheadText = this.add.text(ARENA_W / 2, ARENA_H / 2 + 36, subhead, {
            fontFamily: THEME.fontFamily,
            color: `#${COLORS.text.toString(16).padStart(6, '0')}`,
            fontSize: '18px',
            fontStyle: '400',
        }).setOrigin(0.5);
        subheadText.setAlpha(0);

        const statsLine = this.buildStatsLine(data);
        const statsText = this.add.text(ARENA_W / 2, ARENA_H / 2 + 72, statsLine, {
            fontFamily: THEME.fontFamily,
            color: `#${COLORS.dim.toString(16).padStart(6, '0')}`,
            fontSize: '13px',
            fontStyle: '500',
        }).setOrigin(0.5);
        statsText.setLetterSpacing(2);
        statsText.setAlpha(0);

        // Tween in
        this.tweens.add({
            targets: headlineText,
            alpha: 1,
            scale: 1,
            duration: THEME.dur.xl,
            ease: THEME.ease.out,
        });
        this.tweens.add({
            targets: subheadText,
            alpha: 1,
            duration: THEME.dur.xl,
            delay: 220,
            ease: THEME.ease.out,
        });
        this.tweens.add({
            targets: statsText,
            alpha: 1,
            duration: THEME.dur.xl,
            delay: 320,
            ease: THEME.ease.out,
        });

        // Build HTML action buttons in the overlay
        this.overlay = document.getElementById('ui-overlay')!;
        this.actionsEl = document.createElement('div');
        this.actionsEl.className = 'end-actions';

        const rematch = document.createElement('button');
        rematch.className = 'end-btn end-btn--primary';
        rematch.textContent = 'Rematch';
        rematch.addEventListener('click', () => this.handleRematch(rematch));
        this.actionsEl.appendChild(rematch);

        const lobby = document.createElement('button');
        lobby.className = 'end-btn';
        lobby.textContent = 'Back to Lobby';
        lobby.addEventListener('click', () => this.handleBackToLobby());
        this.actionsEl.appendChild(lobby);

        this.overlay.appendChild(this.actionsEl);

        // Reveal buttons after stagger
        setTimeout(() => this.actionsEl?.classList.add('is-visible'), 200);

        // Cleanup
        this.events.once('shutdown', () => this.cleanup());
        this.events.once('destroy', () => this.cleanup());
    }

    private buildStatsLine(data: EndData): string {
        // Derive bricks-broken from start-vs-remaining counts.
        const START = BRICK_COLS * BRICK_ROWS_PER_PLAYER;
        const brokenByP1 = START - data.aliveCountP2; // p1 broke p2's bricks
        const brokenByP2 = START - data.aliveCountP1;
        const myBroke = data.mySlot === 'p1' ? brokenByP1 : data.mySlot === 'p2' ? brokenByP2 : 0;
        if (data.mySlot) {
            return `${myBroke} BRICKS BROKEN`;
        }
        return `${brokenByP1}  ·  ${brokenByP2}`;
    }

    // ----------------------------------------------------------------

    private rematchUnsubscribe?: () => void;

    private handleRematch(btn: HTMLButtonElement) {
        const room = net.room;
        if (!room) {
            this.handleBackToLobby();
            return;
        }
        btn.disabled = true;
        btn.textContent = 'Waiting…';
        try {
            room.send('rematch', {});
        } catch {
            /* ignore */
        }
        // Single subscription; tear down on shutdown to prevent leaks across rematches.
        this.rematchUnsubscribe?.();
        const handler = (state: { phase: string }) => {
            if (state.phase === 'countdown' || state.phase === 'playing') {
                this.rematchUnsubscribe?.();
                this.restoreAndExit();
            }
        };
        room.onStateChange(handler);
        this.rematchUnsubscribe = () => room.onStateChange.remove(handler);
    }

    private restoreAndExit() {
        // Restore GameScene alpha and hand back focus
        const game = this.scene.get('GameScene') as Phaser.Scene | undefined;
        if (game) {
            game.tweens.add({
                targets: game.children.list,
                alpha: 1,
                duration: THEME.dur.med,
                ease: THEME.ease.out,
            });
        }
        this.cleanup();
        this.scene.stop('EndScene');
    }

    private async handleBackToLobby() {
        await net.leave();
        history.replaceState(null, '', window.location.pathname);
        this.cleanup();
        this.scene.stop('GameScene');
        this.scene.start('LobbyScene', {});
    }

    private cleanup() {
        if (this.actionsEl?.parentNode) {
            this.actionsEl.parentNode.removeChild(this.actionsEl);
            this.actionsEl = null;
        }
    }
}
