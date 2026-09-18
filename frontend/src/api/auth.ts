import { api } from './client'

export interface Me {
  tg_id: number
  username: string | null
  first_name: string | null
  role: 'admin' | 'editor' | 'viewer'
  label: string | null
  tg_chat_ready: boolean
}

export const authApi = {
  async config() {
    const { data } = await api.get<{ bot_username: string; vk_app_id: string | null }>('/auth/config')
    return data
  },
  async me() {
    const { data } = await api.get<Me>('/auth/me')
    return data
  },
  async logout() {
    await api.post('/auth/logout')
  },
  async loginTelegram(payload: Record<string, unknown>) {
    const { data } = await api.post('/auth/telegram', payload)
    return data as Me
  },
  async loginVk(payload: { code: string; device_id: string; code_verifier?: string }) {
    const { data } = await api.post('/auth/vk', payload)
    return data as Me
  },
}
