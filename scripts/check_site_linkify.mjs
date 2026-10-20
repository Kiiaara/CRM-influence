// Проверка правок сайта: ссылки из CRM не должны оборачиваться второй раз,
// а старые кейсы без *Html должны работать как раньше.
// Запуск: node scripts/check_site_linkify.mjs

let failed = 0
const check = (label, got, want) => {
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`      получили: ${got}\n      ждали:    ${want}`)
}

// копии функций из site-tkacheva/index.html
const links = {
  soonvooshko: 'https://www.twitch.tv/soonvooshko',
  mixazver: 'https://www.twitch.tv/mixazver',
}

function linkify(text) {
  if (!text) return ''
  const kept = []
  let result = String(text).replace(/<a\b[^>]*>.*?<\/a>/gi, m => {
    kept.push(m)
    return `\u0000${kept.length - 1}\u0000`
  })
  const names = Object.keys(links).sort((a, b) => b.length - a.length)
  names.forEach(name => {
    const regex = new RegExp(`(?![^<]*>)\\b(${name})\\b`, 'gi')
    result = result.replace(regex, `<a href="${links[name]}" target="_blank"><strong>$1</strong></a>`)
  })
  return result.replace(/\u0000(\d+)\u0000/g, (m, i) => kept[Number(i)])
}

function pickHtml(c, field, lang) {
  const rich = c[field + 'Html']
  return (rich && rich[lang]) || c[field][lang]
}

console.log('--- ссылка из CRM не оборачивается второй раз ---')
const fromCrm = 'Спецстрим на канале <a href="https://www.twitch.tv/soonvooshko" target="_blank" rel="noopener">soonvooshko</a>'
check('готовая ссылка остаётся одной', linkify(fromCrm), fromCrm)

console.log('--- старое поведение сохранилось ---')
check(
  'голое имя стримера становится ссылкой',
  linkify('Стрим soonvooshko прошёл'),
  'Стрим <a href="https://www.twitch.tv/soonvooshko" target="_blank"><strong>soonvooshko</strong></a> прошёл'
)
check('текст без имён не меняется', linkify('Просто текст'), 'Просто текст')
check('пустая строка', linkify(''), '')

console.log('--- смешанный случай ---')
const mixed = 'Было у <a href="https://www.twitch.tv/soonvooshko" target="_blank" rel="noopener">soonvooshko</a>, потом mixazver'
const mixedOut = linkify(mixed)
check('ссылка из CRM цела', mixedOut.includes(fromCrm.slice(fromCrm.indexOf('<a'))), true)
check('а голое имя обёрнуто', mixedOut.includes('<strong>mixazver</strong>'), true)
check('ровно две ссылки', (mixedOut.match(/<a /g) || []).length, 2)

console.log('--- выбор поля ---')
const crmCase = { task: { ru: 'голый текст' }, taskHtml: { ru: 'html <a href="#">x</a>' } }
const oldCase = { task: { ru: 'только текст' } }
check('кейс из CRM берёт html', pickHtml(crmCase, 'task', 'ru'), 'html <a href="#">x</a>')
check('старый кейс берёт обычное поле', pickHtml(oldCase, 'task', 'ru'), 'только текст')
check('нет перевода на язык - откат на поле', pickHtml({ task: { en: 'fallback' }, taskHtml: { ru: 'x' } }, 'task', 'en'), 'fallback')

console.log(failed ? `\n${failed} провалов` : '\nвсё зелёное')
process.exit(failed ? 1 : 0)
