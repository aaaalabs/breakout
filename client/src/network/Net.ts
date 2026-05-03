// Colyseus client wrapper. Single shared instance + active room handle.
// Keeps room reference accessible across scenes without prop-drilling.

import { Client, Room } from 'colyseus.js';
import type { GameState } from '@breakout/shared';

const SERVER_URL =
    (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'ws://localhost:2567';

const ROOM_NAME = 'breakout';

class Net {
    readonly client: Client;
    room: Room<GameState> | null = null;

    constructor() {
        this.client = new Client(SERVER_URL);
    }

    async quickMatch(name?: string): Promise<Room<GameState>> {
        const room = await this.client.joinOrCreate<GameState>(ROOM_NAME, { name });
        this.room = room;
        return room;
    }

    async createPrivate(name?: string): Promise<Room<GameState>> {
        const room = await this.client.create<GameState>(ROOM_NAME, { private: true, name });
        this.room = room;
        return room;
    }

    async joinById(roomId: string, name?: string): Promise<Room<GameState>> {
        const room = await this.client.joinById<GameState>(roomId, { name });
        this.room = room;
        return room;
    }

    async leave(): Promise<void> {
        if (this.room) {
            try {
                await this.room.leave(true);
            } catch {
                /* ignore */
            }
            this.room = null;
        }
    }
}

export const net = new Net();

// Generate a tasteful random handle. Used as default `name` if user has none.
const ADJECTIVES = [
    'Brick', 'Vector', 'Echo', 'Pixel', 'Quark', 'Static', 'Photon', 'Glitch',
    'Drift', 'Velvet', 'Neon', 'Cobalt', 'Nova', 'Halo', 'Spark', 'Quartz',
];
const NOUNS = [
    'Brigadier', 'Architect', 'Wraith', 'Harbinger', 'Voyager', 'Sentinel',
    'Kestrel', 'Mariner', 'Phantom', 'Tactician', 'Whisper', 'Cipher',
];

export const generateHandle = (): string => {
    const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    return `${a} ${n} #${num}`;
};
