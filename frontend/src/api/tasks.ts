import { api } from './client'

export interface Task {
  id: number
  title: string
  description: string
  due_at: string | null
  status: 'todo' | 'doing' | 'done'
  assignee_tg_id: number | null
  page_id: number | null
  created_at: string
}

export const tasksApi = {
  async list(params?: { start?: string; end?: string }) {
    const { data } = await api.get<Task[]>('/tasks', { params })
    return data
  },
  async create(payload: Partial<Task>) {
    const { data } = await api.post<Task>('/tasks', payload)
    return data
  },
  async update(id: number, payload: Partial<Task>) {
    const { data } = await api.patch<Task>(`/tasks/${id}`, payload)
    return data
  },
  async remove(id: number) {
    await api.delete(`/tasks/${id}`)
  },
}
