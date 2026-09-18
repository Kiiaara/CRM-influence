import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { authApi } from '../api/auth'
import { useTheme } from '../theme'
import TopSearch from '../components/TopSearch'

const navItems = [
  { to: '/', label: 'Главная', icon: '🏠' },
  { to: '/integrations', label: 'Интеграции', icon: '🤝' },
  { to: '/calendar', label: 'Задачи', icon: '📅' },
]

export default function WorkspacePage() {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me, retry: false })
  const { theme, toggle } = useTheme()
  const loc = useLocation()
  const nav = useNavigate()

  const logout = async () => {
    await authApi.logout()
    nav('/login', { replace: true })
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold">И</div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">CRM-influence</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(it => {
            const active = it.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(it.to)
            return (
              <div key={it.to}>
                <Link
                  to={it.to}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                    active
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 font-medium'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{it.icon}</span>
                  <span>{it.label}</span>
                </Link>
              </div>
            )
          })}
        </nav>
        <div className="px-3 py-3 border-t border-slate-100 dark:border-slate-800 space-y-1">
          <button
            onClick={toggle}
            className="w-full px-3 py-2 text-sm text-left text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg flex items-center gap-3"
          >
            <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
            <span>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
          </button>
          {me?.role === 'admin' && (
            <Link to="/admin/users" className="block px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg">
              ⚙️ Пользователи
            </Link>
          )}
          <button
            onClick={logout}
            className="w-full px-3 py-2 text-sm text-left text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg flex items-center gap-3"
          >
            <span>🚪</span>
            <span>Выйти ({me?.first_name ?? me?.username ?? me?.tg_id ?? 'dev'})</span>
          </button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden text-slate-800 dark:text-slate-200">
        <header className="border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 backdrop-blur sticky top-0 z-30 px-6 py-3">
          <TopSearch />
        </header>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
