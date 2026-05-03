// Boot scene — preloads the brick atlas with chroma-key transparency, then
// hands off to the lobby. While the small atlas (~30KB, sub-100ms) loads,
// the page already shows the dark canvas + ambient motes.
import { Scene } from 'phaser';
import { preloadBrickAtlas } from '../../assets/brickAtlas';

export class BootScene extends Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    async create() {
        const params = new URLSearchParams(window.location.search);
        const roomId = params.get('room')?.trim() ?? '';

        // Preload + chroma-key-process the brick sprite atlas. Don't block
        // the lobby — bricks aren't visible there. Best-effort.
        try {
            await preloadBrickAtlas(this);
        } catch {
            // Atlas failed → bricks fall back to procedural rectangles. Game still works.
        }

        this.scene.start('LobbyScene', { autoJoinRoomId: roomId || undefined });
    }
}
