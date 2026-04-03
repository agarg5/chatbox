import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================
// Types
// ============================================================

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
  toolCalls?: Array<{
    id: string
    toolName: string
    params: Record<string, unknown>
    result?: Record<string, unknown>
    status?: string
  }> | null
}

interface ActiveApp {
  appId: string
  iframeUrl: string
  anchorMessageId: string
}

interface PostMessage {
  type: string
  toolName?: string
  params?: Record<string, unknown>
  invocationId?: string
  result?: Record<string, unknown>
}

interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

// ============================================================
// SSE Parser
// ============================================================

async function* parseSSE(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const jsonStr = line.slice(6).trim()
      if (!jsonStr) continue
      try {
        yield JSON.parse(jsonStr)
      } catch {
        // skip
      }
    }
  }
}

// ============================================================
// Sub-components
// ============================================================

function ChatMessage({
  role,
  content,
  toolCalls,
}: {
  role: string
  content: string | null
  toolCalls?: DisplayMessage['toolCalls']
}) {
  if (!content && (!toolCalls || toolCalls.length === 0)) return null

  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          role === 'user'
            ? 'bg-blue-600 text-white'
            : role === 'tool'
              ? 'bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono text-sm'
              : 'bg-zinc-800 text-zinc-100'
        }`}
      >
        {content && <div className="whitespace-pre-wrap break-words">{content}</div>}
        {toolCalls && toolCalls.length > 0 && (
          <div className="mt-2 space-y-2">
            {toolCalls.map((tc) => (
              <div key={tc.id} className="bg-zinc-900 rounded px-3 py-2 text-sm border border-zinc-700">
                <div className="text-blue-400 font-mono text-xs mb-1">⚡ {tc.toolName}</div>
                {tc.status === 'pending' && <div className="text-yellow-400 text-xs">Running...</div>}
                {tc.result && (
                  <div className="text-zinc-400 text-xs font-mono overflow-x-auto">
                    {JSON.stringify(tc.result, null, 2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AppFrame({
  appId,
  iframeUrl,
  onRef,
}: {
  appId: string
  iframeUrl: string
  onRef?: (ref: React.RefObject<HTMLIFrameElement | null>) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    onRef?.(iframeRef)
  }, [onRef])

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (loading) {
        setError(true)
        setLoading(false)
      }
    }, 10000)

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'READY' && event.origin === window.location.origin) {
        setLoading(false)
        clearTimeout(timeout)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('message', handleMessage)
    }
  }, [loading])

  return (
    <div className="relative w-full h-full min-h-[400px] bg-zinc-900 rounded-lg overflow-hidden border border-zinc-700">
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2" />
            <p className="text-sm text-zinc-400">Loading {appId}...</p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 z-10">
          <div className="text-center text-red-400">
            <p className="text-lg mb-1">Failed to load app</p>
            <p className="text-sm text-zinc-400">{appId} did not respond in time</p>
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={iframeUrl}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        title={`${appId} app`}
        onLoad={() => {
          setTimeout(() => setLoading(false), 2000)
        }}
      />
    </div>
  )
}

function ChatInput({ onSend, disabled }: { onSend: (msg: string) => void; disabled?: boolean }) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, disabled, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  return (
    <div className="flex items-end gap-2 p-4 border-t border-zinc-700">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Type a message... Try: 'Let's play chess' or 'Weather in NYC'"
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 transition-colors"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || !input.trim()}
        className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity font-medium"
      >
        Send
      </button>
    </div>
  )
}

// ============================================================
// Route
// ============================================================

export const Route = createFileRoute('/chatbridge/')({
  component: ChatBridgePage,
})

function ChatBridgePage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [activeApps, setActiveApps] = useState<ActiveApp[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const iframeRefs = useRef<Map<string, React.RefObject<HTMLIFrameElement | null>>>(new Map())
  const convIdRef = useRef<string | null>(null)
  const isStreamingRef = useRef(false)
  const handleSendRef = useRef<((message: string) => Promise<void>) | null>(null)

  useEffect(() => {
    convIdRef.current = activeConvId
  }, [activeConvId])

  useEffect(() => {
    isStreamingRef.current = isStreaming
  }, [isStreaming])

  // Bootstrap apps on mount
  useEffect(() => {
    if (bootstrapped) return
    fetch('/api/bootstrap')
      .then(() => setBootstrapped(true))
      .catch(console.error)
  }, [bootstrapped])

  // Load conversations on mount
  useEffect(() => {
    fetch('/api/chat')
      .then((r) => r.json())
      .then((data) => setConversations(data.conversations || []))
      .catch(console.error)
  }, [])

  const loadConversation = useCallback(async (convId: string) => {
    setActiveConvId(convId)
    setActiveApps([])
    try {
      const res = await fetch(`/api/chat/${convId}`)
      const data = await res.json()
      const loadedMessages = (data.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role as DisplayMessage['role'],
        content: m.content,
        toolCalls:
          m.tool_calls?.map((tc: any) => ({
            id: tc.id,
            toolName: tc.function?.name || tc.toolName || 'unknown',
            params: tc.function?.arguments
              ? (() => {
                  try {
                    return JSON.parse(tc.function.arguments)
                  } catch {
                    return {}
                  }
                })()
              : (tc.params || {}),
            result: tc.result,
            status: tc.status || 'complete',
          })) || null,
      }))
      setMessages(loadedMessages)

      // Re-activate iframes for any apps referenced in tool calls
      const apps: ActiveApp[] = []
      const seenApps = new Set<string>()
      for (const msg of loadedMessages) {
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            const appId = tc.toolName.split('__')[0]
            if (appId && !seenApps.has(appId)) {
              seenApps.add(appId)
              apps.push({ appId, iframeUrl: `/apps/${appId}`, anchorMessageId: msg.id })
            }
          }
        }
      }
      if (apps.length > 0) setActiveApps(apps)
    } catch (err) {
      console.error('Failed to load conversation:', err)
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleNewChat = () => {
    setActiveConvId(null)
    setMessages([])
    setActiveApps([])
    setIsStreaming(false)
  }

  const handleDeleteConversation = useCallback(
    async (convId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      try {
        const res = await fetch(`/api/chat/${convId}`, { method: 'DELETE' })
        if (!res.ok) {
          console.error('Failed to delete conversation')
          return
        }
        setConversations((prev) => prev.filter((c) => c.id !== convId))
        if (activeConvId === convId) {
          setActiveConvId(null)
          setMessages([])
          setActiveApps([])
        }
      } catch (err) {
        console.error('Failed to delete conversation:', err)
      }
    },
    [activeConvId]
  )

  const handleIframeRef = useCallback((appId: string, ref: React.RefObject<HTMLIFrameElement | null>) => {
    iframeRefs.current.set(appId, ref)
  }, [])

  const invokeToolInIframe = useCallback(
    (appId: string, toolName: string, params: Record<string, unknown>, invocationId: string): Promise<Record<string, unknown>> => {
      return new Promise((resolve, reject) => {
        const timeoutMs = toolName === 'make_move' ? 30000 : 10000

        const timeout = setTimeout(() => {
          window.removeEventListener('message', handler)
          reject(new Error('Tool invocation timed out'))
        }, timeoutMs)

        const handler = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return
          const msg = event.data as PostMessage
          if (msg.type === 'TOOL_RESULT' && msg.invocationId === invocationId) {
            clearTimeout(timeout)
            window.removeEventListener('message', handler)
            resolve(msg.result || {})
          }
        }

        window.addEventListener('message', handler)

        const iframeRef = iframeRefs.current.get(appId)
        const iframe = iframeRef?.current
        if (!iframe?.contentWindow) {
          clearTimeout(timeout)
          window.removeEventListener('message', handler)
          reject(new Error('Iframe not available'))
          return
        }

        iframe.contentWindow.postMessage(
          { type: 'TOOL_INVOKE', toolName, params, invocationId } as PostMessage,
          window.location.origin
        )
      })
    },
    []
  )

  const processStream = useCallback(
    async (response: Response, assistantId: string, currentConvId: string | null) => {
      const pendingToolCalls: Array<{
        id: string
        appId: string
        rawToolName: string
        params: Record<string, unknown>
      }> = []

      for await (const event of parseSSE(response)) {
        if (event.type === 'text_delta') {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: (m.content || '') + event.content } : m))
          )
        } else if (event.type === 'tool_call') {
          const appId = event.appId || event.toolName.split('__')[0]

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    toolCalls: [
                      ...(m.toolCalls || []),
                      { id: event.invocationId, toolName: event.toolName, params: event.params, status: 'pending' },
                    ],
                  }
                : m
            )
          )

          setActiveApps((prev) => {
            if (prev.find((a) => a.appId === appId)) return prev
            return [...prev, { appId, iframeUrl: `/apps/${appId}`, anchorMessageId: assistantId }]
          })

          pendingToolCalls.push({
            id: event.invocationId,
            appId,
            rawToolName: event.rawToolName || event.toolName.split('__')[1],
            params: event.params,
          })
        } else if (event.type === 'conversation_id' || event.type === 'done') {
          const convId = event.conversationId || currentConvId
          if (convId && !convIdRef.current) {
            setActiveConvId(convId)
            fetch('/api/chat')
              .then((r) => r.json())
              .then((data) => setConversations(data.conversations || []))
          }
        } else if (event.type === 'error') {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: `Error: ${event.error}` } : m))
          )
        }
      }

      // If there were tool calls, invoke them via iframes and send results back
      if (pendingToolCalls.length > 0) {
        const appIds = new Set(pendingToolCalls.map((tc) => tc.appId))

        // Phase 1: Wait for iframe DOM mount
        await new Promise<void>((resolve) => {
          const deadline = Date.now() + 8000
          const poll = () => {
            const allMounted = [...appIds].every((id) => iframeRefs.current.get(id)?.current?.contentWindow)
            if (allMounted) resolve()
            else if (Date.now() > deadline) resolve()
            else requestAnimationFrame(poll)
          }
          setTimeout(poll, 50)
        })

        // Phase 2: Wait for READY signal
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5000)
          const readyApps = new Set<string>()

          const handler = (event: MessageEvent) => {
            if (event.data?.type === 'READY' && event.origin === window.location.origin) {
              for (const id of appIds) {
                const iframe = iframeRefs.current.get(id)?.current
                if (iframe?.contentWindow === event.source) {
                  readyApps.add(id)
                }
              }
              if ([...appIds].every((id) => readyApps.has(id))) {
                clearTimeout(timeout)
                window.removeEventListener('message', handler)
                setTimeout(resolve, 100)
              }
            }
          }
          window.addEventListener('message', handler)

          const allAlreadyReady = [...appIds].every((id) => iframeRefs.current.get(id)?.current?.contentWindow)
          if (allAlreadyReady) {
            clearTimeout(timeout)
            window.removeEventListener('message', handler)
            setTimeout(resolve, 500)
          }
        })

        const toolResults: Array<{ toolCallId: string; result: Record<string, unknown> }> = []

        for (const tc of pendingToolCalls) {
          try {
            const result = await invokeToolInIframe(tc.appId, tc.rawToolName, tc.params, tc.id)
            toolResults.push({ toolCallId: tc.id, result })

            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolCalls: m.toolCalls?.map((t) => (t.id === tc.id ? { ...t, result, status: 'success' } : t)),
                    }
                  : m
              )
            )
          } catch (err) {
            const errorResult = { error: err instanceof Error ? err.message : 'Tool failed' }
            toolResults.push({ toolCallId: tc.id, result: errorResult })

            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolCalls: m.toolCalls?.map((t) =>
                        t.id === tc.id ? { ...t, result: errorResult, status: 'error' } : t
                      ),
                    }
                  : m
              )
            )
          }
        }

        // Send tool results back to server to continue conversation
        const convId = convIdRef.current
        if (convId && toolResults.length > 0) {
          const continuationAssistantId = `assistant-${Date.now()}`
          setMessages((prev) => [...prev, { id: continuationAssistantId, role: 'assistant', content: '' }])

          const continuationRes = await fetch(`/api/chat/${convId}/tool-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolResults }),
          })

          await processStream(continuationRes, continuationAssistantId, convId)
        }
      }
    },
    [invokeToolInIframe]
  )

  const handleSend = useCallback(
    async (message: string) => {
      const userMsg: DisplayMessage = { id: `temp-${Date.now()}`, role: 'user', content: message }
      setMessages((prev) => [...prev, userMsg])
      setIsStreaming(true)

      const assistantId = `assistant-${Date.now()}`
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }])

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: convIdRef.current, message }),
        })

        await processStream(res, assistantId, convIdRef.current)
      } catch (err) {
        console.error('Stream error:', err)
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: 'Failed to get response. Please try again.' } : m))
        )
      } finally {
        setIsStreaming(false)
      }
    },
    [processStream]
  )

  useEffect(() => {
    handleSendRef.current = handleSend
  }, [handleSend])

  // Listen for USER_ACTION (board moves) and APP_COMPLETE from iframes
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const msg = event.data as PostMessage

      if (msg.type === 'USER_ACTION' && msg.result) {
        const result = msg.result as Record<string, unknown>
        const move = result.move as string
        const moveHistory = result.moveHistory as string[]
        const fen = result.fen as string
        const gameStatus = result.status as string

        let autoMessage: string
        if (gameStatus === 'checkmate') {
          autoMessage = `I played ${move}. That's checkmate! The game is over.`
        } else if (gameStatus === 'draw') {
          autoMessage = `I played ${move}. The game is a draw.`
        } else {
          autoMessage = `I moved ${move} on the board. The AI opponent responded. Current position after ${moveHistory?.length || '?'} moves: ${fen}. What do you think of the position?`
        }

        if (!isStreamingRef.current && handleSendRef.current) {
          handleSendRef.current(autoMessage)
        }
      }

      if (msg.type === 'APP_COMPLETE') {
        setMessages((prev) => [
          ...prev,
          { id: `complete-${Date.now()}`, role: 'assistant', content: `Game over: ${JSON.stringify(msg.result)}` },
        ])
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Build anchor map for inline app rendering
  const appAnchorMap = new Map<string, ActiveApp>()
  for (const app of activeApps) {
    appAnchorMap.set(app.anchorMessageId, app)
  }

  return (
    <div className="flex h-full w-full">
      {/* Conversation sidebar (inside Chatbox's main content area) */}
      <div className="w-56 border-r border-zinc-700 flex flex-col bg-zinc-900/50">
        <div className="p-3 border-b border-zinc-700">
          <button
            type="button"
            onClick={handleNewChat}
            className="w-full px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors"
          >
            + New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center border-b border-zinc-800 hover:bg-zinc-800 transition-colors ${
                conv.id === activeConvId ? 'bg-zinc-800 text-white' : 'text-zinc-400'
              }`}
            >
              <button
                type="button"
                onClick={() => loadConversation(conv.id)}
                className="flex-1 text-left px-3 py-2 text-sm truncate min-w-0"
              >
                {conv.title}
              </button>
              <button
                type="button"
                onClick={(e) => handleDeleteConversation(conv.id, e)}
                className="hidden group-hover:flex items-center justify-center w-7 h-7 mr-1 shrink-0 text-zinc-500 hover:text-red-400 transition-colors rounded"
                title="Delete conversation"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="h-12 border-b border-zinc-700 flex items-center px-4">
          <h1 className="text-base font-semibold text-zinc-100">
            {activeConvId ? conversations.find((c) => c.id === activeConvId)?.title || 'Chat' : 'ChatBridge'}
          </h1>
          <span className="ml-2 text-xs text-zinc-500">AI chat with third-party app integration</span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2 text-zinc-300">ChatBridge</h2>
                <p className="text-sm">AI chat with third-party app integration</p>
                <p className="text-xs mt-4 text-zinc-600">
                  Try: &quot;Let&apos;s play chess&quot; · &quot;Weather in NYC&quot; · &quot;Show issues in
                  facebook/react&quot;
                </p>
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id}>
              <ChatMessage role={msg.role} content={msg.content} toolCalls={msg.toolCalls} />
              {appAnchorMap.has(msg.id) && (
                <div className="mb-4 max-w-full">
                  <div className="rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900" style={{ height: 480 }}>
                    <AppFrame
                      appId={appAnchorMap.get(msg.id)!.appId}
                      iframeUrl={appAnchorMap.get(msg.id)!.iframeUrl}
                      onRef={(ref) => handleIframeRef(appAnchorMap.get(msg.id)!.appId, ref)}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>
    </div>
  )
}
