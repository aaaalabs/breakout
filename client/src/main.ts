// Bootstrap entry. Starts the Phaser Game once the DOM is ready.
import StartGame from './game/main';
import { sfx } from './audio/Sfx';

document.addEventListener('DOMContentLoaded', () => {
    StartGame('game-container');
    mountSoundToggle();
});

function mountSoundToggle() {
    const btn = document.createElement('button');
    btn.className = 'sound-toggle';
    btn.setAttribute('aria-label', 'Toggle sound');
    const sync = () => {
        const muted = sfx.muted;
        btn.textContent = muted ? '🔇' : '🔊';
        btn.classList.toggle('is-muted', muted);
        btn.title = muted ? 'Sound off · click to unmute' : 'Sound on · click to mute';
    };
    btn.addEventListener('click', () => {
        sfx.unlock();
        sfx.toggleMute();
        sync();
    });
    sync();
    document.body.appendChild(btn);
}
