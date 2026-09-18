import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { useTheme } from '../theme'

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void
  }
}

export default function LoginPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const [error, setError] = useState<string | null>(null)
  const [botUsername, setBotUsername] = useState<string | null>(null)

  useEffect(() => {
    authApi.config().then(c => setBotUsername(c.bot_username || null)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!botUsername || !containerRef.current) return

    window.onTelegramAuth = async (user) => {
      try {
        await authApi.loginTelegram(user)
        navigate('/', { replace: true })
      } catch (e: any) {
        setError(e?.response?.data?.detail ?? 'Ошибка входа')
      }
    }

    const s = document.createElement('script')
    s.src = 'https://telegram.org/js/telegram-widget.js?22'
    s.async = true
    s.setAttribute('data-telegram-login', botUsername)
    s.setAttribute('data-size', 'large')
    s.setAttribute('data-radius', '8')
    s.setAttribute('data-onauth', 'onTelegramAuth(user)')
    s.setAttribute('data-request-access', 'write')
    // тема виджета подстраивается под текущую
    if (theme === 'dark') s.setAttribute('data-userpic', 'false')
    containerRef.current.appendChild(s)

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = ''
      delete window.onTelegramAuth
    }
  }, [botUsername, theme, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-brand-50 to-brand-100 dark:from-slate-900 dark:to-slate-950">
      <button
        onClick={toggle}
        className="fixed top-4 right-4 w-10 h-10 rounded-lg bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 backdrop-blur transition"
        title="Сменить тему"
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-2xl shadow-xl p-10 w-full max-w-md text-center">
        <div className="w-12 h-12 mx-auto rounded-xl bg-brand-600 text-white flex items-center justify-center text-2xl font-bold mb-4">И</div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mb-2">CRM-influence</h1>
        <p className="text-slate-500 dark:text-slate-400 mb-8">Войди через Telegram, чтоб попасть в пространство</p>
        {!botUsername && (
          <div className="text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300 rounded-lg px-4 py-3 text-sm">
            Бот не настроен. Положи AUTH_BOT_USERNAME в backend/.env и перезапусти.
          </div>
        )}
        <div ref={containerRef} className="flex justify-center" />
        {error && <div className="mt-4 text-red-600 dark:text-red-400 text-sm">{error}</div>}
      </div>
    </div>
  )
}
