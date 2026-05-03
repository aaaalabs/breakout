import express from 'express';
import { createServer } from 'http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import { BreakoutRoom } from './rooms/BreakoutRoom.js';

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
});

app.use('/colyseus', monitor());

const httpServer = createServer(app);

const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('breakout', BreakoutRoom);

gameServer.listen(PORT).then(() => {
    console.log(`[breakout] listening on :${PORT}`);
});
