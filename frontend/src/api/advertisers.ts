import { api } from './client'

export type ContactType = 'email' | 'telegram' | 'whatsapp' | 'phone' | 'other'

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  email: 'Email',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  phone: 'Телефон',
  other: 'Другое',
}

export const CONTACT_TYPE_ICONS: Record<ContactType, string> = {
  email: '📧',
  telegram: '📱',
  whatsapp: '📲',
  phone: '📞',
  other: '🔗',
}

export interface BrandContact {
  id: number
  advertiser_id: number
  contact_type: ContactType
  value: string
  label: string
  is_primary: boolean
  notes: string
  created_at: string
  updated_at: string
}

export function contactQuickLink(c: Pick<BrandContact, 'contact_type' | 'value'>): string | null {
  const v = c.value.trim()
  if (!v) return null
  switch (c.contact_type) {
    case 'email':
      return `mailto:${v}`
    case 'telegram':
      return `https://t.me/${v.replace(/^@/, '')}`
    case 'whatsapp':
      return `https://wa.me/${v.replace(/[^\d]/g, '')}`
    case 'phone':
      return `tel:${v.replace(/[^\d+]/g, '')}`
    default:
      return null
  }
}

export interface Advertiser {
  id: number
  name: string
  notes: string
  created_at: string
  updated_at: string
  deals_count: number
  contacts_count: number
  contacts: BrandContact[]
}

export interface AdvertiserDeal {
  id: number
  description: string
  created_at: string
  updated_at: string
  streamers_count: number
}

export const advertisersApi = {
  async list() {
    const { data } = await api.get<Advertiser[]>('/advertisers')
    return data
  },
  async get(id: number) {
    const { data } = await api.get<Advertiser>(`/advertisers/${id}`)
    return data
  },
  async create(payload: { name: string; notes?: string }) {
    const { data } = await api.post<Advertiser>('/advertisers', payload)
    return data
  },
  async update(id: number, payload: Partial<Pick<Advertiser, 'name' | 'notes'>>) {
    const { data } = await api.patch<Advertiser>(`/advertisers/${id}`, payload)
    return data
  },
  async remove(id: number) {
    await api.delete(`/advertisers/${id}`)
  },
  async deals(id: number) {
    const { data } = await api.get<AdvertiserDeal[]>(`/advertisers/${id}/deals`)
    return data
  },

  async contacts(advertiserId: number) {
    const { data } = await api.get<BrandContact[]>(`/advertisers/${advertiserId}/contacts`)
    return data
  },
  async addContact(advertiserId: number, payload: Partial<Pick<BrandContact, 'contact_type' | 'value' | 'label' | 'is_primary' | 'notes'>>) {
    const { data } = await api.post<BrandContact>(`/advertisers/${advertiserId}/contacts`, payload)
    return data
  },
  async updateContact(contactId: number, payload: Partial<Pick<BrandContact, 'contact_type' | 'value' | 'label' | 'is_primary' | 'notes'>>) {
    const { data } = await api.patch<BrandContact>(`/advertisers/contacts/${contactId}`, payload)
    return data
  },
  async removeContact(contactId: number) {
    await api.delete(`/advertisers/contacts/${contactId}`)
  },
}
