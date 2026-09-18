import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { authApi } from '../api/auth'
import { useTheme } from '../theme'
import TopSearch from '../components/TopSearch'
import WorkspaceSelector from '../components/WorkspaceSelector'
import AlertsPanel from '../components/AlertsPanel'

const navItems = [
  { to: '/', label: 'Главная', icon: '🏠' },
  { to: '/integrations', label: 'Интеграции', icon: '🤝' },
  { to: '/marking', label: 'Маркировка', icon: '🏷️' },
  { to: '/documents', label: 'Документы', icon: '📄' },
  { to: '/advertisers', label: 'Рекламодатели', icon: '🏢' },
  { to: '/history', label: 'История', icon: '🗂️' },
  { to: '/streamers', label: 'База стримеров', icon: '📋' },
]

export default function WorkspacePage() {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me, retry: false })
  const { theme, toggle } = useTheme()
  const loc = useLocation()
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const logout = async () => {
    await authApi.logout()
    nav('/login', { replace: true })
  }

  const sidebarContent = (
    <>
      <div className="px-5 py-4 border-b border-slate-100 dark:border-brand-900 flex items-center gap-2">
        <img src="/logo.svg" alt="" className="w-9 h-9 rounded-lg shrink-0" />
        <div className="font-semibold text-slate-900 dark:text-slate-100">CRM-influence</div>
      </div>
      <div className="px-3 pt-3">
        <WorkspaceSelector />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(it => {
          const active = it.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(it.to)
          return (
            <Link
              key={it.to}
              to={it.to}
              onClick={() => setMenuOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                active
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 font-medium'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-brand-900'
              }`}
            >
              <span>{it.icon}</span>
              <span>{it.label}</span>
            </Link>
          )
        })}
      </nav>
      <div className="px-3 pb-1">
        <AlertsPanel onNavigate={() => setMenuOpen(false)} />
      </div>
      <div className="px-3 py-3 border-t border-slate-100 dark:border-brand-900 space-y-1">
        <button
          onClick={toggle}
          className="w-full px-3 py-2 text-sm text-left text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-brand-900 rounded-lg flex items-center gap-3"
        >
          <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
          <span>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
        </button>
        {me?.role === 'admin' && (
          <Link
            to="/admin/users"
            onClick={() => setMenuOpen(false)}
            className="block px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-brand-900 rounded-lg"
          >
            ⚙️ Пользователи
          </Link>
        )}
        <button
          onClick={logout}
          className="w-full px-3 py-2 text-sm text-left text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-brand-900 rounded-lg flex items-center gap-3"
        >
          <span>🚪</span>
          <span>Выйти ({me?.first_name ?? me?.username ?? me?.tg_id ?? 'dev'})</span>
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-brand-950 app-ambient-bg">
      {/* Десктоп: сайдбар всегда виден */}
      <aside className="hidden md:flex w-64 bg-white dark:bg-brand-950 border-r border-slate-200 dark:border-brand-900 flex-col shrink-0">
        {sidebarContent}
      </aside>

      {/* Мобилка: выезжающее меню поверх контента */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setMenuOpen(false)}>
          <aside
            className="w-64 h-full bg-white dark:bg-brand-950 border-r border-slate-200 dark:border-brand-900 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      <main className="flex-1 flex flex-col overflow-hidden text-slate-800 dark:text-slate-200 min-w-0">
        <header className="border-b border-slate-200 dark:border-brand-900 bg-white/70 dark:bg-brand-950/60 backdrop-blur sticky top-0 z-30 px-3 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => setMenuOpen(true)}
            className="md:hidden shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-900"
            aria-label="Меню"
          >
            ☰
          </button>
          <div className="flex-1 min-w-0">
            <TopSearch />
          </div>
        </header>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
