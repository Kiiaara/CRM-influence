import { api } from './client'

// свой блогер пространства: заведён руками, в отличие от базы агентства из гугл-таблицы
export interface OwnBlogger {
  id: number
  name: string
  url: string
  platform: string
  // как связаться: ТГ, почта, телефон, менеджер блогера
  contact: string
  category: string
  notes: string
  created_at: string
  updated_at: string
}

export interface OwnBloggerPayload {
  name?: string
  url?: string
  platform?: string
  contact?: string
  category?: string
  notes?: string
}

export const ownBloggersApi = {
  async list() {
    const { data } = await api.get<OwnBlogger[]>('/own-bloggers')
    return data
  },
  async create(payload: OwnBloggerPayload & { name: string }) {
    const { data } = await api.post<OwnBlogger>('/own-bloggers', payload)
    return data
  },
  async update(id: number, payload: OwnBloggerPayload) {
    const { data } = await api.patch<OwnBlogger>(`/own-bloggers/${id}`, payload)
    return data
  },
  async remove(id: number) {
    await api.delete(`/own-bloggers/${id}`)
  },
}
