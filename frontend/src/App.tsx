import { Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import LoginPage from './pages/LoginPage'
import WorkspacePage from './pages/WorkspacePage'
import HomePage from './pages/HomePage'
import IntegrationsBoard from './pages/IntegrationsBoard'
import HistoryPage from './pages/HistoryPage'
import MarkingPage from './pages/MarkingPage'
import AdvertisersPage from './pages/AdvertisersPage'
import DocumentsPage from './pages/DocumentsPage'
import StreamerProfilesPage from './pages/StreamerProfilesPage'
import SearchPage from './pages/SearchPage'
import AdminUsersPage from './pages/AdminUsersPage'
import { authApi } from './api/auth'
import { WorkspaceProvider } from './workspaceContext'

function ProtectedShell() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
  })
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-brand-950">Загрузка…</div>
  if (isError || !data) return <Navigate to="/login" replace />
  return (
    <WorkspaceProvider>
      <WorkspacePage />
    </WorkspaceProvider>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/integrations" element={<IntegrationsBoard />} />
        <Route path="/marking" element={<MarkingPage />} />
        <Route path="/advertisers" element={<AdvertisersPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/streamers" element={<StreamerProfilesPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
