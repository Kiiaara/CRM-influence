import { Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import LoginPage from './pages/LoginPage'
import WorkspacePage from './pages/WorkspacePage'
import HomePage from './pages/HomePage'
import CalendarPage from './pages/CalendarPage'
import IntegrationsBoard from './pages/IntegrationsBoard'
import SearchPage from './pages/SearchPage'
import AdminUsersPage from './pages/AdminUsersPage'
import { authApi } from './api/auth'

// Dev-режим: пускаем сразу в воркспейс без TG-логина (синхронно с backend DEV_AUTH_BYPASS)
const DEV_BYPASS = true

function ProtectedShell() {
  if (DEV_BYPASS) return <WorkspacePage />
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
  })
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-950">Загрузка…</div>
  if (isError || !data) return <Navigate to="/login" replace />
  return <WorkspacePage />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/integrations" element={<IntegrationsBoard />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
