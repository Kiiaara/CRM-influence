// Ссылки на сделку блогера. Канбан не используем: сделка открывается модалкой
// блогера внутри своей кампании (CampaignBloggerModal на странице /campaigns).

// адрес страницы кампаний, который сам откроет нужную кампанию и модалку блогера
export function campaignBloggerLink(campaignId: number, streamerId: number): string {
  return `/campaigns?blogger=${streamerId}&campaign=${campaignId}`
}

// разбор ?blogger=...&campaign=... ; null, если параметров нет или они не числа
export function parseBloggerLink(search: string): { streamerId: number; campaignId: number } | null {
  const params = new URLSearchParams(search)
  const blogger = params.get('blogger')
  const campaign = params.get('campaign')
  if (!blogger || !campaign) return null
  const streamerId = Number(blogger)
  const campaignId = Number(campaign)
  if (!Number.isInteger(streamerId) || !Number.isInteger(campaignId)) return null
  return { streamerId, campaignId }
}
