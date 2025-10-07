type SymbolXO = "X" | "O"
type Cell = "" | SymbolXO
type Board = [[Cell, Cell, Cell], [Cell, Cell, Cell], [Cell, Cell, Cell]]

type GameState = {
  board: Board
  nextTurn: SymbolXO
  players: { X?: string; O?: string } // clientId assignments
  status: "playing" | "win" | "draw"
  winner?: SymbolXO
}

export function newGameState(): GameState {
  return {
    board: [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
    ],
    nextTurn: "X",
    players: {},
    status: "playing",
  }
}

function checkWin(board: Board) {
  return [
    // Rows
    ...board,

    // Columns
    [board[0][0], board[1][0], board[2][0]],
    [board[0][1], board[1][1], board[2][1]],
    [board[0][2], board[1][2], board[2][2]],

    // Diagonals
    [board[0][0], board[1][1], board[2][2]],
    [board[0][2], board[1][1], board[2][0]],
  ].find(
    (line): line is Array<Exclude<(typeof line)[number], "">> =>
      line[0] !== "" && line.every((c) => c === line[0]),
  )?.[0]
}

function validateMove(
  state: GameState,
  playerSymbol: SymbolXO,
  row: number,
  col: number,
) {
  if (state.status !== "playing") return "Game is not in progress"
  if (state.nextTurn !== playerSymbol) return `Not ${playerSymbol}'s turn`
  if (row < 0 || row > 2 || col < 0 || col > 2) return "Out of bounds"
  const r = row as 0 | 1 | 2
  const c = col as 0 | 1 | 2
  if (state.board[r][c] !== "") return "Cell already occupied"
  return undefined
}

export function applyMove(
  state: GameState,
  playerSymbol: SymbolXO,
  row: number,
  col: number,
) {
  const err = validateMove(state, playerSymbol, row, col)
  if (err) {
    throw new Error(err)
  }

  const next = {
    ...state,
    board: state.board.with(
      row,
      state.board[row]!.with(col, playerSymbol) as Board[number],
    ) as Board,
  }

  const winner = checkWin(next.board)

  if (winner) {
    next.status = "win"
    next.winner = winner
  } else if (next.board.every((r) => r.every((c) => c === "X" || c === "O"))) {
    next.status = "draw"
  } else {
    next.nextTurn = ({ X: "O", O: "X" } as const)[playerSymbol]
  }

  return next
}
