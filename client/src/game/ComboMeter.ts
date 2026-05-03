// Combo meter — shared between Solo and Versus scenes.
// On every brick break: register() increments the combo, returns bonus points.
// After COMBO_DECAY_MS of no register() the combo resets.
// Renders a tasteful "x3!" with a Back.easeOut pop and Quint.easeIn fade-out.

import { THEME } from '../ui/theme';

const COMBO_DECAY_MS = 1500;
const TIER_BONUS = [0, 0, 5, 10, 20, 35, 55, 80, 110, 150]; // bonus added per combo stage
const FX_TIERS = [
    { color: '#9292b0', size: 28 },  // 1
    { color: '#e8e8f4', size: 32 },  // 2
    { color: '#00f0f0', size: 38 },  // 3
    { color: '#00f0f0', size: 44 },  // 4
    { color: '#7ce38b', size: 50 },  // 5
    { color: '#ffd166', size: 58 },  // 6
    { color: '#ff5fb8', size: 64 },  // 7+
];

export interface ComboResult {
    count: number;        // current combo count after register
    bonus: number;        // points awarded for THIS hit
    tier: number;         // visual tier (0..6+)
}

export class ComboMeter {
    private scene: Phaser.Scene;
    private text: Phaser.GameObjects.Text;
    private count = 0;
    private lastHitAt = 0;
    private decayTween?: Phaser.Tweens.Tween;
    private layer: Phaser.GameObjects.Container | null;

    constructor(scene: Phaser.Scene, opts: { x: number; y: number; layer?: Phaser.GameObjects.Container }) {
        this.scene = scene;
        this.layer = opts.layer ?? null;
        this.text = scene.add.text(opts.x, opts.y, '', {
            fontFamily: THEME.fontFamilyEmoji,
            fontStyle: '800',
            fontSize: '28px',
            color: '#e8e8f4',
            align: 'center',
        }).setOrigin(0.5).setAlpha(0);
        this.text.setLetterSpacing(2);
        if (this.layer) this.layer.add(this.text);
    }

    /** Call on every brick break. Returns combo state + bonus points to add to score. */
    register(now: number): ComboResult {
        // Reset if decayed
        if (now - this.lastHitAt > COMBO_DECAY_MS) this.count = 0;
        this.count++;
        this.lastHitAt = now;

        const tier = Math.min(FX_TIERS.length - 1, this.count - 1);
        const bonus = this.count < TIER_BONUS.length ? TIER_BONUS[this.count] : TIER_BONUS[TIER_BONUS.length - 1];

        if (this.count >= 2) this.renderPop(tier);

        return { count: this.count, bonus, tier };
    }

    tick(now: number) {
        if (this.count > 0 && now - this.lastHitAt > COMBO_DECAY_MS) {
            this.count = 0;
            this.fadeOut();
        }
    }

    reset() {
        this.count = 0;
        this.text.setAlpha(0);
        this.decayTween?.stop();
    }

    private renderPop(tier: number) {
        const fx = FX_TIERS[tier];
        this.text.setText(`×${this.count}`);
        this.text.setColor(fx.color);
        this.text.setFontSize(fx.size);
        this.text.setAlpha(1);
        this.text.setScale(0.6);

        this.decayTween?.stop();
        this.scene.tweens.killTweensOf(this.text);

        // Pop in
        this.scene.tweens.add({
            targets: this.text,
            scale: 1.0,
            duration: 220,
            ease: 'Back.easeOut',
        });

        // Schedule fade-out (decay)
        this.decayTween = this.scene.tweens.add({
            targets: this.text,
            alpha: 0,
            scale: 0.85,
            delay: COMBO_DECAY_MS - 220,
            duration: 320,
            ease: THEME.ease.in,
        });
    }

    private fadeOut() {
        this.scene.tweens.killTweensOf(this.text);
        this.scene.tweens.add({
            targets: this.text,
            alpha: 0,
            duration: 240,
            ease: THEME.ease.in,
        });
    }
}
