// Phaser game config + scene list.
// FIT scaling so the 800x1000 game-world adapts to any viewport without distortion.
import { AUTO, Game, Scale } from 'phaser';
import { ARENA_W, ARENA_H, COLORS } from '@breakout/shared';
import { BootScene } from './scenes/BootScene';
import { LobbyScene } from './scenes/LobbyScene';
import { GameScene } from './scenes/GameScene';
import { SoloScene } from './scenes/SoloScene';
import { EndScene } from './scenes/EndScene';

const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: ARENA_W,
    height: ARENA_H,
    parent: 'game-container',
    backgroundColor: `#${COLORS.bg.toString(16).padStart(6, '0')}`,
    scale: {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH,
    },
    fps: { target: 60, smoothStep: true },
    input: { activePointers: 2 },
    render: {
        antialias: true,
        pixelArt: false,
        roundPixels: false,
    },
    scene: [BootScene, LobbyScene, GameScene, SoloScene, EndScene],
};

const StartGame = (parent: string) => new Game({ ...config, parent });

export default StartGame;
