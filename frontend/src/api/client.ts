import axios from 'axios'

const WORKSPACE_STORAGE_KEY = 'crm_current_workspace_id'

export function getCurrentWorkspaceId(): number | null {
  const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
  return raw ? Number(raw) : null
}

export function setCurrentWorkspaceId(id: number) {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, String(id))
}

// Cookie сессии httpOnly, поэтому withCredentials обязателен
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

// Текущее пространство передаём заголовком, чтобы не менять сигнатуры
// всех остальных api-клиентов (integrations.ts, tasks.ts и т.д.)
api.interceptors.request.use(config => {
  const wsId = getCurrentWorkspaceId()
  if (wsId != null) {
    config.headers.set('X-Workspace-Id', String(wsId))
  }
  return config
})
