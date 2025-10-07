#!/usr/bin/env node
import readline from "node:readline/promises"

import { z } from "zod"

const WS_URL = process.env["WS_URL"] || process.argv[2] || "ws://localhost:8080"

let client:
  | {
      symbol: "X" | "O"
      id: string
    }
  | undefined
let latest:
  | {
      board: Array<"" | "X" | "O">[]
      nextTurn: "X" | "O"
      status: "playing" | "win" | "draw"
      winner?: "X" | "O"
    }
  | undefined

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function render() {
  if (!latest) return

  console.clear()
  console.log("Tic-Tac-Toe (CLI)")
  console.log(
    `You are: ${client ? client.symbol : "?"} | Client: ${client ? client.id : ""}`,
  )
  console.log(
    latest.board
      .map((row) => ` ${row.map((c) => c || " ").join(" | ")} `)
      .join("\n---+---+---\n"),
  )

  switch (latest.status) {
    case "win":
      console.log(`Winner: ${latest.winner}`)
      break

    case "draw":
      console.log("Draw!")
      break

    default:
      console.log(`Next turn: ${latest.nextTurn}`)
      break
  }
}

async function maybePrompt(ws: WebSocket) {
  if (!latest || !client) return
  if (latest.status !== "playing") return
  if (latest.nextTurn !== client.symbol) return

  const input = await rl.question("Your move (row col): ")

  const parts = input.trim().split(/\s+/)
  if (parts.length !== 2) {
    console.log("Enter as: row col (0..2)")
    await maybePrompt(ws)
    return
  }

  const row = Number(parts[0])
  const col = Number(parts[1])
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    console.log("Invalid numbers")
    await maybePrompt(ws)
    return
  }

  ws.send(JSON.stringify({ type: "move", row, col }))
}

console.log("Connecting...", { WS_URL })
const socket = new WebSocket(WS_URL)

socket.addEventListener("open", () => {
  console.log("Connected. Sending join...")
  socket.send(JSON.stringify({ type: "join" }))
})

const SymbolSchema = z.enum(["X", "O"])

const messageCodec = jsonCodec(
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("joined"),
      clientId: z.string(),
      symbol: SymbolSchema,
    }),
    z.object({
      type: z.literal("update"),
      board: z.array(z.union([z.literal(""), SymbolSchema]).array()),
      nextTurn: SymbolSchema,
      status: z.enum(["playing", "win", "draw"]),
      winner: SymbolSchema.optional(),
    }),
    z.object({
      type: z.literal("error"),
      message: z.string(),
    }),
  ]),
)

socket.addEventListener("message", (event) => {
  const parsed = messageCodec.safeDecode(event.data)

  if (!parsed.success) {
    console.warn("Unknown message", event.data)
    return
  }

  const { data } = parsed

  switch (data.type) {
    case "joined":
      client = { symbol: data.symbol, id: data.clientId }
      console.log("Joined game", {
        mySymbol: data.symbol,
        clientId: data.clientId,
      })
      break

    case "update":
      latest = data
      render()
      void maybePrompt(socket)
      break

    case "error":
      console.log("Error:", data.message)
      void maybePrompt(socket)
      break
  }
})

socket.addEventListener("close", () => {
  console.log("Disconnected")
  rl.close()
})

socket.addEventListener("error", (error) => {
  console.error("WebSocket error", error)
})

/** @see https://zod.dev/codecs#jsonschema */
function jsonCodec<T extends z.core.$ZodType>(schema: T) {
  return z.codec(z.string(), schema, {
    decode: (jsonString, ctx) => {
      try {
        return JSON.parse(jsonString)
      } catch (err: any) {
        ctx.issues.push({
          code: "invalid_format",
          format: "json",
          input: jsonString,
          message: err.message,
        })
        return z.NEVER
      }
    },
    encode: (value) => JSON.stringify(value),
  })
}
