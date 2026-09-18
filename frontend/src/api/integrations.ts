import { api } from './client'

export type Stage = 'negotiation' | 'agreed' | 'awaiting_contract' | 'awaiting_payment' | 'done' | 'cancelled'
export type PaymentStatus = 'not_invoiced' | 'invoiced' | 'partial' | 'paid'
export type ContentStatus = 'awaiting_brief' | 'filming' | 'filmed'

export const STAGES: { key: Stage; label: string }[] = [
  { key: 'negotiation', label: 'На согласовании' },
  { key: 'agreed', label: 'Согласован' },
  { key: 'awaiting_contract', label: 'Ждёт договора' },
  { key: 'awaiting_payment', label: 'Ждёт оплаты' },
  { key: 'done', label: 'Завершено' },
  { key: 'cancelled', label: 'Отменено' },
]

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  not_invoiced: 'Не выставлен',
  invoiced: 'Выставлен счёт',
  partial: 'Частично оплачен',
  paid: 'Оплачен',
}

export const CONTENT_LABELS: Record<ContentStatus, string> = {
  awaiting_brief: 'Ждём ТЗ',
  filming: 'Снимает контент',
  filmed: 'Снят контент',
}

export interface Streamer {
  id: number
  integration_id: number
  streamer_name: string
  contact: string
  stage: Stage
  payment_status: PaymentStatus
  content_status: ContentStatus | null
  amount: number | null
  currency: string
  commission_percent: number
  streamer_tax_percent: number
  commission_amount: number | null
  streamer_net_amount: number | null
  deadline: string | null
  description: string
  contract_file_name: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface Integration {
  id: number
  brand: string
  description: string
  created_at: string
  updated_at: string
  streamers: Streamer[]
}

export interface Payment {
  id: number
  streamer_id: number
  amount: number
  currency: string
  comment: string
  paid_at: string
}

export interface CaseStudy {
  id: number
  streamer_id: number
  title: string
  description: string
  what_was_done: string
  result: string
  photo_name: string | null
  created_at: string
  updated_at: string
}

export const integrationsApi = {
  async list() {
    const { data } = await api.get<Integration[]>('/integrations')
    return data
  },
  async get(id: number) {
    const { data } = await api.get<Integration>(`/integrations/${id}`)
    return data
  },
  async create(payload: { brand: string; description?: string }) {
    const { data } = await api.post<Integration>('/integrations', payload)
    return data
  },
  async update(id: number, payload: Partial<Pick<Integration, 'brand' | 'description'>>) {
    const { data } = await api.patch<Integration>(`/integrations/${id}`, payload)
    return data
  },
  async remove(id: number) {
    await api.delete(`/integrations/${id}`)
  },
  async streamerNames() {
    const { data } = await api.get<string[]>('/integrations/streamer-names')
    return data
  },

  async addStreamer(integrationId: number, payload: Partial<Streamer>) {
    const { data } = await api.post<Streamer>(`/integrations/${integrationId}/streamers`, payload)
    return data
  },
  async updateStreamer(streamerId: number, payload: Partial<Streamer>) {
    const { data } = await api.patch<Streamer>(`/integrations/streamers/${streamerId}`, payload)
    return data
  },
  async removeStreamer(streamerId: number) {
    await api.delete(`/integrations/streamers/${streamerId}`)
  },

  async uploadContract(streamerId: number, file: File) {
    const form = new FormData()
    form.append('file', file)
    const { data } = await api.post<Streamer>(`/integrations/streamers/${streamerId}/contract`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
  contractUrl(streamerId: number) {
    return `/api/integrations/streamers/${streamerId}/contract`
  },
  async removeContract(streamerId: number) {
    await api.delete(`/integrations/streamers/${streamerId}/contract`)
  },

  async payments(streamerId: number) {
    const { data } = await api.get<Payment[]>(`/integrations/streamers/${streamerId}/payments`)
    return data
  },
  async addPayment(streamerId: number, payload: { amount: number; currency?: string; comment?: string; paid_at?: string }) {
    const { data } = await api.post<Payment>(`/integrations/streamers/${streamerId}/payments`, payload)
    return data
  },
  async removePayment(streamerId: number, paymentId: number) {
    await api.delete(`/integrations/streamers/${streamerId}/payments/${paymentId}`)
  },

  async cases(streamerId: number) {
    const { data } = await api.get<CaseStudy[]>(`/integrations/streamers/${streamerId}/cases`)
    return data
  },
  async addCase(streamerId: number, payload: Partial<Pick<CaseStudy, 'title' | 'description' | 'what_was_done' | 'result'>>) {
    const { data } = await api.post<CaseStudy>(`/integrations/streamers/${streamerId}/cases`, payload)
    return data
  },
  async updateCase(caseId: number, payload: Partial<Pick<CaseStudy, 'title' | 'description' | 'what_was_done' | 'result'>>) {
    const { data } = await api.patch<CaseStudy>(`/integrations/cases/${caseId}`, payload)
    return data
  },
  async removeCase(caseId: number) {
    await api.delete(`/integrations/cases/${caseId}`)
  },
  async uploadCasePhoto(caseId: number, file: File) {
    const form = new FormData()
    form.append('file', file)
    const { data } = await api.post<CaseStudy>(`/integrations/cases/${caseId}/photo`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
  casePhotoUrl(caseId: number) {
    return `/api/integrations/cases/${caseId}/photo`
  },
  async removeCasePhoto(caseId: number) {
    await api.delete(`/integrations/cases/${caseId}/photo`)
  },
}
