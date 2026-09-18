import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { useTheme } from '../theme'

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void
    VKIDSDK?: any
  }
}

export default function LoginPage() {
  const tgRef = useRef<HTMLDivElement>(null)
  const vkRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const [error, setError] = useState<string | null>(null)
  const [botUsername, setBotUsername] = useState<string | null>(null)
  const [vkAppId, setVkAppId] = useState<string | null>(null)

  useEffect(() => {
    authApi.config()
      .then(c => {
        setBotUsername(c.bot_username || null)
        setVkAppId(c.vk_app_id || null)
      })
      .catch(() => {})
  }, [])

  // Telegram Login Widget
  useEffect(() => {
    if (!botUsername || !tgRef.current) return

    window.onTelegramAuth = async (user) => {
      try {
        await authApi.loginTelegram(user)
        navigate('/', { replace: true })
      } catch (e: any) {
        setError(e?.response?.data?.detail ?? 'Ошибка входа')
      }
    }

    const s = document.createElement('script')
    s.src = '/widgets-tg.js'
    s.async = true
    s.setAttribute('data-telegram-login', botUsername)
    s.setAttribute('data-size', 'large')
    s.setAttribute('data-radius', '8')
    s.setAttribute('data-onauth', 'onTelegramAuth(user)')
    s.setAttribute('data-request-access', 'write')
    if (theme === 'dark') s.setAttribute('data-userpic', 'false')
    tgRef.current.appendChild(s)

    return () => {
      if (tgRef.current) tgRef.current.innerHTML = ''
      delete window.onTelegramAuth
    }
  }, [botUsername, theme, navigate])

  // VK ID OneTap
  useEffect(() => {
    if (!vkAppId || !vkRef.current) return

    let cancelled = false

    const mount = () => {
      const VKID = window.VKIDSDK
      if (!VKID || cancelled || !vkRef.current) return

      VKID.Config.init({
        app: Number(vkAppId),
        redirectUrl: window.location.origin,
        responseMode: VKID.ConfigResponseMode.Callback,
        source: VKID.ConfigSource.LOWCODE,
        scope: '',
      })

      const oneTap = new VKID.OneTap()
      oneTap
        .render({
          container: vkRef.current,
          scheme: theme === 'dark' ? 'dark' : 'light',
          showAlternativeLogin: true,
        })
        .on(VKID.WidgetEvents.ERROR, () => setError('Ошибка входа через VK'))
        .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, async (payload: any) => {
          try {
            await authApi.loginVk({
              code: payload.code,
              device_id: payload.device_id,
              code_verifier: payload.code_verifier,
            })
            navigate('/', { replace: true })
          } catch (e: any) {
            setError(e?.response?.data?.detail ?? 'Ошибка входа через VK')
          }
        })
    }

    if (window.VKIDSDK) {
      mount()
    } else {
      const s = document.createElement('script')
      s.src = '/widgets-auth.js'
      s.async = true
      s.onload = mount
      document.head.appendChild(s)
    }

    return () => {
      cancelled = true
      if (vkRef.current) vkRef.current.innerHTML = ''
    }
  }, [vkAppId, theme, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-900 dark:to-brand-950">
      <button
        onClick={toggle}
        className="fixed top-4 right-4 w-10 h-10 rounded-lg bg-white/70 dark:bg-brand-900/70 border border-slate-200 dark:border-brand-800 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-brand-900 backdrop-blur transition"
        title="Сменить тему"
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      <div className="bg-white dark:bg-brand-950 border border-transparent dark:border-brand-900 rounded-2xl shadow-xl p-10 w-full max-w-md text-center">
        <img src="/logo.svg" alt="" className="w-16 h-16 mx-auto rounded-2xl mb-4" />
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mb-2">CRM-influence</h1>
        <p className="text-slate-500 dark:text-slate-400 mb-8">Войди через VK или Telegram</p>

        {!botUsername && !vkAppId && (
          <div className="text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300 rounded-lg px-4 py-3 text-sm">
            Вход не настроен. Положи AUTH_BOT_USERNAME или VK_APP_ID в backend/.env и перезапусти.
          </div>
        )}

        {vkAppId && <div ref={vkRef} className="flex justify-center mb-4" />}

        {vkAppId && botUsername && (
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-slate-200 dark:bg-brand-900" />
            <span className="text-xs text-slate-400">или</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-brand-900" />
          </div>
        )}

        <div ref={tgRef} className="flex justify-center" />
        {error && <div className="mt-4 text-red-600 dark:text-red-400 text-sm">{error}</div>}
      </div>
    </div>
  )
}
