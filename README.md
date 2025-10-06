# Real-time Multiplayer Tic-Tac-Toe (WS + NATS + TypeScript)

A real-time, multiplayer Tic-Tac-Toe game where two CLI-based clients connect to two independent WebSocket servers. The servers synchronize game state through NATS. A Caddy reverse proxy does round-robin load balancing between the two servers.

- Backend: Node.js (TypeScript, ES Modules), ws (WebSocket), pino (logging), zod (validation), NATS (pub/sub + request-reply)
- Client: CLI (Node.js TypeScript), connects using WebSocket
- Infra: docker-compose (NATS, Server A, Server B, Caddy), Caddy reverse_proxy with `lb_policy round_robin`

## Architecture

- Two independent WebSocket servers.
- NATS is used to federate/synchronize state:
  - Request-Reply subjects (handled by the leader only):
    - `ttt.join`: assign X or O
    - `ttt.move`: validate and apply a move
  - Pub/Sub subject (all servers subscribe):
    - `ttt.update`: authoritative full game state broadcast after every change
- One server acts as a leader (set via `LEADER=true`) and performs validation and authoritative state updates. All servers receive `ttt.update` and forward updates to their connected clients immediately.
- Caddy sits in front of both WS servers and load balances connections using round-robin.

## Data model and rules

Game state (simplified):

```text
{
  board: [["","",""],["","",""],["","",""]],
  nextTurn: "X" | "O",
  players: { X?: clientId, O?: clientId },
  status: "playing" | "win" | "draw",
  winner?: "X" | "O",
  version: number
}
```

- Validation: wrong turn, occupied cell, out-of-bounds moves are rejected.
- Win/draw detection done every move; updates broadcast to all clients.

## Protocols

### Client ↔ Server (WebSocket JSON)

- Join:

```json
{ "type": "join" }
```

- Move:

```json
{ "type": "move", "row": 1, "col": 2 }
```

- Server messages:

```text
{ "type": "joined", "clientId": "...", "symbol": "X" }
{ "type": "update", "board": [[...],[...],[...]], "nextTurn": "O", "status": "playing" | "win" | "draw", "winner": "X"?, "version": 3 }
{ "type": "error", "message": "..." }
```

All messages are validated with Zod. Invalid messages are rejected.

### Server ↔ Server (NATS)

- Request-Reply (leader handles):

```text
Subject: ttt.join
Req:  { clientId }
Resp: { ok: true, symbol, state } | { ok: false, error }

Subject: ttt.move
Req:  { clientId, row, col }
Resp: { ok: true, state } | { ok: false, error }
```

- Pub/Sub:

```text
Subject: ttt.update
Msg:    { state }
```

## Running with Docker Compose (recommended)

Prerequisites: Docker + Docker Compose.

```shell
# From project root
docker compose up --build
```

Services started:

- NATS
- Server A (3001, leader)
- Server B (3002)
- Caddy reverse proxy (8080)

Two ways to connect clients:

- Through Caddy (load balanced): `ws://localhost:8080`
- Directly to a specific server: `ws://localhost:3001` (A) or `ws://localhost:3002` (B)

## CLI Client

In two separate terminals, run:

```shell
# Terminal 1
npm run client -- ws://localhost:8080

# Terminal 2
npm run client -- ws://localhost:8080
```

Alternatively, to ensure connecting to different servers:

```shell
# Terminal 1 -> Server A
npm run client -- ws://localhost:3001

# Terminal 2 -> Server B
npm run client -- ws://localhost:3002
```

Gameplay:

- Each client sends `join` on connect and gets assigned X or O.
- When it is your turn, you'll be prompted to enter a move: `row col` (0..2).
- The board updates in real-time on both clients.

## Local development (without Docker)

```shell
npm install

# Start NATS locally (or via Docker):
# Docker example:
#   docker run -p 4222:4222 nats:2

# Terminal 1 — Leader on :3001
PORT=3001 LEADER=true npm run dev

# Terminal 2 — Follower on :3002
PORT=3002 LEADER=false npm run dev

# Then connect two clients (in separate terminals):
npm run client -- ws://localhost:3001
npm run client -- ws://localhost:3002
```

## Where AI was used

- Project scaffolding, and code generation for the server/client, protocols and Docker/Caddy setup were AI-generated with iterative prompting.
- Prompt snippets included requests like: "Implement a WS server in TS with NATS request-reply for validation and publish updates," and "Create a CLI that renders an ASCII board and prompts only on your turn."
- Manual adjustments ensured ESM compatibility, strict typing, and Docker/Caddy integration.
