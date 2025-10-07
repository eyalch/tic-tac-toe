import readline from "node:readline/promises"

import { z } from "zod"

import { BoardSchema, SymbolSchema, zJsonCodec } from "./schemas.ts"

const WS_URL = process.env["WS_URL"] || process.argv[2] || "ws://localhost:8080"

let mySymbol: "X" | "O" | undefined
let clientId: string | undefined
let latest:
  | {
      board: ("" | "X" | "O")[][]
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
  console.log(`You are: ${mySymbol ?? "?"} | Client: ${clientId}`)
  console.log(
    latest.board
      .map((row) => ` ${row[0] || " "} | ${row[1] || " "} | ${row[2] || " "} `)
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
  if (!latest || !mySymbol) return
  if (latest.status !== "playing") return
  if (latest.nextTurn !== mySymbol) return

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

socket.addEventListener("message", (event) => {
  const parsed = zJsonCodec(
    z.union([
      z.object({
        type: z.literal("joined"),
        clientId: z.string(),
        symbol: SymbolSchema,
      }),
      z.object({
        type: z.literal("update"),
        board: BoardSchema,
        nextTurn: SymbolSchema,
        status: z.enum(["playing", "win", "draw"]),
        winner: SymbolSchema.optional(),
      }),
      z.object({
        type: z.literal("error"),
        message: z.string(),
      }),
    ]),
  ).safeDecode(event.data)

  if (!parsed.success) {
    console.warn("Unknown message", event.data)
    return
  }

  const { data } = parsed

  switch (data.type) {
    case "joined":
      mySymbol = data.symbol
      clientId = data.clientId
      console.log("Joined game", { mySymbol, clientId })
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
