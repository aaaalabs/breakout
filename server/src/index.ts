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

// Admin monitor — gated. In production set MONITOR_TOKEN to enable.
if (process.env.MONITOR_TOKEN) {
    app.use('/colyseus', (req, res, next) => {
        const auth = req.headers.authorization;
        if (auth === `Bearer ${process.env.MONITOR_TOKEN}`) return next();
        res.status(401).send('unauthorized');
    }, monitor());
}

// CORS — restrict origins in production
const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
    'https://breakout.leodin.com,https://breakout-seven.vercel.app').split(',');
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    next();
});

const httpServer = createServer(app);

const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('breakout', BreakoutRoom);

gameServer.listen(PORT).then(() => {
    console.log(`[breakout] listening on :${PORT}`);
});
