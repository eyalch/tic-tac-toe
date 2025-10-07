import { randomUUID } from "node:crypto"

import { connect, JSONCodec } from "nats"
import pino from "pino"
import { WebSocket, WebSocketServer } from "ws"
import { z } from "zod"

import { applyMove, newGameState } from "./game.ts"
import { GameStateSchema, SymbolSchema, zJsonCodec } from "./schemas.ts"

const logger = pino()

const port = Number(process.env["PORT"] || "3000")
const leader = String(process.env["LEADER"] || "").toLowerCase() === "true"

const natsUrl = process.env["NATS_URL"] || "nats://localhost:4222"
const nc = await connect({
  servers: natsUrl,
  name: "ttt-server",
})
logger.info({ url: natsUrl }, "Connected to NATS")

const jsonCodec = JSONCodec()

// Authoritative state lives on leader; followers mirror via updates.
let state = newGameState()

// WebSocket server
const wss = new WebSocketServer({ port })
logger.info({ port, leader }, "WebSocket server started")

const conns = new Map<WebSocket, { clientId: string }>()

// Leader: handle join and move requests
if (leader) {
  logger.info({ leader }, "Acting as leader")

  void handleJoins()
  void handleMoves()
} else {
  logger.info({ leader }, "Acting as follower")
}

// All servers: subscribe to updates to mirror state
void handleUpdates()

async function handleUpdates() {
  for await (const m of nc.subscribe("ttt.update")) {
    try {
      const parsed = z
        .object({ state: GameStateSchema })
        .parse(jsonCodec.decode(m.data))

      // Mirror authoritative state locally (for followers and leader).
      state = parsed.state

      const data = JSON.stringify({
        type: "update",
        board: state.board,
        nextTurn: state.nextTurn,
        status: state.status,
        winner: state.winner,
      })

      for (const ws of conns.keys()) {
        if (ws.readyState === ws.OPEN) {
          ws.send(data)
        }
      }
    } catch (error) {
      logger.error({ error }, "Invalid update publication")
    }
  }
}

wss.on("connection", (ws) => {
  const clientId = randomUUID()
  conns.set(ws, { clientId })

  const childLogger = logger.child({ clientId })
  childLogger.info("Client connected")

  ws.on("message", async (raw) => {
    const res = zJsonCodec(
      z.union([
        z.object({
          type: z.literal("join"),
        }),
        z.object({
          type: z.literal("move"),
          row: z.number().int().min(0).max(2),
          col: z.number().int().min(0).max(2),
        }),
      ]),
    ).safeDecode(String(raw))

    if (!res.success) {
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid message format" }),
      )
      return
    }

    const msg = res.data
    const { clientId } = conns.get(ws)!

    switch (msg.type) {
      case "join":
        try {
          const joinMsg = await nc.request(
            "ttt.join",
            jsonCodec.encode({ clientId }),
            { timeout: 3000 },
          )

          const parsedJoin = z
            .union([
              z.object({
                ok: z.literal(true),
                symbol: SymbolSchema,
                state: GameStateSchema,
              }),
              z.object({ ok: z.literal(false), error: z.string() }),
            ])
            .parse(jsonCodec.decode(joinMsg.data))

          if (parsedJoin.ok) {
            ws.send(
              JSON.stringify({
                type: "joined",
                clientId,
                symbol: parsedJoin.symbol,
              }),
            )

            // Also send current state to this client
            ws.send(
              JSON.stringify({
                type: "update",
                board: parsedJoin.state.board,
                nextTurn: parsedJoin.state.nextTurn,
                status: parsedJoin.state.status,
                winner: parsedJoin.state.winner,
              }),
            )
          } else {
            ws.send(
              JSON.stringify({ type: "error", message: parsedJoin.error }),
            )
          }
        } catch (error) {
          childLogger.error({ error }, "Join request failed")
          ws.send(JSON.stringify({ type: "error", message: "Join failed" }))
        }
        break

      case "move":
        try {
          const moveMsg = await nc.request(
            "ttt.move",
            jsonCodec.encode({ clientId, row: msg.row, col: msg.col }),
            { timeout: 3000 },
          )

          const parsedMove = z
            .union([
              z.object({ ok: z.literal(true), state: GameStateSchema }),
              z.object({ ok: z.literal(false), error: z.string() }),
            ])
            .parse(jsonCodec.decode(moveMsg.data))

          if (!parsedMove.ok) {
            ws.send(
              JSON.stringify({ type: "error", message: parsedMove.error }),
            )
          }

          // On success, the update publication will broadcast to all clients
        } catch (error) {
          childLogger.error({ error }, "Move request failed")
          ws.send(JSON.stringify({ type: "error", message: "Move failed" }))
        }
        break
    }
  })

  ws.on("close", () => {
    conns.delete(ws)
    childLogger.info("Client disconnected")
  })
})

async function handleJoins() {
  for await (const m of nc.subscribe("ttt.join")) {
    try {
      const req = z
        .object({
          clientId: z.string(),
        })
        .parse(jsonCodec.decode(m.data))

      // Determine assignment
      let symbol
      if (!state.players.X) symbol = "X"
      else if (!state.players.O) symbol = "O"

      if (!symbol) {
        m.respond(jsonCodec.encode({ ok: false, error: "Game is full" }))
        continue
      }

      // Update state
      state = {
        ...state,
        players: { ...state.players, [symbol]: req.clientId },
      }

      m.respond(jsonCodec.encode({ ok: true, symbol, state }))

      // Publish update to everyone
      nc.publish("ttt.update", jsonCodec.encode({ state }))
    } catch (error) {
      logger.error({ error }, "Error handling join")
      m.respond(jsonCodec.encode({ ok: false, error: "Unexpected error" }))
    }
  }
}

async function handleMoves() {
  for await (const m of nc.subscribe("ttt.move")) {
    try {
      const req = z
        .object({
          clientId: z.string(),
          row: z.number().int().min(0).max(2),
          col: z.number().int().min(0).max(2),
        })
        .parse(jsonCodec.decode(m.data))

      const sym =
        state.players.X === req.clientId
          ? "X"
          : state.players.O === req.clientId
            ? "O"
            : undefined

      if (!sym) {
        m.respond(jsonCodec.encode({ ok: false, error: "Player not joined" }))
        continue
      }

      try {
        state = applyMove(state, sym, req.row, req.col)
        nc.publish("ttt.update", jsonCodec.encode({ state }))
        m.respond(jsonCodec.encode({ ok: true, state }))
      } catch (e: any) {
        m.respond(
          jsonCodec.encode({
            ok: false,
            error: e?.message || "Invalid move",
          }),
        )
      }
    } catch (error) {
      logger.error({ error }, "Error handling move")
      m.respond(jsonCodec.encode({ ok: false, error: "Unexpected error" }))
    }
  }
}
