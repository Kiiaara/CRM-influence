import { api } from './client'

export interface SiteStatus {
  configured: boolean
  site_url: string
  count: number
  unpublished: number
  last_published_at: string | null
}

export interface PublishResult {
  count: number
  changed: boolean
  commit_url: string | null
  site_url: string
}

export const siteApi = {
  async status() {
    const { data } = await api.get<SiteStatus>('/site/status')
    return data
  },
  async publish() {
    const { data } = await api.post<PublishResult>('/site/publish')
    return data
  },
}
