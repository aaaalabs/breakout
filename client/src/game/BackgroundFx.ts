// Background "motes" + reactive pulse — subtle ambient depth that responds
// to game events (combo tiers, power-up pickups, win moment).

import { ARENA_W, ARENA_H, COLORS } from '@breakout/shared';

interface Mote {
    sprite: Phaser.GameObjects.Arc;
    baseY: number;
    phase: number;
    speed: number;
    amp: number;
}

const MOTE_COUNT = 36;

export class BackgroundFx {
    private scene: Phaser.Scene;
    private motes: Mote[] = [];
    private pulseRect: Phaser.GameObjects.Rectangle;
    private layer: Phaser.GameObjects.Container;

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Container) {
        this.scene = scene;
        this.layer = layer;

        for (let i = 0; i < MOTE_COUNT; i++) {
            const x = Math.random() * ARENA_W;
            const y = Math.random() * ARENA_H;
            const r = 0.6 + Math.random() * 1.4;
            const baseAlpha = 0.05 + Math.random() * 0.10;
            const dot = scene.add.circle(x, y, r, COLORS.text, baseAlpha);
            this.layer.add(dot);
            this.motes.push({
                sprite: dot,
                baseY: y,
                phase: Math.random() * Math.PI * 2,
                speed: 0.0003 + Math.random() * 0.0005,
                amp: 6 + Math.random() * 18,
            });
        }

        // Pulse rect over the arena (full-cover, low alpha when pulsing)
        this.pulseRect = scene.add.rectangle(ARENA_W / 2, ARENA_H / 2, ARENA_W, ARENA_H, 0xffffff, 0)
            .setBlendMode(Phaser.BlendModes.ADD);
        this.layer.add(this.pulseRect);
    }

    tick(time: number) {
        for (const m of this.motes) {
            m.sprite.y = m.baseY + Math.sin(time * m.speed + m.phase) * m.amp;
        }
    }

    /** Brief color pulse covering the arena. Use for combo tiers, power-ups, etc. */
    pulse(color: number, intensity = 0.18) {
        this.pulseRect.setFillStyle(color, intensity);
        this.scene.tweens.killTweensOf(this.pulseRect);
        this.pulseRect.setAlpha(1);
        this.scene.tweens.add({
            targets: this.pulseRect,
            alpha: 0,
            duration: 380,
            ease: 'Cubic.easeOut',
        });
    }
}
