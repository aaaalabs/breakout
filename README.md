# Breakout — Multiplayer

A 1v1 real-time multiplayer Breakout. Vertical arena, paddles top + bottom, single ball ricocheting between. Each player owns half the bricks. **Lose all your bricks → you lose.**

- **Client:** Phaser 4 + Vite, deployed on Vercel → https://breakout.leodin.com
- **Server:** Colyseus + Node, deployed on Hetzner via Coolify → wss://breakout-api.leodin.com

## Local development

```bash
npm install
npm run dev
```

Then open two browser tabs at http://localhost:5173 (or whatever Vite chooses).

The client connects to `ws://localhost:2567` by default. Override with `VITE_SERVER_URL` env var for staging.

## Project layout

```
shared/   # geometry constants, Colyseus schema, message types
server/   # Colyseus room + authoritative game simulation (no Phaser dep)
client/   # Phaser 4 game + Colyseus client
```

## Deployment

**Server** (Coolify on Hetzner):

1. Push to GitHub
2. Coolify watches `main` branch
3. Builds `server/Dockerfile` (multi-stage, Node 22 alpine)
4. Auto-restart on push

**Client** (Vercel):

1. Same GitHub repo, root config in `vercel.json`
2. Builds `shared` + `client`, outputs `client/dist`
3. Auto-deploys on push

## Design

Full design spec: `../docs/superpowers/specs/2026-05-03-multiplayer-breakout-design.md`
