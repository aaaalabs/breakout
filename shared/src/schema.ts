import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';

export class Brick extends Schema {
    @type('number') x: number = 0;
    @type('number') y: number = 0;
    @type('uint8') alive: number = 1; // 1 = alive, 0 = destroyed
    @type('uint8') hp: number = 1;    // remaining hits to destroy
    @type('uint8') maxHp: number = 1; // initial hp (for damage-state rendering)
    @type('string') kind: string = 'normal'; // 'normal' | 'iron' | 'gift' | 'diamond' | 'bomb'
}

export class Paddle extends Schema {
    @type('number') x: number = 0; // center X
    @type('number') y: number = 0; // fixed
    @type('number') width: number = 0;
}

export class Ball extends Schema {
    @type('number') x: number = 0;
    @type('number') y: number = 0;
    @type('number') vx: number = 0;
    @type('number') vy: number = 0;
}

export type GamePhase = 'waiting' | 'countdown' | 'playing' | 'finished';

export class GameState extends Schema {
    @type('string') phase: GamePhase = 'waiting';
    @type('number') countdownEndsAt: number = 0; // server timestamp ms
    @type('number') matchEndsAt: number = 0;
    @type('string') winnerSlot: string = ''; // 'p1' | 'p2' | '' (none yet)

    @type({ map: 'string' }) playerSlot = new MapSchema<string>(); // sessionId -> 'p1' | 'p2'
    @type({ map: 'string' }) playerName = new MapSchema<string>();

    @type(Paddle) paddleP1 = new Paddle();
    @type(Paddle) paddleP2 = new Paddle();

    @type(Ball) ball = new Ball();

    @type([Brick]) bricksP1 = new ArraySchema<Brick>();
    @type([Brick]) bricksP2 = new ArraySchema<Brick>();

    @type('uint16') aliveCountP1: number = 0;
    @type('uint16') aliveCountP2: number = 0;

    @type('uint16') ballSpeedTier: number = 0; // increments to drive ramp
}
