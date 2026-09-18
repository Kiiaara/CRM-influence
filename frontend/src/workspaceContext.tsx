import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
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

  const current = useMemo(() => {
    if (workspaces.length === 0) return null
    const storedId = getCurrentWorkspaceId()
    return workspaces.find(w => w.id === storedId) ?? workspaces[0]
  }, [workspaces])

  // если сохранённый id больше не валиден (удалили пространство/вышли из него) - откатываемся на первое
  useEffect(() => {
    if (current && current.id !== getCurrentWorkspaceId()) {
      setCurrentWorkspaceId(current.id)
    }
  }, [current])

  const switchWorkspace = (id: number) => {
    if (id === current?.id) return
    setCurrentWorkspaceId(id)
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
