import { api } from './client'

export type TaskStatus = 'todo' | 'doing' | 'done'

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Надо сделать',
  doing: 'В работе',
  done: 'Готово',
}

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  todo: 'bg-slate-100 text-slate-600 dark:bg-brand-900 dark:text-slate-300',
  doing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

export interface Task {
  id: number
  title: string
  description: string
  due_at: string | null
  status: TaskStatus
  assignee_tg_id: number | null
  assignee_label: string | null
  created_by_tg_id: number | null
  created_at: string
}

export interface Assignee {
  tg_id: number
  label: string
  workspace_role: string
}

export interface TaskPayload {
  title?: string
  description?: string
  due_at?: string | null
  status?: TaskStatus
  assignee_tg_id?: number | null
}

export const tasksApi = {
  async list(params?: { start?: string; end?: string }) {
    const { data } = await api.get<Task[]>('/tasks', { params })
    return data
  },
  async assignees() {
    const { data } = await api.get<Assignee[]>('/tasks/assignees')
    return data
  },
  async create(payload: TaskPayload & { title: string }) {
    const { data } = await api.post<Task>('/tasks', payload)
    return data
  },
  async update(id: number, payload: TaskPayload) {
    const { data } = await api.patch<Task>(`/tasks/${id}`, payload)
    return data
  },
  async remove(id: number) {
    await api.delete(`/tasks/${id}`)
  },
}
