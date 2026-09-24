import { api } from './client'

export interface BloggerProfile {
  id: number
  name: string
  platform: string
  url: string
  telegram: string
  category: string
  geo: string
  subscribers: number | null
  avg_views: number | null
  price: number | null
  manager: string
  notes: string
  created_at: string
  updated_at: string
}

export interface SheetSyncResult {
  created: number
  updated: number
  total: number
}

export const bloggerProfilesApi = {
  async list() {
    const { data } = await api.get<BloggerProfile[]>('/blogger-profiles')
    return data
  },
  async create(payload: Partial<BloggerProfile>) {
    const { data } = await api.post<BloggerProfile>('/blogger-profiles', payload)
    return data
  },
  async update(id: number, payload: Partial<BloggerProfile>) {
    const { data } = await api.patch<BloggerProfile>(`/blogger-profiles/${id}`, payload)
    return data
  },
  async remove(id: number) {
    await api.delete(`/blogger-profiles/${id}`)
  },
  async sheetUrl() {
    const { data } = await api.get<{ url: string }>('/blogger-profiles/sheet')
    return data.url
  },
  async setSheetUrl(url: string) {
    const { data } = await api.put<{ url: string }>('/blogger-profiles/sheet', { url })
    return data.url
  },
  async syncFromSheet() {
    const { data } = await api.post<SheetSyncResult>('/blogger-profiles/sync')
    return data
  },
  async importFile(file: File) {
    const form = new FormData()
    form.append('file', file)
    const { data } = await api.post<SheetSyncResult>('/blogger-profiles/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
}
