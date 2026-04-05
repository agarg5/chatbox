import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback } from 'react'

interface PostMessage {
  type: string
  toolName?: string
  params?: Record<string, unknown>
  invocationId?: string
  result?: Record<string, unknown>
}

interface Card {
  front: string
  back: string
}

interface DeckState {
  topic: string
  cards: Card[]
  currentIndex: number
  flipped: boolean
  known: Set<number>
  unknown: Set<number>
}

export const Route = createFileRoute('/apps/flashcards/')({
  component: FlashcardsApp,
})

function FlashcardsApp() {
  const [deck, setDeck] = useState<DeckState | null>(null)
  const [completed, setCompleted] = useState(false)

  const sendToParent = useCallback((msg: PostMessage) => {
    if (window.parent !== window) {
      window.parent.postMessage(msg, window.location.origin)
    }
  }, [])

  const getProgress = useCallback((d: DeckState) => {
    const reviewed = d.known.size + d.unknown.size
    return {
      topic: d.topic,
      totalCards: d.cards.length,
      reviewed,
      known: d.known.size,
      unknown: d.unknown.size,
      remaining: d.cards.length - reviewed,
      currentCard: d.currentIndex + 1,
      percentComplete: Math.round((reviewed / d.cards.length) * 100),
    }
  }, [])

  const checkCompletion = useCallback(
    (d: DeckState) => {
      const reviewed = d.known.size + d.unknown.size
      if (reviewed >= d.cards.length) {
        setCompleted(true)
        const progress = getProgress(d)
        sendToParent({
          type: 'APP_COMPLETE',
          result: {
            topic: d.topic,
            totalCards: d.cards.length,
            known: d.known.size,
            unknown: d.unknown.size,
            score: `${d.known.size}/${d.cards.length}`,
            percentCorrect: Math.round((d.known.size / d.cards.length) * 100),
          },
        })
        return true
      }
      return false
    },
    [sendToParent, getProgress]
  )

  // Find next unreviewed card
  const findNextUnreviewed = useCallback((d: DeckState, startFrom: number): number => {
    for (let i = 0; i < d.cards.length; i++) {
      const idx = (startFrom + i) % d.cards.length
      if (!d.known.has(idx) && !d.unknown.has(idx)) return idx
    }
    return startFrom // all reviewed
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const msg = event.data as PostMessage
      if (msg.type !== 'TOOL_INVOKE') return

      const { toolName, params, invocationId } = msg

      switch (toolName) {
        case 'create_deck': {
          const topic = (params?.topic as string) || 'General Knowledge'
          const cards = (params?.cards as Card[]) || []
          if (cards.length === 0) {
            sendToParent({
              type: 'TOOL_RESULT',
              invocationId,
              result: { error: 'No cards provided. Please provide an array of cards with front and back fields.' },
            })
            return
          }
          const newDeck: DeckState = {
            topic,
            cards,
            currentIndex: 0,
            flipped: false,
            known: new Set(),
            unknown: new Set(),
          }
          setDeck(newDeck)
          setCompleted(false)
          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: {
              topic,
              totalCards: cards.length,
              currentCard: 1,
              front: cards[0].front,
              status: 'deck_created',
              instruction: 'Flashcard deck is ready! The student can flip cards, mark them as known/unknown, and navigate through the deck.',
            },
          })
          break
        }
        case 'flip_card': {
          if (!deck) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active deck. Create a deck first.' } })
            return
          }
          setDeck((prev) => (prev ? { ...prev, flipped: !prev.flipped } : null))
          const card = deck.cards[deck.currentIndex]
          const nowFlipped = !deck.flipped
          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: {
              cardNumber: deck.currentIndex + 1,
              side: nowFlipped ? 'back' : 'front',
              content: nowFlipped ? card.back : card.front,
              ...(nowFlipped ? { front: card.front, back: card.back } : { front: card.front }),
            },
          })
          break
        }
        case 'next_card': {
          if (!deck) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active deck.' } })
            return
          }
          const nextIdx = Math.min(deck.currentIndex + 1, deck.cards.length - 1)
          setDeck((prev) => (prev ? { ...prev, currentIndex: nextIdx, flipped: false } : null))
          const progress = getProgress({ ...deck, currentIndex: nextIdx })
          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: {
              ...progress,
              cardNumber: nextIdx + 1,
              front: deck.cards[nextIdx].front,
            },
          })
          break
        }
        case 'prev_card': {
          if (!deck) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active deck.' } })
            return
          }
          const prevIdx = Math.max(deck.currentIndex - 1, 0)
          setDeck((prev) => (prev ? { ...prev, currentIndex: prevIdx, flipped: false } : null))
          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: {
              cardNumber: prevIdx + 1,
              totalCards: deck.cards.length,
              front: deck.cards[prevIdx].front,
            },
          })
          break
        }
        case 'get_progress': {
          if (!deck) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active deck.' } })
            return
          }
          sendToParent({ type: 'TOOL_RESULT', invocationId, result: getProgress(deck) })
          break
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [deck, sendToParent, getProgress, findNextUnreviewed, checkCompletion])

  useEffect(() => {
    sendToParent({ type: 'READY' })
  }, [sendToParent])

  // UI handlers that send USER_ACTION to parent (bidirectional like chess)
  const handleFlip = () => {
    if (!deck) return
    setDeck((prev) => (prev ? { ...prev, flipped: !prev.flipped } : null))
  }

  const handleMarkKnown = () => {
    if (!deck || !deck.flipped) return
    const newKnown = new Set(deck.known)
    newKnown.add(deck.currentIndex)
    const newUnknown = new Set(deck.unknown)
    newUnknown.delete(deck.currentIndex)
    const updatedDeck = { ...deck, known: newKnown, unknown: newUnknown }

    // Check completion before moving
    const reviewed = newKnown.size + newUnknown.size
    if (reviewed >= deck.cards.length) {
      setDeck(updatedDeck)
      setCompleted(true)
      sendToParent({
        type: 'USER_ACTION',
        result: {
          action: 'deck_complete',
          topic: deck.topic,
          totalCards: deck.cards.length,
          known: newKnown.size,
          unknown: newUnknown.size,
          score: `${newKnown.size}/${deck.cards.length}`,
          percentCorrect: Math.round((newKnown.size / deck.cards.length) * 100),
        },
      })
      sendToParent({
        type: 'APP_COMPLETE',
        result: {
          topic: deck.topic,
          totalCards: deck.cards.length,
          known: newKnown.size,
          unknown: newUnknown.size,
          score: `${newKnown.size}/${deck.cards.length}`,
          percentCorrect: Math.round((newKnown.size / deck.cards.length) * 100),
        },
      })
      return
    }

    // Move to next unreviewed card
    const nextIdx = findNextUnreviewed(updatedDeck, deck.currentIndex + 1)
    const finalDeck = { ...updatedDeck, currentIndex: nextIdx, flipped: false }
    setDeck(finalDeck)

    sendToParent({
      type: 'USER_ACTION',
      result: {
        action: 'marked_known',
        cardNumber: deck.currentIndex + 1,
        front: deck.cards[deck.currentIndex].front,
        back: deck.cards[deck.currentIndex].back,
        known: newKnown.size,
        unknown: newUnknown.size,
        remaining: deck.cards.length - reviewed,
        nextCard: deck.cards[nextIdx]?.front,
      },
    })
  }

  const handleMarkUnknown = () => {
    if (!deck || !deck.flipped) return
    const newUnknown = new Set(deck.unknown)
    newUnknown.add(deck.currentIndex)
    const newKnown = new Set(deck.known)
    newKnown.delete(deck.currentIndex)
    const updatedDeck = { ...deck, known: newKnown, unknown: newUnknown }

    const reviewed = newKnown.size + newUnknown.size
    if (reviewed >= deck.cards.length) {
      setDeck(updatedDeck)
      setCompleted(true)
      sendToParent({
        type: 'USER_ACTION',
        result: {
          action: 'deck_complete',
          topic: deck.topic,
          totalCards: deck.cards.length,
          known: newKnown.size,
          unknown: newUnknown.size,
          score: `${newKnown.size}/${deck.cards.length}`,
          percentCorrect: Math.round((newKnown.size / deck.cards.length) * 100),
        },
      })
      sendToParent({
        type: 'APP_COMPLETE',
        result: {
          topic: deck.topic,
          totalCards: deck.cards.length,
          known: newKnown.size,
          unknown: newUnknown.size,
          score: `${newKnown.size}/${deck.cards.length}`,
          percentCorrect: Math.round((newKnown.size / deck.cards.length) * 100),
        },
      })
      return
    }

    const nextIdx = findNextUnreviewed(updatedDeck, deck.currentIndex + 1)
    const finalDeck = { ...updatedDeck, currentIndex: nextIdx, flipped: false }
    setDeck(finalDeck)

    sendToParent({
      type: 'USER_ACTION',
      result: {
        action: 'marked_unknown',
        cardNumber: deck.currentIndex + 1,
        front: deck.cards[deck.currentIndex].front,
        back: deck.cards[deck.currentIndex].back,
        known: newKnown.size,
        unknown: newUnknown.size,
        remaining: deck.cards.length - reviewed,
        nextCard: deck.cards[nextIdx]?.front,
      },
    })
  }

  const handleRestart = () => {
    if (!deck) return
    setDeck({ ...deck, currentIndex: 0, flipped: false, known: new Set(), unknown: new Set() })
    setCompleted(false)
    sendToParent({
      type: 'USER_ACTION',
      result: { action: 'restart_deck', topic: deck.topic, totalCards: deck.cards.length },
    })
  }

  // Render
  if (!deck) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-900 p-6">
        <div className="text-6xl mb-4">📚</div>
        <h2 className="text-xl font-bold text-white mb-2">Flashcards</h2>
        <p className="text-sm text-zinc-400 text-center">
          Ask the chatbot to create a flashcard deck!
          <br />
          Try: &quot;Quiz me on the solar system&quot; or &quot;Make flashcards about US presidents&quot;
        </p>
      </div>
    )
  }

  if (completed) {
    const pct = Math.round((deck.known.size / deck.cards.length) * 100)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-900 p-6">
        <div className="text-6xl mb-4">{pct >= 80 ? '🎉' : pct >= 50 ? '👍' : '💪'}</div>
        <h2 className="text-xl font-bold text-white mb-2">Deck Complete!</h2>
        <p className="text-lg text-zinc-300 mb-1">{deck.topic}</p>
        <div className="flex gap-6 mt-4 mb-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-green-400">{deck.known.size}</p>
            <p className="text-xs text-zinc-500">Knew it</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-red-400">{deck.unknown.size}</p>
            <p className="text-xs text-zinc-500">Still learning</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-blue-400">{pct}%</p>
            <p className="text-xs text-zinc-500">Score</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRestart}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
        >
          Study Again
        </button>
      </div>
    )
  }

  const card = deck.cards[deck.currentIndex]
  const reviewed = deck.known.size + deck.unknown.size
  const progressPct = Math.round((reviewed / deck.cards.length) * 100)

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-900 p-4">
      {/* Header */}
      <div className="w-full max-w-md mb-4">
        <h2 className="text-lg font-bold text-white text-center">{deck.topic}</h2>
        <p className="text-xs text-zinc-500 text-center mt-1">
          Card {deck.currentIndex + 1} of {deck.cards.length} &middot; {reviewed} reviewed
        </p>
        {/* Progress bar */}
        <div className="w-full bg-zinc-800 rounded-full h-2 mt-2">
          <div
            className="h-2 rounded-full transition-all duration-300"
            style={{
              width: `${progressPct}%`,
              background: `linear-gradient(90deg, #22c55e ${deck.known.size > 0 ? (deck.known.size / deck.cards.length) * 100 : 0}%, #ef4444 100%)`,
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
          <span>{deck.known.size} known</span>
          <span>{deck.unknown.size} still learning</span>
        </div>
      </div>

      {/* Card */}
      <button
        type="button"
        onClick={handleFlip}
        className="w-full max-w-md cursor-pointer perspective-1000"
        style={{ perspective: '1000px' }}
      >
        <div
          className="relative w-full transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: deck.flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            minHeight: '220px',
          }}
        >
          {/* Front */}
          <div
            className="absolute inset-0 bg-zinc-800 rounded-xl border-2 border-zinc-600 p-6 flex flex-col items-center justify-center"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Question</p>
            <p className="text-lg text-white text-center leading-relaxed">{card.front}</p>
            <p className="text-xs text-zinc-600 mt-4">Tap to flip</p>
          </div>
          {/* Back */}
          <div
            className="absolute inset-0 bg-zinc-800 rounded-xl border-2 border-blue-600 p-6 flex flex-col items-center justify-center"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <p className="text-xs text-blue-400 mb-3 uppercase tracking-wider">Answer</p>
            <p className="text-lg text-white text-center leading-relaxed">{card.back}</p>
            <p className="text-xs text-zinc-600 mt-4">Rate yourself below</p>
          </div>
        </div>
      </button>

      {/* Actions */}
      <div className="flex gap-3 mt-6 w-full max-w-md">
        {deck.flipped ? (
          <>
            <button
              type="button"
              onClick={handleMarkUnknown}
              className="flex-1 py-3 bg-red-600/20 border border-red-700 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors text-sm font-medium"
            >
              Still Learning
            </button>
            <button
              type="button"
              onClick={handleMarkKnown}
              className="flex-1 py-3 bg-green-600/20 border border-green-700 text-green-400 rounded-lg hover:bg-green-600/30 transition-colors text-sm font-medium"
            >
              Knew It!
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleFlip}
            className="flex-1 py-3 bg-blue-600/20 border border-blue-700 text-blue-400 rounded-lg hover:bg-blue-600/30 transition-colors text-sm font-medium"
          >
            Flip Card
          </button>
        )}
      </div>

      {/* Nav */}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => setDeck((prev) => prev ? { ...prev, currentIndex: Math.max(0, prev.currentIndex - 1), flipped: false } : null)}
          disabled={deck.currentIndex === 0}
          className="px-3 py-1 text-xs text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
        >
          &larr; Prev
        </button>
        <button
          type="button"
          onClick={() => setDeck((prev) => prev ? { ...prev, currentIndex: Math.min(prev.cards.length - 1, prev.currentIndex + 1), flipped: false } : null)}
          disabled={deck.currentIndex === deck.cards.length - 1}
          className="px-3 py-1 text-xs text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Next &rarr;
        </button>
      </div>
    </div>
  )
}
