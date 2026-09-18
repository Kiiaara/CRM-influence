import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from '../workspaceContext'
import { workspacesApi, ROLE_LABELS } from '../api/workspaces'

export default function WorkspaceSelector() {
  const { workspaces, current, switchWorkspace } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
        setError(null)
      }
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [])

  if (!current) return null

  const handleCreate = async () => {
    const title = newTitle.trim()
    if (!title) return
    try {
      const ws = await workspacesApi.create(title)
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      switchWorkspace(ws.id)
      setNewTitle('')
      setCreating(false)
      setOpen(false)
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Не удалось создать пространство')
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm bg-slate-50 dark:bg-brand-900 hover:bg-slate-100 dark:hover:bg-brand-800 transition"
      >
        <span className="truncate text-left">
          <span className="block font-medium text-slate-900 dark:text-slate-100 truncate">{current.title}</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">{ROLE_LABELS[current.my_role]}</span>
        </span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-72 rounded-lg border border-slate-200 dark:border-brand-800 bg-white dark:bg-brand-950 shadow-lg overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {workspaces.map(ws => (
              <button
                key={ws.id}
                onClick={() => {
                  switchWorkspace(ws.id)
                  setOpen(false)
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50 dark:hover:bg-brand-900 ${
                  ws.id === current.id ? 'bg-brand-50 dark:bg-brand-900/40' : ''
                }`}
              >
                <span className="truncate">{ws.title}</span>
                <span className="shrink-0 text-xs text-slate-400">{ROLE_LABELS[ws.my_role]}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 dark:border-brand-900 p-2">
            {creating ? (
              <div className="space-y-2">
                <input
                  autoFocus
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="Название пространства"
                  className="w-full px-2 py-1.5 text-sm rounded-md border border-slate-200 dark:border-brand-800 bg-white dark:bg-brand-950 text-slate-900 dark:text-slate-100"
                />
                {error && <div className="text-xs text-red-500">{error}</div>}
                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    className="flex-1 px-2 py-1.5 text-sm rounded-md bg-brand-600 text-white hover:bg-brand-700"
                  >
                    Создать
                  </button>
                  <button
                    onClick={() => {
                      setCreating(false)
                      setError(null)
                    }}
                    className="px-2 py-1.5 text-sm rounded-md text-slate-500 hover:bg-slate-50 dark:hover:bg-brand-900"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full px-2 py-1.5 text-sm text-left text-brand-600 dark:text-brand-400 hover:bg-slate-50 dark:hover:bg-brand-900 rounded-md"
              >
                + Новое пространство
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
