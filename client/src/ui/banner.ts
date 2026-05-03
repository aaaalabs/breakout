// Emoji-safe HTML banner — flashes a centered overlay that fades in + drifts up,
// then auto-removes. Used for moments where Phaser's canvas text can't render
// emojis reliably (🏆 💔 🎁 💎 💣 🗑️ ⚔️ 👆 etc.).

export type BannerVariant = 'default' | 'garbage' | 'bomb' | 'diamond' | 'gift' | 'win' | 'lose';

export function flashBanner(text: string, opts: {
    variant?: BannerVariant;
    duration?: number;
    holdMs?: number;
} = {}): void {
    const overlay = document.getElementById('ui-overlay') ?? document.body;
    const el = document.createElement('div');
    el.className = `emoji-banner emoji-banner--${opts.variant ?? 'default'}`;
    el.textContent = text;
    overlay.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));

    const hold = opts.holdMs ?? 900;
    setTimeout(() => {
        el.classList.remove('is-visible');
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 480);
    }, hold);
}

/** Persistent hint text (e.g. "👆 tap or SPACE to launch"). Returns remover. */
export function mountHint(text: string): () => void {
    const overlay = document.getElementById('ui-overlay') ?? document.body;
    const el = document.createElement('div');
    el.className = 'solo-hint';
    el.textContent = text;
    overlay.appendChild(el);
    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        el.remove();
    };
}
