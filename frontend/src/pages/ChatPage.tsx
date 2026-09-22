import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { chatApi } from '../api/chat'
import type { ChatMessage } from '../api/chat'
import { authApi } from '../api/auth'
import { integrationsApi, STAGES } from '../api/integrations'

export default function ChatPage() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  // null - общая лента, число - ветка по сделке
  const threadParam = searchParams.get('streamer')
  const activeThread = threadParam ? Number(threadParam) : null
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me, retry: false })
  const { data: threads = [] } = useQuery({
    queryKey: ['chat-threads'],
    queryFn: chatApi.threads,
    refetchInterval: 20000,
  })
  const { data: messages = [] } = useQuery({
    queryKey: ['chat-messages', activeThread],
    queryFn: () => chatApi.messages(activeThread),
    // опроса хватает: сообщений мало, вебсокет ради этого не нужен
    refetchInterval: 10000,
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, activeThread])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['chat-messages', activeThread] })
    qc.invalidateQueries({ queryKey: ['chat-threads'] })
  }

  const send = useMutation({
    mutationFn: () => chatApi.send(text.trim(), activeThread),
    onSuccess: () => { setText(''); setError(null); invalidate() },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось отправить'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => chatApi.remove(id),
    onSuccess: invalidate,
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось удалить'),
  })

  const openThread = (streamerId: number | null) => {
    if (streamerId == null) searchParams.delete('streamer')
    else searchParams.set('streamer', String(streamerId))
    setSearchParams(searchParams, { replace: true })
  }

  const submit = () => {
    if (!text.trim() || send.isPending) return
    send.mutate()
  }

  // все сделки пространства - для выбора новой ветки и для заголовка той,
  // где ещё нет сообщений (в threads такая ветка не придёт)
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const allDeals = integrations.flatMap(it =>
    it.streamers.map(s => ({
      streamer_id: s.id,
      streamer_name: s.streamer_name,
      brand: it.brand,
      stage: s.stage,
    }))
  )

  const activeTitle = activeThread
    ? threads.find(t => t.streamer_id === activeThread) ?? allDeals.find(d => d.streamer_id === activeThread)
    : null

  return (
    <div className="p-4 sm:p-10">
      <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 mb-2">Чат</h1>
      <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">
        Общий чат - для всего сразу. Отдельная переписка по сделке заводится кнопкой «Обсудить сделку».
      </p>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* список веток */}
        <div className="lg:w-64 shrink-0 bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-hidden">
          <button
            onClick={() => openThread(null)}
            className={`w-full text-left px-4 py-3 border-b border-slate-100 dark:border-brand-900 ${
              activeThread == null ? 'bg-brand-50 dark:bg-brand-900/40' : 'hover:bg-slate-50 dark:hover:bg-brand-900/30'
            }`}
          >
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">💬 Общий чат</div>
            <div className="text-xs text-slate-400">Всё, что не про конкретную сделку</div>
          </button>

          <div className="max-h-[50vh] lg:max-h-[60vh] overflow-y-auto">
            {threads.map(t => (
              <button
                key={t.streamer_id}
                onClick={() => openThread(t.streamer_id)}
                className={`w-full text-left px-4 py-2.5 border-b border-slate-50 dark:border-brand-900/60 last:border-0 ${
                  activeThread === t.streamer_id ? 'bg-brand-50 dark:bg-brand-900/40' : 'hover:bg-slate-50 dark:hover:bg-brand-900/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-900 dark:text-slate-100 truncate">{t.streamer_name}</span>
                  <span className="text-[11px] text-slate-400 shrink-0">{t.messages_count}</span>
                </div>
                <div className="text-xs text-slate-400 truncate">{t.brand}</div>
                {t.last_message && (
                  <div className="text-xs text-slate-400 truncate mt-0.5">{t.last_message}</div>
                )}
              </button>
            ))}
            {/* открытая ветка без сообщений: в threads её ещё нет, но показать надо */}
            {activeThread != null && !threads.some(t => t.streamer_id === activeThread) && activeTitle && (
              <button className="w-full text-left px-4 py-2.5 bg-brand-50 dark:bg-brand-900/40 border-b border-slate-50 dark:border-brand-900/60">
                <div className="text-sm text-slate-900 dark:text-slate-100 truncate">{activeTitle.streamer_name}</div>
                <div className="text-xs text-slate-400 truncate">{activeTitle.brand}</div>
              </button>
            )}
            {threads.length === 0 && activeThread == null && (
              <div className="px-4 py-3 text-xs text-slate-400">
                Пока обсуждали только в общем чате
              </div>
            )}
          </div>

          <div className="p-2 border-t border-slate-100 dark:border-brand-900">
            <button
              onClick={() => setPicking(true)}
              className="w-full text-sm text-brand-600 dark:text-brand-400 hover:bg-slate-50 dark:hover:bg-brand-900 rounded-lg px-2 py-1.5 text-left"
            >
              + Обсудить сделку
            </button>
          </div>
        </div>

        {/* лента */}
        <div className="flex-1 bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl flex flex-col min-h-[60vh]">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-brand-900">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              {activeTitle ? activeTitle.streamer_name : 'Общий чат'}
            </div>
            {activeTitle && <div className="text-xs text-slate-400">{activeTitle.brand}</div>}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[55vh]">
            {messages.map(m => (
              <Message
                key={m.id}
                message={m}
                isMine={m.author_tg_id === me?.tg_id}
                canDelete={m.author_tg_id === me?.tg_id || me?.role === 'admin'}
                onRemove={() => confirm('Удалить сообщение?') && remove.mutate(m.id)}
              />
            ))}
            {messages.length === 0 && (
              <div className="text-sm text-slate-400 text-center py-10">
                {activeThread == null
                  ? 'Сообщений пока нет. Напишите первое.'
                  : 'По этой сделке ещё не переписывались. Напишите первое сообщение.'}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-slate-100 dark:border-brand-900 p-3">
            {error && <div className="text-xs text-red-500 mb-2">{error}</div>}
            <div className="flex gap-2">
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  // Enter отправляет, Shift+Enter переносит строку
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submit()
                  }
                }}
                rows={2}
                placeholder="Сообщение…"
                className="flex-1 resize-none bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
              <button
                onClick={submit}
                disabled={!text.trim() || send.isPending}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 rounded-lg text-sm font-medium shrink-0"
              >
                {send.isPending ? '…' : 'Отправить'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {picking && (
        <DealPicker
          deals={allDeals}
          onClose={() => setPicking(false)}
          onPicked={id => { setPicking(false); openThread(id) }}
        />
      )}
    </div>
  )
}

interface Deal {
  streamer_id: number
  streamer_name: string
  brand: string
  stage: string
}

const STAGE_LABELS: Record<string, string> = Object.fromEntries(STAGES.map(s => [s.key, s.label]))

// выбор сделки для новой ветки - тот же приём, что в кейсах
function DealPicker({
  deals,
  onClose,
  onPicked,
}: {
  deals: Deal[]
  onClose: () => void
  onPicked: (streamerId: number) => void
}) {
  const [q, setQ] = useState('')
  const list = deals
    .filter(d => d.stage !== 'cancelled')
    .filter(d =>
      !q.trim() ||
      d.brand.toLowerCase().includes(q.toLowerCase()) ||
      d.streamer_name.toLowerCase().includes(q.toLowerCase())
    )

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-1 text-slate-900 dark:text-slate-100">Обсудить сделку</h2>
        <p className="text-xs text-slate-400 mb-3">Выберите, по какой сделке завести переписку</p>

        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск по бренду или стримеру"
          className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 mb-3"
        />

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {list.map(d => (
            <button
              key={d.streamer_id}
              onClick={() => onPicked(d.streamer_id)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-brand-900 flex items-center justify-between gap-2"
            >
              <span className="min-w-0">
                <span className="block text-sm text-slate-900 dark:text-slate-100 truncate">{d.streamer_name}</span>
                <span className="block text-xs text-slate-400 truncate">{d.brand}</span>
              </span>
              <span className="shrink-0 text-[11px] text-slate-400">{STAGE_LABELS[d.stage] ?? d.stage}</span>
            </button>
          ))}
          {list.length === 0 && (
            <div className="text-sm text-slate-400 text-center py-8">
              {deals.length === 0 ? 'Сделок пока нет - заведите их на канбане' : 'Ничего не найдено'}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-3 px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900 self-end"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}

function Message({
  message,
  isMine,
  canDelete,
  onRemove,
}: {
  message: ChatMessage
  isMine: boolean
  canDelete: boolean
  onRemove: () => void
}) {
  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`group max-w-[75%] rounded-2xl px-3 py-2 ${
          isMine
            ? 'bg-brand-600 text-white rounded-br-sm'
            : 'bg-slate-100 dark:bg-brand-900 text-slate-900 dark:text-slate-100 rounded-bl-sm'
        }`}
      >
        {!isMine && (
          <div className="text-xs font-medium text-brand-600 dark:text-brand-400 mb-0.5">
            {message.author_label ?? 'Кто-то'}
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap break-words">{message.text}</div>
        <div className={`text-[10px] mt-0.5 flex items-center gap-2 ${isMine ? 'text-white/70' : 'text-slate-400'}`}>
          <span>{dayjs(message.created_at).format('DD.MM HH:mm')}</span>
          {canDelete && (
            <button
              onClick={onRemove}
              className="opacity-0 group-hover:opacity-100 transition hover:underline"
            >
              удалить
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
