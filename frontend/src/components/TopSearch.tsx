import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'

interface Hit {
  kind: 'integration'
  id: number
  title: string
  snippet: string
}

export default function TopSearch() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const nav = useNavigate()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!q.trim()) {
      setHits([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get<Hit[]>('/search', { params: { q } })
        setHits(data)
        setActive(0)
      } catch {}
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  // Закрытие по клику вне
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [])

  // Ctrl+K / Cmd+K - фокус
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const go = (h: Hit) => {
    setOpen(false)
    setQ('')
    nav(`/integrations?open=${h.id}`)
  }

  return (
    <div ref={wrapRef} className="relative w-full max-w-xl">
      <input
        ref={inputRef}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (!hits.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          if (e.key === 'Enter')     { e.preventDefault(); go(hits[active]) }
          if (e.key === 'Escape')    { setOpen(false) }
        }}
        placeholder="Поиск по интеграциям… (Ctrl+K)"
        className="w-full bg-slate-100 dark:bg-brand-900 border border-transparent focus:border-brand-500 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none transition"
      />
      {open && q && (
        <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl shadow-xl max-h-80 overflow-auto z-40">
          {hits.length === 0 && <div className="px-4 py-3 text-sm text-slate-400">Ничего не найдено</div>}
          {hits.map((h, i) => (
            <button
              key={`${h.kind}-${h.id}-${i}`}
              onClick={() => go(h)}
              onMouseEnter={() => setActive(i)}
              className={`w-full text-left px-4 py-2 text-sm ${i === active ? 'bg-brand-50 dark:bg-brand-900/30' : ''} hover:bg-brand-50 dark:hover:bg-brand-900/30 border-b border-slate-100 dark:border-brand-900 last:border-0`}
            >
              <div className="text-xs text-slate-400">🤝 Интеграция</div>
              <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{h.title}</div>
              {h.snippet && <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{h.snippet}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
