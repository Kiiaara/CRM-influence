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

/** Все строки, по которым разрешено найти блогера */
export function searchableParts(s: { name: string; url?: string; telegram?: string }): string[] {
  const tg = (s.telegram ?? '').replace(/^@/, '')
  return [s.name, s.url ?? '', tg, nickFromUrl(s.url ?? ''), nickFromUrl(tg)]
    .filter(Boolean)
    .map(v => v.toLowerCase())
}

/** Совпадение подсказки с введённым текстом */
export function matchesQuery(s: { name: string; url?: string; telegram?: string }, query: string): boolean {
  // в данных собаку срезаем, поэтому и в запросе тоже: "@virginlolita" = "virginlolita"
  const needle = query.trim().replace(/^@/, '').toLowerCase()
  if (!needle) return false
  return searchableParts(s).some(part => part.includes(needle))
}
