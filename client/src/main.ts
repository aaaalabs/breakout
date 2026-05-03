// Bootstrap entry. Starts the Phaser Game once the DOM is ready.
import StartGame from './game/main';

document.addEventListener('DOMContentLoaded', () => {
    StartGame('game-container');
});
