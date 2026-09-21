import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { authApi } from '../api/auth'

const DISMISS_KEY = 'crm_bot_nudge_dismissed_until'
// отложить на сутки, а не навсегда: без бота человек пропустит все напоминания
const SNOOZE_MS = 24 * 60 * 60 * 1000

function isSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    return !!raw && Number(raw) > Date.now()
  } catch {
    return false
  }
}

/** Плашка «подключи бота» для тех, кто ещё не писал /start.
 *  Висит справа снизу, пульсирует, скрывается на сутки по крестику. */
export default function ConnectBotNudge() {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me, retry: false })
  const { data: config } = useQuery({ queryKey: ['auth-config'], queryFn: authApi.config, retry: false })
  const [hidden, setHidden] = useState(true)
  const [bubbleOpen, setBubbleOpen] = useState(false)

  useEffect(() => {
    setHidden(isSnoozed())
  }, [])

  // показываем через пару секунд после загрузки, чтобы не мельтешило при входе
  useEffect(() => {
    if (hidden) return
    const t = setTimeout(() => setBubbleOpen(true), 1500)
    return () => clearTimeout(t)
  }, [hidden])

  // у VK-only юзера tg_id отрицательный - боту его просто некуда писать
  const hasTelegram = (me?.tg_id ?? 0) > 0
  if (!me || me.tg_chat_ready || hidden || !config?.bot_username) return null

  const botUrl = `https://t.me/${config.bot_username}`

  const snooze = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + SNOOZE_MS))
    } catch {
      // приватный режим - просто скроем до перезагрузки
    }
    setHidden(true)
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 flex items-end gap-2">
      {bubbleOpen && (
        <div className="relative max-w-[240px] bg-white dark:bg-brand-950 border border-brand-200 dark:border-brand-800 rounded-2xl rounded-br-sm shadow-xl p-3 pr-7">
          <button
            onClick={snooze}
            className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
            title="Скрыть на сутки"
          >
            ✕
          </button>
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">Подключи меня</div>
          {hasTelegram ? (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Напиши боту <code className="bg-slate-100 dark:bg-brand-900 px-1 py-0.5 rounded">/start</code>, и я буду
                присылать задачи, дедлайны и напоминания по интеграциям.
              </p>
              <a
                href={botUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg"
              >
                Открыть бота
              </a>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Ты заходишь через VK, поэтому уведомления не приходят. Попроси админа добавить твой Telegram ID.
              </p>
              <Link
                to="/profile"
                onClick={() => setBubbleOpen(false)}
                className="inline-block text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg"
              >
                Подробнее
              </Link>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setBubbleOpen(o => !o)}
        title="Подключить бота"
        className="relative w-12 h-12 shrink-0 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-xl flex items-center justify-center shadow-lg"
      >
        <span className="absolute inset-0 rounded-full bg-brand-500 opacity-60 animate-ping" />
        <span className="relative">🤖</span>
      </button>
    </div>
  )
}
