import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'

interface PostMessage {
  type: string
  toolName?: string
  params?: Record<string, unknown>
  invocationId?: string
  result?: Record<string, unknown>
}

interface GameState {
  game: Chess
  playerColor: 'white' | 'black'
  difficulty: number
  gameId: string
}

function getAIMove(game: Chess, difficulty: number): { from: string; to: string } | null {
  const moves = game.moves({ verbose: true })
  if (moves.length === 0) return null

  if (difficulty <= 3) {
    const idx = Math.floor(Math.random() * moves.length)
    return { from: moves[idx].from, to: moves[idx].to }
  }

  const scored = moves.map((move) => {
    let score = Math.random() * 0.5
    if (move.captured) score += { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }[move.captured] || 0
    if (move.san.includes('+')) score += 2
    if (move.san.includes('#')) score += 100
    if (['d4', 'd5', 'e4', 'e5'].includes(move.to)) score += 0.5
    if (['c3', 'c6', 'f3', 'f6', 'd3', 'd6', 'e3', 'e6'].includes(move.to)) score += 0.25
    return { move, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const topN = Math.max(1, Math.floor(moves.length * (1 - difficulty / 12)))
  const pick = scored[Math.floor(Math.random() * Math.min(topN, scored.length))]
  return { from: pick.move.from, to: pick.move.to }
}

export const Route = createFileRoute('/apps/chess/')({
  component: ChessApp,
})

function ChessApp() {
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [status, setStatus] = useState('Waiting for game to start...')
  const gameRef = useRef<Chess | null>(null)

  const sendToParent = useCallback((msg: PostMessage) => {
    if (window.parent !== window) {
      window.parent.postMessage(msg, window.location.origin)
    }
  }, [])

  const checkGameEnd = useCallback(
    (game: Chess) => {
      if (game.isCheckmate()) {
        const winner = game.turn() === 'w' ? 'black' : 'white'
        setStatus(`Checkmate! ${winner} wins!`)
        sendToParent({
          type: 'APP_COMPLETE',
          result: { outcome: 'checkmate', winner, totalMoves: game.history().length, finalFen: game.fen() },
        })
        return true
      }
      if (game.isDraw()) {
        let reason = 'draw'
        if (game.isStalemate()) reason = 'stalemate'
        else if (game.isThreefoldRepetition()) reason = 'repetition'
        else if (game.isInsufficientMaterial()) reason = 'insufficient material'
        setStatus(`Game over: ${reason}`)
        sendToParent({
          type: 'APP_COMPLETE',
          result: { outcome: reason, winner: null, totalMoves: game.history().length, finalFen: game.fen() },
        })
        return true
      }
      if (game.isCheck()) {
        setStatus('Check!')
      } else {
        setStatus(`${game.turn() === 'w' ? 'White' : 'Black'}'s turn`)
      }
      return false
    },
    [sendToParent]
  )

  const makeAIMove = useCallback(
    (game: Chess, difficulty: number) => {
      setTimeout(() => {
        const aiMove = getAIMove(game, difficulty)
        if (aiMove) {
          game.move({ from: aiMove.from as Square, to: aiMove.to as Square })
          gameRef.current = game
          setGameState((prev) => (prev ? { ...prev, game: Object.create(game) } : null))
          checkGameEnd(game)
        }
      }, 300 + Math.random() * 500)
    },
    [checkGameEnd]
  )

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const msg = event.data as PostMessage
      if (msg.type !== 'TOOL_INVOKE') return

      const { toolName, params, invocationId } = msg

      switch (toolName) {
        case 'new_game': {
          const color = (params?.color as string) || 'white'
          const difficulty = (params?.difficulty as number) || 5
          const game = new Chess()
          const gameId = `game_${Date.now()}`

          gameRef.current = game
          setGameState({ game, playerColor: color as 'white' | 'black', difficulty, gameId })
          setStatus(`Game started! You play as ${color}.`)

          if (color === 'black') makeAIMove(game, difficulty)

          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: { gameId, fen: game.fen(), playerColor: color, difficulty, status: 'in_progress' },
          })
          break
        }
        case 'get_board_state': {
          const game = gameRef.current
          if (!game) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active game' } })
            break
          }
          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: {
              fen: game.fen(),
              moveHistory: game.history(),
              turn: game.turn() === 'w' ? 'white' : 'black',
              isCheck: game.isCheck(),
              isCheckmate: game.isCheckmate(),
              isDraw: game.isDraw(),
              isGameOver: game.isGameOver(),
              moveCount: game.history().length,
            },
          })
          break
        }
        case 'make_move': {
          const game = gameRef.current
          if (!game) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active game' } })
            break
          }
          try {
            const from = params?.from as string
            const to = params?.to as string
            game.move({ from: from as Square, to: to as Square })
            setGameState((prev) => (prev ? { ...prev, game: Object.create(game) } : null))
            const ended = checkGameEnd(game)
            if (!ended && gameState) makeAIMove(game, gameState.difficulty)
            setTimeout(() => {
              sendToParent({
                type: 'TOOL_RESULT',
                invocationId,
                result: {
                  fen: game.fen(),
                  moveHistory: game.history({ verbose: true }).slice(-2),
                  isGameOver: game.isGameOver(),
                  status: game.isGameOver() ? (game.isCheckmate() ? 'checkmate' : 'draw') : 'in_progress',
                },
              })
            }, 1000)
          } catch {
            sendToParent({
              type: 'TOOL_RESULT',
              invocationId,
              result: { error: 'Invalid move', legalMoves: game.moves() },
            })
          }
          break
        }
        case 'get_hint': {
          const game = gameRef.current
          if (!game) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active game' } })
            break
          }
          const hint = getAIMove(game, 8)
          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: hint
              ? { suggestedMove: `${hint.from} to ${hint.to}`, from: hint.from, to: hint.to }
              : { error: 'No moves available' },
          })
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [gameState, sendToParent, makeAIMove, checkGameEnd])

  useEffect(() => {
    sendToParent({ type: 'READY' })
  }, [sendToParent])

  const onPieceDrop = useCallback(
    ({
      sourceSquare,
      targetSquare,
    }: {
      piece: { isSparePiece: boolean; position: string; pieceType: string }
      sourceSquare: string
      targetSquare: string | null
    }) => {
      if (!targetSquare) return false
      const game = gameRef.current
      if (!game || !gameState) return false

      const isPlayerTurn =
        (game.turn() === 'w' && gameState.playerColor === 'white') ||
        (game.turn() === 'b' && gameState.playerColor === 'black')
      if (!isPlayerTurn) return false

      try {
        const moveResult = game.move({
          from: sourceSquare as Square,
          to: targetSquare as Square,
          promotion: 'q',
        })
        setGameState((prev) => (prev ? { ...prev, game: Object.create(game) } : null))

        const ended = checkGameEnd(game)
        if (!ended) makeAIMove(game, gameState.difficulty)

        setTimeout(() => {
          sendToParent({
            type: 'USER_ACTION',
            result: {
              action: 'board_move',
              move: moveResult.san,
              from: sourceSquare,
              to: targetSquare,
              fen: game.fen(),
              isGameOver: game.isGameOver(),
              status: game.isGameOver() ? (game.isCheckmate() ? 'checkmate' : 'draw') : 'in_progress',
              moveHistory: game.history(),
            },
          })
        }, 800)

        return true
      } catch {
        return false
      }
    },
    [gameState, checkGameEnd, makeAIMove, sendToParent]
  )

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-900 p-4">
      <h2 className="text-xl font-bold text-white mb-2">Chess</h2>
      <p className="text-sm text-zinc-400 mb-4">{status}</p>

      <div style={{ width: 400, height: 400 }}>
        {gameState ? (
          <Chessboard
            options={{
              position: gameState.game.fen(),
              boardOrientation: gameState.playerColor,
              onPieceDrop,
              allowDragging: true,
              showAnimations: true,
              animationDurationInMs: 200,
              darkSquareStyle: { backgroundColor: '#779952' },
              lightSquareStyle: { backgroundColor: '#edeed1' },
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center border border-zinc-700 rounded-lg">
            <p className="text-zinc-500">Ask the chatbot to start a chess game!</p>
          </div>
        )}
      </div>

      {gameState && (
        <div className="mt-4 text-xs text-zinc-500">
          <p>
            Moves: {gameState.game.history().length} | Difficulty: {gameState.difficulty}/10
          </p>
        </div>
      )}
    </div>
  )
}
