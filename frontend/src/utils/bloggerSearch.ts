// Поиск блогера по подсказкам. Искать только по имени мало: в базе имя часто
// записано по-русски или с пробелами, а ищут по нику из ссылки (virginlolita).
// Поэтому сверяем имя, ссылку, телегу и отдельно ник, выдернутый из хвоста ссылки.

/** Достаёт ник из ссылки: youtube.com/@virginlolita, t.me/virginlolita, vk.com/virginlolita */
export function nickFromUrl(url: string): string {
  if (!url) return ''
  // отрезаем протокол, домен и query, берём последний непустой сегмент пути
  const noProto = url.replace(/^[a-z]+:\/\//i, '')
  const path = noProto.split(/[?#]/)[0]
  const parts = path.split('/').filter(Boolean)
  // первый сегмент - домен, он нам не нужен
  const tail = parts.length > 1 ? parts[parts.length - 1] : ''
  return tail.replace(/^@/, '').toLowerCase()
}

/** То, что можно искать. Ссылок несколько: у блогера url, у инфлюенсера
 *  twitch_url и строка social_links со всеми площадками сразу */
export interface Searchable {
  name: string
  url?: string
  telegram?: string
  links?: string
}

/** Все строки, по которым разрешено найти человека */
export function searchableParts(s: Searchable): string[] {
  const tg = (s.telegram ?? '').replace(/^@/, '')
  // social_links - произвольный текст с несколькими ссылками, режем по пробелам и запятым
  const extra = (s.links ?? '').split(/[\s,;|]+/).filter(Boolean)
  const urls = [s.url ?? '', ...extra].filter(Boolean)
  return [s.name, tg, ...urls, ...urls.map(nickFromUrl), nickFromUrl(tg)]
    .filter(Boolean)
    .map(v => v.toLowerCase())
}

/** Ник для показа в подсказке: из основной ссылки, иначе из телеги или social_links */
export function displayNick(s: Searchable): string {
  const fromUrl = nickFromUrl(s.url ?? '')
  if (fromUrl) return fromUrl
  const tg = (s.telegram ?? '').replace(/^@/, '')
  if (tg && !tg.includes('/')) return tg.toLowerCase()
  const fromTg = nickFromUrl(tg)
  if (fromTg) return fromTg
  for (const part of (s.links ?? '').split(/[\s,;|]+/).filter(Boolean)) {
    const nick = nickFromUrl(part)
    if (nick) return nick
  }
  return ''
}

/** Совпадение подсказки с введённым текстом */
export function matchesQuery(s: Searchable, query: string): boolean {
  // в данных собаку срезаем, поэтому и в запросе тоже: "@virginlolita" = "virginlolita"
  const needle = query.trim().replace(/^@/, '').toLowerCase()
  if (!needle) return false
  return searchableParts(s).some(part => part.includes(needle))
}
