import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { workspacesApi, type Workspace } from './api/workspaces'
import { getCurrentWorkspaceId, setCurrentWorkspaceId } from './api/client'

interface WorkspaceContextValue {
  workspaces: Workspace[]
  current: Workspace | null
  isLoading: boolean
  switchWorkspace: (id: number) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })

  // выбранный id держим в реальном React state, а не читаем localStorage прямо внутри useMemo -
  // React Query возвращает тот же reference для workspaces при structural sharing (список не
  // поменялся), так что useMemo от [workspaces] не пересчитывался бы при смене только выбора,
  // и сайдбар не обновлялся бы после переключения
  const [currentId, setCurrentId] = useState<number | null>(() => getCurrentWorkspaceId())

  const current = useMemo(() => {
    if (workspaces.length === 0) return null
    return workspaces.find(w => w.id === currentId) ?? workspaces[0]
  }, [workspaces, currentId])

  // если сохранённый id больше не валиден (удалили пространство/вышли из него) - откатываемся на первое
  useEffect(() => {
    if (current && current.id !== currentId) {
      setCurrentId(current.id)
      setCurrentWorkspaceId(current.id)
    }
  }, [current, currentId])

  const switchWorkspace = (id: number) => {
    if (id === currentId) return
    setCurrentWorkspaceId(id)
    setCurrentId(id)
    // почти все данные в приложении завязаны на workspace - проще инвалидировать всё разом
    queryClient.invalidateQueries()
  }

  return (
    <WorkspaceContext.Provider value={{ workspaces, current, isLoading, switchWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace должен использоваться внутри WorkspaceProvider')
  return ctx
}
