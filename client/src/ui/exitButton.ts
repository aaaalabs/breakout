// In-game exit button (mobile-friendly). Mounted by GameScene + SoloScene
// during create(), removed during shutdown. Lives in #ui-overlay so it's
// not affected by scene transitions.

export function mountExitButton(onExit: () => void): () => void {
    const overlay = document.getElementById('ui-overlay') ?? document.body;
    const btn = document.createElement('button');
    btn.className = 'exit-toggle';
    btn.setAttribute('aria-label', 'Exit to lobby');
    btn.title = 'Back to lobby';
    btn.textContent = '✕';
    btn.addEventListener('click', () => onExit());
    overlay.appendChild(btn);
    return () => btn.remove();
}
