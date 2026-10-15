// Проверка поиска блогеров в кампании: ищем не только по имени, но и по
// ссылке и нику после неё. Запуск: node scripts/check_blogger_search.mjs
import { displayNick, matchesQuery, nickFromUrl } from '../frontend/src/utils/bloggerSearch.ts'

let failed = 0
const check = (label, got, want) => {
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} (получили ${got}, ждали ${want})`)
}

// как оно лежит в базе: имя по-русски, ник только в ссылке
const virgin = { name: 'Вирджин Лолита', url: 'https://youtube.com/@virginlolita', telegram: '' }
const tgOnly = { name: 'Маша', url: '', telegram: '@virginlolita' }
const other = { name: 'Петя', url: 'https://youtube.com/@petya', telegram: '' }

// старое поведение искало только по имени и этот случай не находило
const oldMatch = (s, q) => s.name.toLowerCase().includes(q.trim().toLowerCase())
console.log('--- баг, который чиним ---')
check('старый поиск по имени НЕ находил virginlolita', oldMatch(virgin, 'virginlolita'), false)

console.log('--- новое поведение ---')
check('ник из ссылки', nickFromUrl('https://youtube.com/@virginlolita'), 'virginlolita')
check('ник из t.me', nickFromUrl('https://t.me/virginlolita'), 'virginlolita')
check('ник из vk без @', nickFromUrl('https://vk.com/virginlolita'), 'virginlolita')
check('ссылка с query', nickFromUrl('https://youtube.com/@virginlolita?sub=1'), 'virginlolita')
check('голый домен не даёт ник', nickFromUrl('https://youtube.com'), '')
check('пустая ссылка', nickFromUrl(''), '')

check('находим по нику из ссылки', matchesQuery(virgin, 'virginlolita'), true)
check('находим по куску ника', matchesQuery(virgin, 'virgin'), true)
check('находим по имени', matchesQuery(virgin, 'Вирджин'), true)
check('находим по полной ссылке', matchesQuery(virgin, 'youtube.com/@virginlolita'), true)
check('находим по телеге', matchesQuery(tgOnly, 'virginlolita'), true)
check('находим по телеге с @', matchesQuery(tgOnly, '@virginlolita'), true)
check('чужого не находим', matchesQuery(other, 'virginlolita'), false)
check('пустой запрос ничего не даёт', matchesQuery(virgin, '   '), false)

// вторая база: инфлюенсеры. Ссылка в twitch_url, остальные площадки в social_links
console.log('--- база инфлюенсеров ---')
const infl = { name: 'Вирджин', url: 'https://twitch.tv/virginlolita', links: '' }
const inflMulti = {
  name: 'Кто-то',
  url: 'https://twitch.tv/someone',
  links: 'https://t.me/virginlolita, https://youtube.com/@othernick',
}
check('ник из twitch_url', matchesQuery(infl, 'virginlolita'), true)
check('ник из social_links', matchesQuery(inflMulti, 'virginlolita'), true)
check('второй ник из social_links', matchesQuery(inflMulti, 'othernick'), true)
check('чужой ник не цепляется', matchesQuery(infl, 'othernick'), false)

console.log('--- ник в подсказке ---')
check('ник из url', displayNick(virgin), 'virginlolita')
check('ник из телеги', displayNick(tgOnly), 'virginlolita')
check('ник из social_links, когда url пустой', displayNick({ name: 'X', url: '', links: 'https://t.me/nickhere' }), 'nickhere')
check('без ссылок ника нет', displayNick({ name: 'Без ссылок' }), '')

console.log(failed ? `\n${failed} провалов` : '\nвсё зелёное')
process.exit(failed ? 1 : 0)
