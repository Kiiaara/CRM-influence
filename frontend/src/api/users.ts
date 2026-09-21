import { api } from './client'

export interface UserRow {
  tg_id: number
  role: 'admin' | 'editor' | 'viewer'
  label: string | null
  tg_username: string | null
  tg_first_name: string | null
  tg_chat_ready: boolean
  created_at: string
  is_self: boolean
}

export const usersApi = {
  async list() {
    const { data } = await api.get<UserRow[]>('/users')
    return data
  },
  async create(payload: {
    tg_id: number
    role: string
    label?: string
    // необязательно: сразу закинуть человека в конкретное пространство
    workspace_id?: number
    workspace_role?: string
  }) {
    const { data } = await api.post<UserRow>('/users', payload)
    return data
  },
  async update(tg_id: number, payload: { role?: string; label?: string }) {
    const { data } = await api.patch<UserRow>(`/users/${tg_id}`, payload)
    return data
  },
  async remove(tg_id: number) {
    await api.delete(`/users/${tg_id}`)
  },
}
