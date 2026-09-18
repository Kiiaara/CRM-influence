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

export type OrdResponsible = 'us' | 'client'
export type OrdStatus = 'todo' | 'done'
export type OrdReportingStatus = 'not_submitted' | 'submitted' | 'overdue'

export const ORD_RESPONSIBLE_LABELS: Record<OrdResponsible, string> = {
  us: 'Мы',
  client: 'Клиент',
}

export const ORD_STATUS_LABELS: Record<OrdStatus, string> = {
  todo: 'Сделать',
  done: 'Сделано',
}

export const ORD_REPORTING_LABELS: Record<OrdReportingStatus, string> = {
  not_submitted: 'Не сдана',
  submitted: 'Сдана',
  overdue: 'Просрочена',
}

export type ContractStatus =
  | 'not_sent'
  | 'sent_to_streamer'
  | 'signed_by_streamer'
  | 'sent_to_brand'
  | 'signed_by_brand'
  | 'active'
  | 'expired'

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  not_sent: 'Не отправлен',
  sent_to_streamer: 'Отправлен стримеру',
  signed_by_streamer: 'Подписан стримером',
  sent_to_brand: 'Отправлен бренду',
  signed_by_brand: 'Подписан брендом',
  active: 'Активен',
  expired: 'Истёк',
}

// цвет-индикатор для бейджа на карточке канбана
export const CONTRACT_STATUS_COLOR: Record<ContractStatus, 'red' | 'yellow' | 'green'> = {
  not_sent: 'red',
  sent_to_streamer: 'yellow',
  signed_by_streamer: 'yellow',
  sent_to_brand: 'yellow',
  signed_by_brand: 'green',
  active: 'green',
  expired: 'red',
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
  paid_percent: number | null
  deadline: string | null
  integration_date: string | null
  description: string
  contract_file_name: string | null
  contract_valid_until: string | null
  contract_status: ContractStatus
  contract_sent_date: string | null
  contract_signed_date: string | null
  contract_notes: string
  brief: string
  ord_responsible: OrdResponsible
  ord_status: OrdStatus
  ord_reporting_status: OrdReportingStatus
  position: number
  created_at: string
  updated_at: string
}

export interface DiscussionMessage {
  id: number
  streamer_id: number
  author_tg_id: number | null
  author_label: string | null
  text: string
  created_at: string
}

export type AuditField =
  | 'stage'
  | 'payment_status'
  | 'content_status'
  | 'amount'
  | 'deadline'
  | 'contract_status'
  | 'contract_sent_date'
  | 'contract_signed_date'
  | 'ord_status'
  | 'ord_reporting_status'
  | 'created'
  | 'deleted'
  | 'payment_added'
  | 'contract_uploaded'

export interface AuditLogEntry {
  id: number
  streamer_id: number | null
  integration_id: number | null
  brand: string
  streamer_name: string
  field: AuditField
  old_value: string | null
  new_value: string | null
  changed_by_tg_id: number | null
  author_label: string | null
  created_at: string
}

export const AUDIT_FIELD_LABELS: Record<AuditField, string> = {
  stage: 'Стадия',
  payment_status: 'Оплата',
  content_status: 'Статус контента',
  amount: 'Сумма',
  deadline: 'Дедлайн',
  contract_status: 'Статус договора',
  contract_sent_date: 'Договор отправлен',
  contract_signed_date: 'Договор подписан',
  ord_status: 'Маркировка (ОРД)',
  ord_reporting_status: 'Отчётность ОРД',
  created: 'Карточка создана',
  deleted: 'Карточка удалена',
  payment_added: 'Поступила оплата',
  contract_uploaded: 'Загружен файл договора',
}

// поля, значения которых - ключи из словарей-лейблов выше по файлу
const STAGE_LABELS: Record<string, string> = Object.fromEntries(STAGES.map(s => [s.key, s.label]))
const AUDIT_VALUE_LABELS: Partial<Record<AuditField, Record<string, string>>> = {
  stage: STAGE_LABELS,
  payment_status: PAYMENT_LABELS,
  content_status: CONTENT_LABELS,
  contract_status: CONTRACT_STATUS_LABELS,
  ord_status: ORD_STATUS_LABELS,
  ord_reporting_status: ORD_REPORTING_LABELS,
}

function formatAuditDate(v: string): string {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString('ru-RU')
}

export function formatAuditValue(field: AuditField, value: string | null): string {
  if (value == null) return '—'
  const map = AUDIT_VALUE_LABELS[field]
  if (map) return map[value] ?? value
  if (field === 'amount') return `${Number(value).toLocaleString('ru-RU')} ₽`
  if (field === 'deadline' || field === 'contract_sent_date' || field === 'contract_signed_date') {
    return formatAuditDate(value)
  }
  return value
}

const AUDIT_STANDALONE_FIELDS: AuditField[] = ['created', 'deleted']
const AUDIT_SINGLE_VALUE_FIELDS: AuditField[] = ['payment_added', 'contract_uploaded']

export function describeAuditEntry(e: AuditLogEntry): string {
  const label = AUDIT_FIELD_LABELS[e.field]
  if (AUDIT_STANDALONE_FIELDS.includes(e.field)) return label
  if (e.field === 'payment_added' && e.new_value) {
    const [amount, currency] = e.new_value.split(' ')
    return `${label}: ${Number(amount).toLocaleString('ru-RU')} ${currency}`
  }
  if (AUDIT_SINGLE_VALUE_FIELDS.includes(e.field)) return `${label}: ${e.new_value}`
  return `${label}: ${formatAuditValue(e.field, e.old_value)} → ${formatAuditValue(e.field, e.new_value)}`
}

export interface Integration {
  id: number
  advertiser_id: number | null
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
  async create(payload: { advertiser_id: number; description?: string }) {
    const { data } = await api.post<Integration>('/integrations', payload)
    return data
  },
  async update(id: number, payload: Partial<Pick<Integration, 'description'>>) {
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

  async discussion(streamerId: number) {
    const { data } = await api.get<DiscussionMessage[]>(`/integrations/streamers/${streamerId}/discussion`)
    return data
  },
  async addDiscussionMessage(streamerId: number, text: string) {
    const { data } = await api.post<DiscussionMessage>(`/integrations/streamers/${streamerId}/discussion`, { text })
    return data
  },
  async removeDiscussionMessage(messageId: number) {
    await api.delete(`/integrations/discussion/${messageId}`)
  },

  async auditLog(streamerId: number) {
    const { data } = await api.get<AuditLogEntry[]>(`/integrations/streamers/${streamerId}/audit-log`)
    return data
  },
  async auditLogFeed(limit = 100) {
    const { data } = await api.get<AuditLogEntry[]>('/integrations/audit-log', { params: { limit } })
    return data
  },
}
