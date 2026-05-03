// Client → Server messages (Colyseus message types)

export type ClientMessageType = 'paddleMove' | 'ready' | 'rematch';

export interface PaddleMoveMessage {
    x: number; // requested paddle center X (clamped server-side)
}

export interface ReadyMessage {
    name?: string;
}

export interface RematchMessage {}

// Server → Client one-shot events (state changes via schema sync)
export type ServerEventType = 'brickBreak' | 'paddleHit' | 'wallHit';

export interface BrickBreakEvent {
    slot: 'p1' | 'p2'; // whose brick broke
    x: number;
    y: number;
}

export interface PaddleHitEvent {
    slot: 'p1' | 'p2';
    intensity: number; // 0..1 based on impact angle
}

export interface WallHitEvent {
    side: 'left' | 'right' | 'top' | 'bottom';
    x: number;
    y: number;
}
