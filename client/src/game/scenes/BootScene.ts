// Boot scene. No assets to preload (procedural rendering) so this is just a
// quick handoff that decides whether the user landed on a `?room=` URL and
// should jump straight into joining, or just goes to the lobby.
import { Scene } from 'phaser';

export class BootScene extends Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    create() {
        const params = new URLSearchParams(window.location.search);
        const roomId = params.get('room')?.trim() ?? '';

        // Hand to lobby. Lobby decides whether to auto-join based on roomId.
        this.scene.start('LobbyScene', { autoJoinRoomId: roomId || undefined });
    }
}
