import { api } from './client'

export interface StreamerProfile {
  id: number
  name: string
  twitch_url: string
  category: string
  social_links: string
  subscribers: number | null
  avg_online: number | null
  geo: string
  views_per_month: number | null
  views_per_stream: number | null
  telegram_subscribers: number | null
  telegram_reach: number | null
  post_price: number | null
  knd_registry: string
  twitch_partner: boolean
  stats_url: string
  stats_updated_at: string | null
  manager: string
  branding_price_1w: number | null
  branding_price_2w: number | null
  branding_price_3w: number | null
  branding_price_1m: number | null
  special_stream_price: number | null
  voice_integration_price: number | null
  created_at: string
  updated_at: string
}

export const streamerProfilesApi = {
  async list() {
    const { data } = await api.get<StreamerProfile[]>('/streamer-profiles')
    return data
  },
  async create(payload: Partial<StreamerProfile>) {
    const { data } = await api.post<StreamerProfile>('/streamer-profiles', payload)
    return data
  },
  async update(id: number, payload: Partial<StreamerProfile>) {
    const { data } = await api.patch<StreamerProfile>(`/streamer-profiles/${id}`, payload)
    return data
  },
  async remove(id: number) {
    await api.delete(`/streamer-profiles/${id}`)
  },
  async importFile(file: File) {
    const form = new FormData()
    form.append('file', file)
    const { data } = await api.post<{ created: number; updated: number }>('/streamer-profiles/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
  exportUrl(ids?: number[]) {
    const q = ids && ids.length ? `?ids=${ids.join(',')}` : ''
    return `/api/streamer-profiles/export${q}`
  },
}
