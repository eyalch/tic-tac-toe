import { z } from "zod"

export const SymbolSchema = z.enum(["X", "O"])

const BoardCellSchema = z.union([z.literal(""), SymbolSchema])

export const GameStateSchema = z.object({
  board: z.tuple([
    z.tuple([BoardCellSchema, BoardCellSchema, BoardCellSchema]),
    z.tuple([BoardCellSchema, BoardCellSchema, BoardCellSchema]),
    z.tuple([BoardCellSchema, BoardCellSchema, BoardCellSchema]),
  ]),
  nextTurn: SymbolSchema,
  players: z.object({ X: z.string().optional(), O: z.string().optional() }),
  status: z.enum(["playing", "win", "draw"]),
  winner: SymbolSchema.optional(),
})

/** @see https://zod.dev/codecs#jsonschema */
export const zJsonCodec = <T extends z.core.$ZodType>(schema: T) =>
  z.codec(z.string(), schema, {
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
