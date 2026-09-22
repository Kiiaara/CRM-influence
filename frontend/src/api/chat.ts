import { api } from './client'

export interface ChatMessage {
  id: number
  streamer_id: number | null
  author_tg_id: number | null
  author_label: string | null
  text: string
  created_at: string
}

export interface ChatThread {
  streamer_id: number
  streamer_name: string
  brand: string
  messages_count: number
  last_message: string | null
  last_message_at: string | null
}

export const chatApi = {
  async messages(streamerId?: number | null) {
    const { data } = await api.get<ChatMessage[]>('/chat/messages', {
      params: streamerId != null ? { streamer_id: streamerId } : undefined,
    })
    return data
  },
  async send(text: string, streamerId?: number | null) {
    const { data } = await api.post<ChatMessage>('/chat/messages', {
      text,
      streamer_id: streamerId ?? null,
    })
    return data
  },
  async remove(messageId: number) {
    await api.delete(`/chat/messages/${messageId}`)
  },
  async threads() {
    const { data } = await api.get<ChatThread[]>('/chat/threads')
    return data
  },
}
