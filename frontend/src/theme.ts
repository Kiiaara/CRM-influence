// Управление светлой/тёмной темой. Сохраняем выбор в localStorage,
// первичный выбор - системная тема пользователя.
import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'zmt_theme'

function getInitial(): Theme {
  const saved = localStorage.getItem(KEY) as Theme | null
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitial)

  useEffect(() => {
    apply(theme)
    localStorage.setItem(KEY, theme)
  }, [theme])

  return {
    theme,
    toggle: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')),
  }
}

// Применяем сразу при загрузке модуля - чтоб не было мигания
apply(getInitial())
