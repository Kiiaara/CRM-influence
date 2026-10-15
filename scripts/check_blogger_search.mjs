// Проверка поиска блогеров в кампании: ищем не только по имени, но и по
// ссылке и нику после неё. Запуск: node scripts/check_blogger_search.mjs
import { matchesQuery, nickFromUrl } from '../frontend/src/utils/bloggerSearch.ts'

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

console.log(failed ? `\n${failed} провалов` : '\nвсё зелёное')
process.exit(failed ? 1 : 0)
