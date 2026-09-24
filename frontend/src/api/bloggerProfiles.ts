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
  source: 'manual' | 'sheet'
  // все колонки строки листа как в таблице
  sheet_row: SheetCell[]
  created_at: string
  updated_at: string
}

export interface SheetCell {
  h: string
  v: string
  u?: string
}

export interface SheetSyncResult {
  created: number
  updated: number
  deleted: number
  total: number
}

export interface SheetInfo {
  url: string
  tabs: string[]
  last_sync: { at: string; error: string | null; created?: number; updated?: number; deleted?: number } | null
  sync_minutes: number
}

export const bloggerProfilesApi = {
  async list() {
    const { data } = await api.get<BloggerProfile[]>('/blogger-profiles')
    return data
  },
  async sheetInfo() {
    const { data } = await api.get<SheetInfo>('/blogger-profiles/sheet')
    return data
  },
  async setSheetUrl(url: string) {
    const { data } = await api.put<SheetInfo>('/blogger-profiles/sheet', { url })
    return data
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
