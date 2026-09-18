import { api } from './client'

export type WorkspaceRole = 'owner' | 'lead' | 'viewer'

export interface Workspace {
  id: number
  title: string
  owner_tg_id: number
  created_at: string
  updated_at: string
  my_role: WorkspaceRole
}

export interface WorkspaceMember {
  user_tg_id: number
  role: WorkspaceRole
  invited_at: string
  joined_at: string | null
  label: string | null
  tg_username: string | null
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Владелец',
  lead: 'Руководитель',
  viewer: 'Наблюдатель',
}

export const workspacesApi = {
  async list() {
    const { data } = await api.get<Workspace[]>('/workspaces')
    return data
  },
  async create(title: string) {
    const { data } = await api.post<Workspace>('/workspaces', { title })
    return data
  },
  async update(id: number, title: string) {
    const { data } = await api.put<Workspace>(`/workspaces/${id}`, { title })
    return data
  },
  async remove(id: number) {
    await api.delete(`/workspaces/${id}`)
  },
  async members(id: number) {
    const { data } = await api.get<WorkspaceMember[]>(`/workspaces/${id}/members`)
    return data
  },
  async invite(id: number, tg_id: number, role: WorkspaceRole) {
    const { data } = await api.post<WorkspaceMember>(`/workspaces/${id}/invite`, { tg_id, role })
    return data
  },
  async updateMemberRole(id: number, tg_id: number, role: WorkspaceRole) {
    const { data } = await api.patch<WorkspaceMember>(`/workspaces/${id}/members/${tg_id}`, { tg_id, role })
    return data
  },
  async removeMember(id: number, tg_id: number) {
    await api.delete(`/workspaces/${id}/members/${tg_id}`)
  },
}
