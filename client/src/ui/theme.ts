// Visual tokens. One source of truth for colors, type scale, easings.
// Re-exports COLORS from shared so we never drift between geometry + styling.
import { COLORS } from '@breakout/shared';

export const THEME = {
    color: COLORS,

    // Hex string variants for places that prefer CSS-style values
    css: {
        bg: '#0a0a14',
        text: '#e8e8f4',
        dim: '#6c6c8a',
        p1: '#00f0f0',
        p2: '#ff5fb8',
    },

    // Type scale (Phaser px). Keep this small + intentional.
    fontSize: {
        xs: '12px',
        sm: '14px',
        md: '18px',
        lg: '28px',
        xl: '56px',
    },

    fontFamily: '-apple-system, "SF Pro Display", "Helvetica Neue", "Segoe UI", sans-serif',
    // Emoji-aware font chain — Phaser's canvas renderer falls back through this
    // list per-codepoint, so the regular font handles Latin and the emoji fonts
    // handle 💎/💣/🎁/🏆/💔 etc. without showing □ replacement boxes.
    fontFamilyEmoji: '-apple-system, "SF Pro Display", "Helvetica Neue", "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif',

    // Easing helpers (Phaser tween-friendly strings)
    ease: {
        out: 'Cubic.easeOut',
        in: 'Cubic.easeIn',
        inOut: 'Cubic.easeInOut',
        back: 'Back.easeOut',
        sine: 'Sine.easeInOut',
    },

    // Standard durations (ms)
    dur: {
        micro: 120,
        short: 220,
        med: 400,
        long: 600,
        xl: 800,
    },
} as const;
