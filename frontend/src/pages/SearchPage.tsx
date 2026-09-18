import { useState } from 'react'
import { api } from '../api/client'
import { Link } from 'react-router-dom'

interface Hit {
  kind: 'integration'
  id: number
  title: string
  snippet: string
}

export default function SearchPage() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)

  const search = async () => {
    if (!q.trim()) { setHits([]); return }
    setLoading(true)
    try {
      const { data } = await api.get<Hit[]>('/search', { params: { q } })
      setHits(data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 sm:p-10 max-w-3xl">
      <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mb-6">Поиск</h1>
      <form onSubmit={e => { e.preventDefault(); search() }} className="flex gap-2 mb-6">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Что ищем?"
          className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2 text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500"
        />
        <button className="bg-brand-600 hover:bg-brand-700 text-white px-5 py-2 rounded-lg text-sm">Искать</button>
      </form>
      {loading && <div className="text-slate-400">Ищу…</div>}
      <div className="space-y-2">
        {hits.map((h, i) => (
          <Link
            key={i}
            to={`/integrations?open=${h.id}`}
            className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 hover:border-brand-400"
          >
            <div className="text-xs text-slate-400 mb-1">🤝 Интеграция</div>
            <div className="font-medium text-slate-900 dark:text-slate-100">{h.title}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{h.snippet}</div>
          </Link>
        ))}
        {!loading && hits.length === 0 && q && <div className="text-slate-500">Ничего не найдено.</div>}
      </div>
    </div>
  )
}
