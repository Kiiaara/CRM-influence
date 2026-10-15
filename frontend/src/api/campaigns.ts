import { api } from './client'

export type CampaignStatus =
  | 'picking'
  | 'sent'
  | 'waiting_feedback'
  | 'negotiating'
  | 'running'
  | 'cancelled'

export const CAMPAIGN_STATUSES: { key: CampaignStatus; label: string }[] = [
  { key: 'picking', label: 'Делаем подборку' },
  { key: 'sent', label: 'Отдали подборку' },
  { key: 'waiting_feedback', label: 'Ждём ОС' },
  { key: 'negotiating', label: 'Обсуждаем условия' },
  { key: 'running', label: 'Запускаем РК' },
  { key: 'cancelled', label: 'Отмена' },
]

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = Object.fromEntries(
  CAMPAIGN_STATUSES.map(s => [s.key, s.label])
) as Record<CampaignStatus, string>

export const CAMPAIGN_STATUS_COLORS: Record<CampaignStatus, string> = {
  picking: 'bg-slate-100 text-slate-600 dark:bg-brand-900 dark:text-slate-300',
  sent: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  waiting_feedback: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  negotiating: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  running: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export interface Campaign {
  id: number
  name: string
  advertiser_id: number | null
  advertiser_name: string | null
  status: CampaignStatus
  requested_at: string | null
  selection_due_at: string | null
  campaign_due_at: string | null
  budget: number | null
  currency: string
  owner_tg_id: number | null
  owner_label: string | null
  notes: string
  created_at: string
  updated_at: string
}

export interface CampaignPayload {
  name?: string
  advertiser_id?: number | null
  status?: CampaignStatus
  requested_at?: string | null
  selection_due_at?: string | null
  campaign_due_at?: string | null
  budget?: number | null
  currency?: string
  owner_tg_id?: number | null
  notes?: string
}

export const campaignsApi = {
  async list() {
    const { data } = await api.get<Campaign[]>('/campaigns')
    return data
  },
  async create(payload: CampaignPayload & { name: string }) {
    const { data } = await api.post<Campaign>('/campaigns', payload)
    return data
  },
  async update(id: number, payload: CampaignPayload) {
    const { data } = await api.patch<Campaign>(`/campaigns/${id}`, payload)
    return data
  },
  async remove(id: number) {
    await api.delete(`/campaigns/${id}`)
  },
}
