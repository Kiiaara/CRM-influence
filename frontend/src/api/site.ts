import { api } from './client'

export interface SiteStatus {
  configured: boolean
  // каких переменных backend/.env не хватает для публикации
  missing: string[]
  // настроен ли переводчик (DeepL или Groq) для автоперевода при публикации
  translate_configured: boolean
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
  // сколько кейсов автоматически перевели при публикации
  translated: number
  // что пошло не так, но публикацию не сломало (например, не сделан перевод)
  warnings: string[]
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
