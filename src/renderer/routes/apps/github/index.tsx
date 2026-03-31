import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef } from 'react'

interface PostMessage {
  type: string
  toolName?: string
  params?: Record<string, unknown>
  invocationId?: string
  result?: Record<string, unknown>
}

interface GitHubIssue {
  number: number; title: string; state: string
  labels: Array<{ name: string; color: string }>
  assignee: { login: string; avatar_url: string } | null
  user: { login: string; avatar_url: string }
  body: string | null; comments: number
  created_at: string; updated_at: string; html_url: string
}

interface GitHubComment {
  id: number; user: { login: string; avatar_url: string }; body: string; created_at: string
}

interface GitHubRepo { full_name: string; name: string; owner: { login: string }; description: string | null; open_issues_count: number; private: boolean }

async function ghFetch(path: string, token: string | null, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(options?.headers as Record<string, string> || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(`https://api.github.com${path}`, { ...options, headers })
}

async function listRepos(token: string | null): Promise<GitHubRepo[]> { const res = await ghFetch('/user/repos?sort=updated&per_page=30&affiliation=owner,collaborator,organization_member', token); if (!res.ok) throw new Error(`GitHub API error: ${res.status}`); return res.json() }
async function listIssues(token: string | null, repo: string, state = 'open', labels?: string): Promise<GitHubIssue[]> { let url = `/repos/${repo}/issues?state=${state}&per_page=30`; if (labels) url += `&labels=${encodeURIComponent(labels)}`; const res = await ghFetch(url, token); if (!res.ok) throw new Error(`GitHub API error: ${res.status}`); return res.json() }
async function getIssue(token: string | null, repo: string, issueNumber: number): Promise<GitHubIssue> { const res = await ghFetch(`/repos/${repo}/issues/${issueNumber}`, token); if (!res.ok) throw new Error(`GitHub API error: ${res.status}`); return res.json() }
async function getIssueComments(token: string | null, repo: string, issueNumber: number): Promise<GitHubComment[]> { const res = await ghFetch(`/repos/${repo}/issues/${issueNumber}/comments?per_page=30`, token); if (!res.ok) throw new Error(`GitHub API error: ${res.status}`); return res.json() }
async function createIssue(token: string, repo: string, title: string, body?: string, labels?: string[]): Promise<GitHubIssue> { const res = await ghFetch(`/repos/${repo}/issues`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body: body || '', labels: labels || [] }) }); if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(`GitHub API error: ${res.status} - ${(err as any).message || 'Unknown'}`) } return res.json() }
async function searchIssues(token: string | null, query: string): Promise<GitHubIssue[]> { const res = await ghFetch(`/search/issues?q=${encodeURIComponent(query)}&per_page=20`, token); if (!res.ok) throw new Error(`GitHub API error: ${res.status}`); const data = await res.json(); return data.items || [] }

type View = 'list' | 'detail' | 'create'

export const Route = createFileRoute('/apps/github/')({
  component: GitHubApp,
})

function GitHubApp() {
  const [token, setToken] = useState<string | null>(null)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [selectedRepo, setSelectedRepo] = useState('')
  const [issues, setIssues] = useState<GitHubIssue[]>([])
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null)
  const [issueComments, setIssueComments] = useState<GitHubComment[]>([])
  const [view, setView] = useState<View>('list')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterState, setFilterState] = useState('open')
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newLabels, setNewLabels] = useState('')
  const [repoInput, setRepoInput] = useState('')
  const popupRef = useRef<Window | null>(null)

  const sendToParent = useCallback((msg: PostMessage) => {
    if (window.parent !== window) window.parent.postMessage(msg, window.location.origin)
  }, [])

  useEffect(() => { sendToParent({ type: 'READY' }) }, [sendToParent])

  useEffect(() => {
    if (!token) return
    setLoading(true)
    listRepos(token).then((r) => { setRepos(r); setLoading(false) }).catch((err) => { setError(err.message); setLoading(false) })
  }, [token])

  useEffect(() => {
    if (!selectedRepo) return
    setLoading(true); setError(null)
    listIssues(token, selectedRepo, filterState).then((iss) => { setIssues(iss); setLoading(false) }).catch((err) => { setError(err.message); setLoading(false) })
  }, [token, selectedRepo, filterState])

  useEffect(() => {
    const handlePopupMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GITHUB_TOKEN' && event.data?.token) {
        setToken(event.data.token); popupRef.current?.close()
      }
    }
    window.addEventListener('message', handlePopupMessage)
    return () => window.removeEventListener('message', handlePopupMessage)
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const msg = event.data as PostMessage
      if (msg.type === 'CONTEXT_UPDATE') {
        const ghToken = (msg as any).githubToken
        if (ghToken) setToken(ghToken)
        return
      }
      if (msg.type !== 'TOOL_INVOKE') return
      const { toolName, params, invocationId } = msg

      if (!token && toolName === 'create_issue') {
        sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'AUTH_REQUIRED', message: 'GitHub authentication required to create issues.' } })
        return
      }

      const handleTool = async (): Promise<Record<string, unknown>> => {
        try {
          if (toolName === 'list_issues') {
            const repo = params?.repo as string
            if (!repo) return { error: "Parameter 'repo' is required" }
            setSelectedRepo(repo); setFilterState((params?.state as string) || 'open')
            const result = await listIssues(token, repo, (params?.state as string) || 'open', params?.labels as string)
            setIssues(result); setView('list')
            return { repo, state: (params?.state as string) || 'open', count: result.length, issues: result.map((i) => ({ number: i.number, title: i.title, state: i.state, labels: i.labels.map((l) => l.name), assignee: i.assignee?.login || null, comments: i.comments, created_at: i.created_at })) }
          } else if (toolName === 'get_issue') {
            const repo = params?.repo as string; const issueNumber = params?.issue_number as number
            if (!repo || !issueNumber) return { error: "Parameters 'repo' and 'issue_number' are required" }
            setSelectedRepo(repo)
            const issue = await getIssue(token, repo, issueNumber)
            const comments = await getIssueComments(token, repo, issueNumber)
            setSelectedIssue(issue); setIssueComments(comments); setView('detail')
            return { number: issue.number, title: issue.title, state: issue.state, body: issue.body, labels: issue.labels.map((l) => l.name), assignee: issue.assignee?.login || null, author: issue.user.login, comments: comments.map((c) => ({ author: c.user.login, body: c.body, created_at: c.created_at })), created_at: issue.created_at, html_url: issue.html_url }
          } else if (toolName === 'create_issue') {
            if (!token) return { error: 'AUTH_REQUIRED' }
            const repo = params?.repo as string; const title = params?.title as string
            if (!repo || !title) return { error: "Parameters 'repo' and 'title' are required" }
            setSelectedRepo(repo)
            const created = await createIssue(token!, repo, title, params?.body as string, params?.labels as string[])
            const updatedIssues = await listIssues(token!, repo, 'open')
            setIssues(updatedIssues); setView('list')
            return { number: created.number, title: created.title, state: created.state, html_url: created.html_url, labels: created.labels.map((l) => l.name), created_at: created.created_at }
          } else if (toolName === 'search_issues') {
            const query = params?.query as string
            if (!query) return { error: "Parameter 'query' is required" }
            const results = await searchIssues(token, query)
            setIssues(results); setView('list')
            return { query, count: results.length, issues: results.map((i) => ({ number: i.number, title: i.title, state: i.state, labels: i.labels.map((l) => l.name), html_url: i.html_url })) }
          }
          return { error: `Unknown tool: ${toolName}` }
        } catch (err) { return { error: err instanceof Error ? err.message : 'Unknown error' } }
      }
      handleTool().then((result) => { sendToParent({ type: 'TOOL_RESULT', invocationId, result }) })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [token, sendToParent])

  const handleConnect = () => { popupRef.current = window.open('/api/auth/github/start', 'github-oauth', 'width=600,height=700,popup=yes') }
  const openIssueDetail = async (issue: GitHubIssue) => {
    if (!selectedRepo) return; setLoading(true)
    try { const comments = await getIssueComments(token, selectedRepo, issue.number); setSelectedIssue(issue); setIssueComments(comments); setView('detail') } catch (err) { setError(err instanceof Error ? err.message : 'Failed') }
    setLoading(false)
  }
  const handleCreateIssue = async () => {
    if (!token || !selectedRepo || !newTitle.trim()) return; setLoading(true); setError(null)
    try {
      const labels = newLabels.split(',').map((l) => l.trim()).filter(Boolean)
      await createIssue(token, selectedRepo, newTitle.trim(), newBody.trim() || undefined, labels.length > 0 ? labels : undefined)
      setNewTitle(''); setNewBody(''); setNewLabels('')
      const updatedIssues = await listIssues(token, selectedRepo, filterState); setIssues(updatedIssues); setView('list')
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create issue') }
    setLoading(false)
  }
  const handleLoadRepo = () => { const repo = repoInput.trim(); if (!repo || !repo.includes('/')) return; setSelectedRepo(repo); setView('list'); setError(null) }

  return (
    <div className="min-h-screen bg-zinc-900 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">GitHub Issues</h2>
        <div className="flex items-center gap-2">
          {view !== 'list' && <button type="button" onClick={() => { setView('list'); setSelectedIssue(null) }} className="text-sm text-zinc-400 hover:text-white">Back to list</button>}
          {!token && <button type="button" onClick={handleConnect} className="text-xs text-zinc-500 hover:text-white border border-zinc-700 rounded px-2 py-1">Connect GitHub</button>}
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {token ? (
          <select value={selectedRepo} onChange={(e) => { setSelectedRepo(e.target.value); setView('list'); setSelectedIssue(null) }} className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
            <option value="">Select a repository...</option>
            {repos.map((r) => <option key={r.full_name} value={r.full_name}>{r.full_name}{r.private ? ' (private)' : ''}</option>)}
          </select>
        ) : (
          <>
            <input type="text" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLoadRepo()} placeholder="owner/repo (e.g. facebook/react)" className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-zinc-500" />
            <button type="button" onClick={handleLoadRepo} disabled={!repoInput.includes('/')} className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50">Load</button>
          </>
        )}
        {selectedRepo && view === 'list' && token && <button type="button" onClick={() => { setNewTitle(''); setNewBody(''); setNewLabels(''); setView('create') }} className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg">+ New Issue</button>}
      </div>

      {error && <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">{error} <button type="button" onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-200">Dismiss</button></div>}
      {loading && <div className="flex items-center justify-center py-8"><div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin" /></div>}

      {view === 'create' && !loading && (
        <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-4 space-y-4">
          <h3 className="text-white font-semibold">Create New Issue</h3>
          <div><label className="block text-sm text-zinc-400 mb-1">Title</label><input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Issue title" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-zinc-500" /></div>
          <div><label className="block text-sm text-zinc-400 mb-1">Description</label><textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Describe the issue" rows={6} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-zinc-500 resize-y" /></div>
          <div><label className="block text-sm text-zinc-400 mb-1">Labels (comma-separated)</label><input type="text" value={newLabels} onChange={(e) => setNewLabels(e.target.value)} placeholder="bug, enhancement" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-zinc-500" /></div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setView('list')} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
            <button type="button" onClick={handleCreateIssue} disabled={!newTitle.trim()} className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg disabled:opacity-50">Create Issue</button>
          </div>
        </div>
      )}

      {view === 'detail' && selectedIssue && !loading && (
        <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-4">
          <div className="flex items-start gap-3 mb-4">
            <span className={`mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${selectedIssue.state === 'open' ? 'bg-green-900/50 text-green-400 border border-green-700' : 'bg-purple-900/50 text-purple-400 border border-purple-700'}`}>{selectedIssue.state}</span>
            <div className="flex-1">
              <h3 className="text-white font-semibold text-lg">{selectedIssue.title} <span className="text-zinc-500 font-normal ml-2">#{selectedIssue.number}</span></h3>
              <p className="text-sm text-zinc-500 mt-1">Opened by <span className="text-zinc-300">{selectedIssue.user.login}</span> on {new Date(selectedIssue.created_at).toLocaleDateString()}</p>
            </div>
          </div>
          {selectedIssue.labels.length > 0 && <div className="flex flex-wrap gap-1.5 mb-4">{selectedIssue.labels.map((label) => <span key={label.name} className="px-2 py-0.5 text-xs rounded-full border" style={{ backgroundColor: `#${label.color}20`, borderColor: `#${label.color}60`, color: `#${label.color}` }}>{label.name}</span>)}</div>}
          {selectedIssue.body && <div className="bg-zinc-900 rounded-lg p-4 mb-4 border border-zinc-700"><pre className="text-sm text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">{selectedIssue.body}</pre></div>}
          {issueComments.length > 0 && <div className="space-y-3 mt-4"><h4 className="text-sm font-medium text-zinc-400">Comments ({issueComments.length})</h4>{issueComments.map((c) => <div key={c.id} className="bg-zinc-900 rounded-lg p-3 border border-zinc-700"><div className="flex items-center gap-2 mb-2"><img src={c.user.avatar_url} alt={c.user.login} className="w-5 h-5 rounded-full" /><span className="text-sm text-zinc-300 font-medium">{c.user.login}</span><span className="text-xs text-zinc-500">{new Date(c.created_at).toLocaleDateString()}</span></div><pre className="text-sm text-zinc-400 whitespace-pre-wrap font-sans leading-relaxed">{c.body}</pre></div>)}</div>}
          <div className="mt-4 pt-3 border-t border-zinc-700"><a href={selectedIssue.html_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:text-blue-300">View on GitHub</a></div>
        </div>
      )}

      {view === 'list' && !loading && selectedRepo && (
        <>
          <div className="flex gap-1 mb-3">{['open', 'closed', 'all'].map((state) => <button type="button" key={state} onClick={() => setFilterState(state)} className={`px-3 py-1 text-sm rounded-lg ${filterState === state ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>{state.charAt(0).toUpperCase() + state.slice(1)}</button>)}</div>
          {issues.length === 0 ? <div className="text-center py-8 text-zinc-500 text-sm">No {filterState !== 'all' ? filterState : ''} issues found.</div> : (
            <div className="space-y-1">{issues.map((issue) => (
              <button type="button" key={issue.number} onClick={() => openIssueDetail(issue)} className="w-full text-left bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-zinc-600 rounded-lg p-3 group">
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 w-3 h-3 rounded-full flex-shrink-0 ${issue.state === 'open' ? 'bg-green-500' : 'bg-purple-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className="text-sm text-white font-medium group-hover:text-blue-400 truncate">{issue.title}</span><span className="text-xs text-zinc-500 flex-shrink-0">#{issue.number}</span></div>
                    <div className="flex items-center gap-2 mt-1">{issue.labels.slice(0, 3).map((label) => <span key={label.name} className="px-1.5 py-0 text-[10px] rounded-full border" style={{ backgroundColor: `#${label.color}20`, borderColor: `#${label.color}60`, color: `#${label.color}` }}>{label.name}</span>)}{issue.comments > 0 && <span className="text-xs text-zinc-500">{issue.comments} comment{issue.comments !== 1 ? 's' : ''}</span>}<span className="text-xs text-zinc-600">{new Date(issue.created_at).toLocaleDateString()}</span></div>
                  </div>
                  {issue.assignee && <img src={issue.assignee.avatar_url} alt={issue.assignee.login} title={issue.assignee.login} className="w-5 h-5 rounded-full flex-shrink-0" />}
                </div>
              </button>
            ))}</div>
          )}
        </>
      )}

      {view === 'list' && !loading && !selectedRepo && (
        <div className="text-center text-zinc-500 mt-12">
          <p className="text-lg">{token ? 'Select a repository' : 'Enter a public repository'}</p>
          <p className="text-sm mt-1">{token ? 'Choose a repo above or ask the chatbot' : 'Type owner/repo above (e.g. facebook/react)'}</p>
        </div>
      )}
    </div>
  )
}
