// Проверка браузерного перевода кейсов через Groq (frontend/src/utils/groqTranslate.ts):
// что уходит в запрос, как разбирается ответ, тексты ошибок, слияние с готовыми переводами, пакетный прогон.
// Сеть не нужна: fetch подменяется. Запуск: node --experimental-strip-types scripts\check_groq_translate.mjs
import {
  GROQ_URL,
  GROQ_MODELS_URL,
  GROQ_FALLBACK_MODEL,
  GroqError,
  SYSTEM_BASE,
  buildRequest,
  buildSystemPrompt,
  fetchGroqModels,
  localizeNumbers,
  fieldsToTranslate,
  groqErrorText,
  isChatModel,
  looksLikeGroqKey,
  mergeTranslations,
  normalizeKey,
  parseGroqReply,
  parseModelsReply,
  resolveModel,
  sourceFromCase,
  translateBatch,
  translateWithGroq,
} from '../frontend/src/utils/groqTranslate.ts'

let failed = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : ` (получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)})`}`)
}
const truth = (label, cond) => check(label, !!cond, true)

// поддельный fetch: отдаёт заранее заданные ответы по очереди и запоминает запросы
function fakeFetch(...responses) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (r instanceof Error) throw r
    return r
  }
  impl.calls = calls
  return impl
}
const ok = content => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }),
  text: async () => '',
})
const bad = (status, text = '') => ({ ok: false, status, json: async () => ({}), text: async () => text })

const caseA = {
  title: 'BuffBuff',
  site_mini: '23,5 млн+ просмотров',
  description: 'Интеграция на канале стримера',
  what_was_done: 'Размещен брендинг\nПополнение баланса',
  result: 'Охват 1 млн\nКлики 5000',
}
const src = sourceFromCase(caseA)

console.log('--- источник и поля ---')
check('mini берётся из site_mini', src.mini, '23,5 млн+ просмотров')
check('без переводов - все непустые поля, кроме title', fieldsToTranslate(src, {}, 'missing'), ['mini', 'description', 'what_was_done', 'result'])
check('title никогда не в списке (redo)', fieldsToTranslate(src, {}, 'all').includes('title'), false)
const full = { en: { title: 'BuffBuff', mini: 'a', description: 'b', what_was_done: 'c', result: 'd' }, zh: { title: 'BuffBuff', mini: 'a', description: 'b', what_was_done: 'c', result: 'd' } }
check('всё переведено - недостающего нет', fieldsToTranslate(src, full, 'missing'), [])
check('всё переведено, но "заново" берёт все', fieldsToTranslate(src, full, 'all'), ['mini', 'description', 'what_was_done', 'result'])
const halfZh = { ...full, zh: { ...full.zh, result: '' } }
check('нет только zh результата - берём result', fieldsToTranslate(src, halfZh, 'missing'), ['result'])
check('пустое русское поле не просят', fieldsToTranslate(sourceFromCase({ ...caseA, description: '   ', result: '' }), {}, 'missing'), ['mini', 'what_was_done'])

console.log('--- запрос ---')
const req = buildRequest(src, ['mini', 'description', 'what_was_done', 'result'], 'gsk_test')
check('адрес', req.url, 'https://api.groq.com/openai/v1/chat/completions')
check('адрес из константы', GROQ_URL, req.url)
check('ключ в Authorization', req.headers.Authorization, 'Bearer gsk_test')
check('модель без настроек - запасная константа', req.body.model, GROQ_FALLBACK_MODEL)
check('модель из настроек уходит в запрос', buildRequest(src, ['mini'], 'k', 'qwen/qwen3-32b').body.model, 'qwen/qwen3-32b')
check('json-режим', req.body.response_format, { type: 'json_object' })
const userPayload = JSON.parse(req.body.messages[1].content)
check('title не попал в запрос', 'title' in userPayload, false)
check('имя бренда нигде в запросе', JSON.stringify(req.body).includes('BuffBuff'), false)
check('поля в запросе', Object.keys(userPayload), ['mini', 'description', 'what_was_done', 'result'])
const shape = req.body.messages[0].content
truth('в форме ответа нет title', !/"title"/.test(shape.slice(shape.indexOf('Reply with JSON'))))
const emptyReq = buildRequest(sourceFromCase({ ...caseA, description: '', result: '' }), ['mini', 'what_was_done'], 'gsk_x')
check('пустые поля не в запросе', Object.keys(JSON.parse(emptyReq.body.messages[1].content)), ['mini', 'what_was_done'])
check('даже если title передали в fields - вырезается', Object.keys(JSON.parse(buildRequest(src, ['title', 'mini'], 'k').body.messages[1].content)), ['mini'])
check('пустая строка в списке не уходит модели', JSON.parse(buildRequest(sourceFromCase({ ...caseA, result: 'a\n\n  \nb' }), ['result'], 'k').body.messages[1].content).result, 'a\nb')

console.log('--- промпт ---')
const DASH = String.fromCharCode(0x2014) // длинное тире, в файле записано кодом
const sys = buildSystemPrompt(['mini', 'result'])
truth('есть контекст рекламы у блогеров', /influencer/i.test(SYSTEM_BASE) && /bloggers?/i.test(SYSTEM_BASE) && /advertis/i.test(SYSTEM_BASE))
truth('есть уточнение про термины (интеграция/пополнение/брендинг)', /интеграци/i.test(SYSTEM_BASE) && /пополнение/i.test(SYSTEM_BASE) && /брендинг/i.test(SYSTEM_BASE))
truth('число строк в списках сохраняется - сказано в промпте', /exactly the same number of lines/.test(SYSTEM_BASE))
truth('в форме ответа только запрошенные поля', sys.includes('"mini"') && sys.includes('"result"') && !sys.includes('"description"'))
truth('в промпте нет длинных тире', !sys.includes(DASH) && !SYSTEM_BASE.includes(DASH))

console.log('--- разбор ответа ---')
const reply = {
  en: { mini: '23.5M+ views', description: 'Integration on the channel', what_was_done: 'Branding placed\nBalance top-up', result: 'Reach 1M\nClicks 5000' },
  zh: { mini: '2350万+ 观看次数', description: '频道内植入', what_was_done: '展示品牌\n余额充值', result: '覆盖100万\n点击5000' },
}
const f4 = ['mini', 'description', 'what_was_done', 'result']
const parsed = parseGroqReply({ choices: [{ message: { content: JSON.stringify(reply) } }] }, src, f4)
check('en результат', parsed.en.what_was_done, 'Branding placed\nBalance top-up')
check('zh mini', parsed.zh.mini, '2350万+ 观看次数')
check('предупреждений нет', parsed.warnings, [])
const fenced = parseGroqReply({ choices: [{ message: { content: '```json\n' + JSON.stringify(reply) + '\n```' } }] }, src, f4)
check('обёртка в ```json разбирается', fenced.en.mini, '23.5M+ views')
const asArray = parseGroqReply({ choices: [{ message: { content: JSON.stringify({ en: { ...reply.en, result: ['Reach 1M', 'Clicks 5000'] }, zh: reply.zh }) } }] }, src, f4)
check('список массивом склеивается переносами', asArray.en.result, 'Reach 1M\nClicks 5000')
const wrongLines = parseGroqReply({ choices: [{ message: { content: JSON.stringify({ en: { ...reply.en, result: 'Reach 1M' }, zh: reply.zh }) } }] }, src, f4)
check('несовпавшее число строк: поле отброшено', 'result' in wrongLines.en, false)
check('несовпавшее число строк: предупреждение', wrongLines.warnings.length, 1)
check('остальные поля живы', wrongLines.en.mini, '23.5M+ views')
check('zh при этом цел', wrongLines.zh.result, '覆盖100万\n点击5000')
const noTitle = parseGroqReply({ choices: [{ message: { content: JSON.stringify({ en: { ...reply.en, title: '增益增益' }, zh: reply.zh }) } }] }, src, f4)
check('title от модели игнорируется', 'title' in noTitle.en, false)
const emptyAns = parseGroqReply({ choices: [{ message: { content: JSON.stringify({ en: { ...reply.en, mini: '  ' }, zh: reply.zh }) } }] }, src, f4)
check('пустой ответ по полю не считается переводом', 'mini' in emptyAns.en, false)
for (const [label, rep] of [
  ['битый JSON', { choices: [{ message: { content: '{"en": {oops' } }] }],
  ['не объект', { choices: [{ message: { content: '[1,2]' } }] }],
  ['нет choices', {}],
  ['нет en/zh', { choices: [{ message: { content: '{"x":1}' } }] }],
]) {
  let err = null
  try { parseGroqReply(rep, src, f4) } catch (e) { err = e }
  truth(`${label}: GroqError kind=parse`, err instanceof GroqError && err.kind === 'parse')
}

console.log('--- тексты ошибок ---')
const t401 = groqErrorText(401), t403 = groqErrorText(403), t429 = groqErrorText(429)
truth('401 про ключ', /ключ/i.test(t401) && t401.includes('401'))
truth('429 про лимит', /лимит/i.test(t429) && t429.includes('429'))
truth('403 про блокировку', /заблок/i.test(t403) && t403.includes('403'))
truth('три текста разные', new Set([t401, t403, t429]).size === 3)
truth('500 - временная недоступность', /недоступен/i.test(groqErrorText(503)))
truth('400 про модель', /модел/i.test(groqErrorText(400, '{"error":{"message":"The model `x` does not exist"}}')))
truth('прочее - с кодом', groqErrorText(418).includes('418'))
const t404 = groqErrorText(404, '{"error":{"message":"The model `old-model` does not exist"}}', 'old-model')
truth('404 про модель называет модель и код', t404.includes('old-model') && t404.includes('404'))
truth('404 про модель советует выбрать другую в списке', /выберите другую модель/i.test(t404))
truth('404 про модель не требует обновлять приложение', !/нужно обновить приложение/i.test(t404) && /не нужно/i.test(t404))
truth('в текстах ошибок нет длинных тире', !t404.includes(String.fromCharCode(0x2014)))

console.log('--- список моделей ---')
const modelsReply = {
  object: 'list',
  data: [
    { id: 'whisper-large-v3', active: true },
    { id: 'whisper-large-v3-turbo', active: true },
    { id: 'llama-3.1-8b-instant', active: true },
    { id: 'meta-llama/llama-guard-4-12b', active: true },
    { id: 'meta-llama/llama-prompt-guard-2-86m', active: true },
    { id: 'openai/gpt-oss-safeguard-20b', active: true },
    { id: 'llama-3.3-70b-versatile', active: true },
    { id: 'playai-tts', active: true },
    { id: 'compound-beta', active: true },
    { id: 'text-embedding-3', active: true },
    { id: 'qwen/qwen3-32b', active: true },
    { id: 'old-dead-70b', active: false },
    { id: 'llama-3.1-8b-instant', active: true },
    { id: 123 },
    null,
  ],
}
check('фильтр: whisper, embedding, guard, tts, compound, неактивные и дубли убраны, крупные первыми',
  parseModelsReply(modelsReply), ['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'llama-3.1-8b-instant'])
check('мусор вместо ответа - пустой список', [parseModelsReply(null), parseModelsReply({}), parseModelsReply({ data: 'x' })], [[], [], []])
truth('isChatModel: whisper нет, llama да', !isChatModel('whisper-large-v3') && isChatModel('llama-3.3-70b-versatile') && !isChatModel(''))
check('при равном размере - по алфавиту', parseModelsReply({ data: [{ id: 'b-8b' }, { id: 'a-8b' }] }), ['a-8b', 'b-8b'])

console.log('--- выбор модели ---')
const avail = ['llama-3.3-70b-versatile', 'qwen/qwen3-32b']
check('не выбрана - первая из списка', resolveModel('', avail), 'llama-3.3-70b-versatile')
check('выбрана из списка - она', resolveModel('qwen/qwen3-32b', avail), 'qwen/qwen3-32b')
check('выбранной уже нет в списке - первая из списка', resolveModel('old-model', avail), 'llama-3.3-70b-versatile')
check('список пуст, введено руками - как введено', resolveModel('  my-model ', []), 'my-model')
check('список пуст и ничего не введено - запасная константа', resolveModel('', []), GROQ_FALLBACK_MODEL)

console.log('--- запрос списка моделей ---')
const mf = fakeFetch({ ok: true, status: 200, json: async () => modelsReply, text: async () => '' })
const got = await fetchGroqModels('gsk_k', mf)
check('адрес и метод', [mf.calls[0].url, mf.calls[0].init.method], [GROQ_MODELS_URL, 'GET'])
check('адрес списка моделей', GROQ_MODELS_URL, 'https://api.groq.com/openai/v1/models')
check('ключ в Authorization', mf.calls[0].init.headers.Authorization, 'Bearer gsk_k')
check('список отфильтрован', got, ['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'llama-3.1-8b-instant'])
let mErr = null
try { await fetchGroqModels('k', fakeFetch(bad(401))) } catch (e) { mErr = e }
truth('401 на списке -> GroqError auth', mErr instanceof GroqError && mErr.kind === 'auth')
mErr = null
try { await fetchGroqModels('k', fakeFetch(new TypeError('Failed to fetch'))) } catch (e) { mErr = e }
truth('обрыв сети на списке -> network', mErr instanceof GroqError && mErr.kind === 'network')

console.log('--- запрос целиком ---')
const f1 = fakeFetch(ok(reply))
const res = await translateWithGroq({ source: src, fields: f4, key: 'gsk_k', fetchImpl: f1 })
check('один запрос на кейс', f1.calls.length, 1)
check('перевод получен', res.zh.description, '频道内植入')
const f0 = fakeFetch(ok(reply))
const none = await translateWithGroq({ source: sourceFromCase({ title: 'X', site_mini: '', description: '', what_was_done: '', result: '' }), fields: [], key: 'k', fetchImpl: f0 })
check('нечего переводить - запроса нет', f0.calls.length, 0)
check('нечего переводить - пустой результат', none, { en: {}, zh: {}, warnings: [] })
for (const [status, kind] of [[401, 'auth'], [403, 'forbidden'], [429, 'rate'], [503, 'server']]) {
  let err = null
  try { await translateWithGroq({ source: src, fields: f4, key: 'k', fetchImpl: fakeFetch(bad(status)) }) } catch (e) { err = e }
  truth(`HTTP ${status} -> ${kind}`, err instanceof GroqError && err.kind === kind && err.message === groqErrorText(status))
}
let netErr = null
try { await translateWithGroq({ source: src, fields: f4, key: 'k', fetchImpl: fakeFetch(new TypeError('Failed to fetch')) }) } catch (e) { netErr = e }
truth('обрыв сети -> kind=network с понятным текстом', netErr instanceof GroqError && netErr.kind === 'network' && /связи/i.test(netErr.message))

const fm = fakeFetch(ok(reply))
await translateWithGroq({ source: src, fields: f4, key: 'k', model: 'qwen/qwen3-32b', fetchImpl: fm })
check('перевод идёт с моделью из настроек', fm.calls[0].body.model, 'qwen/qwen3-32b')
let m404 = null
try { await translateWithGroq({ source: src, fields: f4, key: 'k', model: 'old-model', fetchImpl: fakeFetch(bad(404, '{"error":{"message":"The model `old-model` does not exist"}}')) }) } catch (e) { m404 = e }
truth('404 про модель -> kind=model', m404 instanceof GroqError && m404.kind === 'model')
truth('404 про модель: в тексте id модели и совет выбрать другую', m404 && m404.message.includes('old-model') && /выберите другую модель/i.test(m404.message))

console.log('--- слияние с готовыми переводами ---')
const fresh = { en: { mini: 'NEW', description: 'NEW', what_was_done: 'NEW', result: 'NEW' }, zh: { mini: 'NEW', description: 'NEW', what_was_done: 'NEW', result: 'NEW' } }
const old = { en: { title: 'BuffBuff', mini: 'old', description: '', what_was_done: 'old', result: 'old' }, zh: {} }
const mMissing = mergeTranslations(old, src, fresh, 'missing')
check('недостающее: готовое не трогаем', mMissing.en.mini, 'old')
check('недостающее: пустое заполняем', mMissing.en.description, 'NEW')
check('недостающее: zh заполнен целиком', mMissing.zh.result, 'NEW')
const mAll = mergeTranslations(old, src, fresh, 'all')
check('заново: готовое заменено', mAll.en.mini, 'NEW')
check('title = русское название на обоих языках', [mAll.en.title, mAll.zh.title], ['BuffBuff', 'BuffBuff'])
check('ручной перевод title сохраняется', mergeTranslations({ en: { title: 'Buff Buff' } }, src, fresh, 'all').en.title, 'Buff Buff')
check('пустой ответ по полю не стирает старый перевод', mergeTranslations(old, src, { en: {}, zh: {} }, 'all').en.mini, 'old')
check('все пять полей в обоих языках', [Object.keys(mAll.en).length, Object.keys(mAll.zh).length], [5, 5])

console.log('--- ключ ---')
check('обрезка пробелов и кавычек', normalizeKey('  "gsk_abc123"  '), 'gsk_abc123')
check('кириллица в ключе отсекается', normalizeKey('gsk_абв'), '')
check('пустой ключ', normalizeKey('   '), '')
truth('gsk_ - похоже на ключ Groq', looksLikeGroqKey('gsk_abc'))
truth('произвольная строка - не похожа', !looksLikeGroqKey('sk-abc'))

console.log('--- пакетный прогон ---')
const mk = (id, over = {}) => ({ id, source: sourceFromCase({ ...caseA, ...over }), translations: {} })
const saved = []
const save = async (id, tr) => { saved.push([id, tr]) }
const progress = []

const okBatch = fakeFetch(ok(reply))
const b1 = await translateBatch([mk(1), mk(2), mk(3, { description: '', what_was_done: '', result: '', site_mini: '' })], 'k', 'missing', {
  fetchImpl: okBatch, save, onProgress: (done, total) => progress.push([done, total]),
})
check('кейс без текста не берётся в план', okBatch.calls.length, 2)
check('переведено 2', b1.translated, 2)
check('прогресс N из M', progress, [[0, 2], [1, 2], [2, 2]])
check('сохранено двумя вызовами', saved.map(s => s[0]), [1, 2])
check('сохранённый перевод полный', saved[0][1].zh.title, 'BuffBuff')

saved.length = 0
const mixed = fakeFetch(ok(reply), ok('{"en": broken'), ok(reply))
const b2 = await translateBatch([mk(1), mk(2), mk(3)], 'k', 'missing', { fetchImpl: mixed, save })
check('битый ответ в одном кейсе не роняет остальные', [b2.translated, b2.failed.length, b2.fatal], [2, 1, null])
check('упал кейс 2', b2.failed[0].id, 2)
check('кейсы 1 и 3 сохранены', saved.map(s => s[0]), [1, 3])

saved.length = 0
const auth = fakeFetch(ok(reply), bad(401))
const b3 = await translateBatch([mk(1), mk(2), mk(3)], 'k', 'missing', { fetchImpl: auth, save })
check('401 останавливает прогон', [b3.translated, auth.calls.length], [1, 2])
check('fatal с понятным текстом', b3.fatal, groqErrorText(401))
check('то что успело - сохранено', saved.map(s => s[0]), [1])

const modelBatch = fakeFetch(bad(404, 'model not found'))
const b3m = await translateBatch([mk(1), mk(2)], 'k', 'missing', { fetchImpl: modelBatch, save, model: 'old-model' })
check('404 про модель останавливает прогон, kind передаётся', [modelBatch.calls.length, b3m.fatalKind], [1, 'model'])
check('в запросах прогона модель из настроек', modelBatch.calls[0].body.model, 'old-model')

const rate = fakeFetch(bad(429))
const b4 = await translateBatch([mk(1), mk(2)], 'k', 'missing', { fetchImpl: rate, save })
check('429 останавливает прогон', [rate.calls.length, b4.fatal], [1, groqErrorText(429)])

let stopAfter = 0
const stopper = fakeFetch(ok(reply))
const b5 = await translateBatch([mk(1), mk(2), mk(3)], 'k', 'missing', { fetchImpl: stopper, save, shouldStop: () => stopAfter++ >= 1 })
check('кнопка "стоп" прерывает между кейсами', [b5.translated, b5.stopped], [1, true])

const withDone = { ...mk(1), translations: full }
const b6 = await translateBatch([withDone], 'k', 'missing', { fetchImpl: fakeFetch(ok(reply)), save })
check('недостающего нет - ничего не делаем', [b6.translated, b6.total], [0, 0])
const b7 = await translateBatch([withDone], 'k', 'all', { fetchImpl: fakeFetch(ok(reply)), save })
check('"заново" переводит и готовое', [b7.translated, b7.total], [1, 1])

const saveFail = async () => { throw new Error('500') }
const b8 = await translateBatch([mk(1), mk(2)], 'k', 'missing', { fetchImpl: fakeFetch(ok(reply)), save: saveFail })
check('ошибка сохранения на сервер: кейс в failed, прогон идёт дальше', [b8.translated, b8.failed.length], [0, 2])


// --- числа приводятся к единому виду, модель это делает через раз ---
check('zh: 34к+ -> 3.4万+', localizeNumbers('34к+ просмотров', 'zh'), '3.4万+ просмотров')
check('zh: 22к+ -> 2.2万+', localizeNumbers('22к+ просмотров', 'zh'), '2.2万+ просмотров')
check('zh: латинская k тоже ловится', localizeNumbers('22k+ 观看次数', 'zh'), '2.2万+ 观看次数')
check('zh: 1,9 млн -> 190万', localizeNumbers('1,9 млн+ просмотров', 'zh'), '190万+ просмотров')
check('zh: 10к -> 1万 без дроби', localizeNumbers('10к', 'zh'), '1万')
check('en: 34к+ -> 34k+', localizeNumbers('34к+ просмотров', 'en'), '34k+ просмотров')
check('en: 1,9 млн -> 1.9M', localizeNumbers('1,9 млн', 'en'), '1.9M')
check('точка от сокращения не остаётся', localizeNumbers('Более 34 тыс. просмотров', 'en'), 'Более 34k просмотров')
check('текст без чисел не меняется', localizeNumbers('Top Nimo.tv', 'zh'), 'Top Nimo.tv')
check('пустая строка', localizeNumbers('', 'zh'), '')

// числа чинятся и в разобранном ответе модели
const numReply = JSON.stringify({ en: { mini: '22k+ views' }, zh: { mini: '22k+ 观看次数' } })
const numSrc = sourceFromCase({ title: 'X', site_mini: '22к+ просмотров', description: '', what_was_done: '', result: '' })
const numOut = await translateWithGroq({ source: numSrc, fields: ['mini'], key: 'k', fetchImpl: fakeFetch(ok(numReply)) })
check('ответ модели с латинской k исправлен на 万', numOut.zh.mini, '2.2万+ 观看次数')

// --- модель иногда возвращает обрезок: "3.4万+" вместо "3.4万+ 观看次数" ---
const cutReply = JSON.stringify({ en: { mini: '34k+' }, zh: { mini: '3.4万+' } })
const cutSrc = sourceFromCase({ title: 'X', site_mini: '34к+ просмотров', description: '', what_was_done: '', result: '' })
const cutOut = await translateWithGroq({ source: cutSrc, fields: ['mini'], key: 'k', fetchImpl: fakeFetch(ok(cutReply)) })
check('обрезанный перевод не принимается', cutOut.zh.mini, undefined)
check('и про это есть предупреждение', cutOut.warnings.length > 0, true)

// а нормально укороченный перевод принимается: иероглифы короче русского
const shortReply = JSON.stringify({ en: { description: 'Channel integration' }, zh: { description: '频道广告合作' } })
const shortSrc = sourceFromCase({ title: 'X', site_mini: '', description: 'Интеграция на канале', what_was_done: '', result: '' })
const shortOut = await translateWithGroq({ source: shortSrc, fields: ['description'], key: 'k', fetchImpl: fakeFetch(ok(shortReply)) })
check('короткий китайский перевод принимается', shortOut.zh.description, '频道广告合作')

console.log(failed ? `\n${failed} провалов` : '\nвсё зелёное')
process.exit(failed ? 1 : 0)
