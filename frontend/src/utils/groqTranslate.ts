// Перевод кейсов ru -> en, zh прямо из браузера через Groq. Чистая логика без React,
// чтобы проверять её скриптом scripts/check_groq_translate.mjs.
//
// Почему из браузера: с прод-сервера Groq отвечает 403 (блокирует его IP), а с компьютера
// пользователя доступен и разрешает CORS. Google/MyMemory на сервере остаются запасными для
// автопубликации, но переводят машинно и путают термины рекламы.
//
// ВАЖНО: ключ Groq вводит пользователь и хранит в localStorage этого браузера. НА НАШ СЕРВЕР
// КЛЮЧ НЕ ОТПРАВЛЯЕТСЯ НИКОГДА: настройки сервера общие, их видят коллеги из других пространств.
// На сервер уходит только готовый перевод (PATCH /integrations/cases/{id}, поле translations).

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
export const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models'
// ТОЛЬКО запасной путь на случай, когда список моделей получить не удалось и пользователь ничего не выбрал.
// Набор моделей у Groq меняется, id может протухнуть (так уже было): основной выбор идёт из списка с сервера Groq.
export const GROQ_FALLBACK_MODEL = 'llama-3.3-70b-versatile'
// запрос списка моделей лёгкий, 15 секунд с запасом
export const GROQ_MODELS_TIMEOUT_MS = 15000
// один запрос обычно 1-3 секунды; 40 с с запасом на загруженный Groq
export const GROQ_TIMEOUT_MS = 40000

export type CaseField = 'title' | 'mini' | 'description' | 'what_was_done' | 'result'
export type TranslatableField = Exclude<CaseField, 'title'>
export type Lang = 'en' | 'zh'
export type Mode = 'missing' | 'all'

export type CaseSource = Record<CaseField, string>
// то, что вернула модель: только запрошенные поля, пустое не включается
export type FreshTranslations = Record<Lang, Partial<Record<TranslatableField, string>>>
export type FullTranslations = Record<Lang, Record<CaseField, string>>
// то, что лежит в CaseStudy.translations (может быть неполным)
export type StoredTranslations = Partial<Record<Lang, Partial<Record<CaseField, string>>>>

export const LANGS: Lang[] = ['en', 'zh']
export const ALL_FIELDS: CaseField[] = ['title', 'mini', 'description', 'what_was_done', 'result']
// поля-списки: один пункт на строку, при переводе число строк должно сохраниться
export const LIST_FIELDS: CaseField[] = ['what_was_done', 'result']
// название кейса - имя бренда или проекта, его не переводят и модели не отправляют
// ("BuffBuff" превращался в китайское 增益增益); совпадает с KEEP_AS_IS_FIELDS в backend/case_translate.py
export const KEEP_AS_IS_FIELDS: CaseField[] = ['title']

// Промпт перенесён из backend/case_translate.py (SYSTEM) и дополнен контекстом рекламы у блогеров:
// именно его отсутствие даёт плохой машинный перевод ("Интеграция на канале" -> "интеграция каналов продаж")
export const SYSTEM_BASE =
  'You translate influencer-marketing case studies for a portfolio website from Russian into ' +
  'English (en) and Simplified Chinese (zh). Keep the tone concise and professional. Keep brand, game, ' +
  'streamer and blogger names as they are (do not translate nicknames). Convert number formats naturally, ' +
  'e.g. "23,5 млн+ просмотров" -> "23.5M+ views" / "2350万+ 观看次数". Fields what_was_done and result ' +
  'are lists: one item per line - keep exactly the same number of lines and their order. Empty source ' +
  'fields stay empty.\n' +
  'Context: the texts are written by an advertising agency that places ads with streamers and bloggers ' +
  '(Twitch, YouTube, Telegram, VK). Use influencer-marketing and advertising terminology, not general or ' +
  'trade vocabulary. Glossary: "интеграция" / "рекламная интеграция" = sponsored integration (a paid ad ' +
  'placement inside a streamer\'s or blogger\'s content), NOT integration of sales channels; "интеграция на ' +
  'канале" = a sponsored integration on the creator\'s channel; "размещён брендинг" = brand placement / ' +
  'branding shown on stream or in the video; "пополнение" (games, apps) = account balance top-up / deposit, ' +
  'NOT military supplies; "охват" = reach; "просмотры" = views; "стример" = streamer; "блогер" = blogger; ' +
  '"спецпроект" = special project; "эфир" / "стрим" = live stream; "промокод" = promo code. ' +
  'Keep URLs, emails, @nicknames and erid markers exactly as in the source.\n'

// Форма ответа строится под запрошенные поля: title модели не отдаём вообще
export function buildSystemPrompt(fields: TranslatableField[]): string {
  const part = JSON.stringify(Object.fromEntries(fields.map(f => [f, ''])))
  return `${SYSTEM_BASE}Reply with JSON only, exactly this shape: {"en": ${part}, "zh": ${part}}`
}

// Ошибка Groq с видом, по которому решаем, продолжать ли пакетный прогон
export type GroqErrorKind =
  | 'auth' | 'forbidden' | 'rate' | 'model' | 'server' | 'http' | 'network' | 'timeout' | 'parse'

export class GroqError extends Error {
  kind: GroqErrorKind
  status: number
  constructor(kind: GroqErrorKind, message: string, status = 0) {
    super(message)
    this.name = 'GroqError'
    this.kind = kind
    this.status = status
  }
}

// После этих ошибок остальные кейсы пойдут так же плохо, прогон останавливаем
const FATAL_KINDS: GroqErrorKind[] = ['auth', 'forbidden', 'rate', 'model', 'network']

// Понятный текст по коду ответа Groq. model - id модели из запроса, чтобы назвать её в тексте
export function groqErrorText(status: number, body = '', model = ''): string {
  if (status === 401) return 'Groq не принял ключ (401): проверьте ключ, он должен начинаться с gsk_'
  if (status === 403) return 'Groq ответил 403: доступ с вашего адреса заблокирован. Попробуйте другую сеть или VPN'
  if (status === 429) return 'Лимит бесплатного Groq исчерпан (429): подождите минуту и повторите'
  if ((status === 400 || status === 404) && /model/i.test(body)) {
    const name = model ? ` ${model}` : ''
    return `Groq не принял модель${name} (${status}): её нет в вашем аккаунте или она отключена. Выберите другую модель в списке «Модель» рядом, обновлять приложение не нужно`
  }
  if (status >= 500) return `Groq временно недоступен (${status}): повторите через минуту`
  return `Groq ответил ошибкой ${status}`
}

// Ключ из поля ввода: без пробелов и кавычек; с не-ASCII символами fetch упадёт на заголовке, такой отсекаем
export function normalizeKey(raw: string): string {
  const key = (raw || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim()
  return /^[\x21-\x7e]+$/.test(key) ? key : ''
}

export function looksLikeGroqKey(key: string): boolean {
  return key.startsWith('gsk_')
}

type CaseLike = {
  title?: string | null
  site_mini?: string | null
  description?: string | null
  what_was_done?: string | null
  result?: string | null
}

// Русские тексты кейса в формате перевода (site_mini на карточке называется mini)
export function sourceFromCase(c: CaseLike): CaseSource {
  return {
    title: c.title ?? '',
    mini: c.site_mini ?? '',
    description: c.description ?? '',
    what_was_done: c.what_was_done ?? '',
    result: c.result ?? '',
  }
}

// Непустые строки списка: пункты без пустых строк между ними
function listLines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean)
}

// Значение поля так, как оно уходит модели: у списков вычищены пустые строки
function sourceValue(source: CaseSource, f: CaseField): string {
  const v = source[f] ?? ''
  return LIST_FIELDS.includes(f) ? listLines(v).join('\n') : v.trim()
}

function isTranslatable(f: CaseField): f is TranslatableField {
  return !KEEP_AS_IS_FIELDS.includes(f)
}

// Какие поля отправлять в Groq. missing: русский текст есть, а перевода хотя бы на один язык нет.
// all: все поля с русским текстом (перевести заново поверх готового)
export function fieldsToTranslate(source: CaseSource, translations: StoredTranslations, mode: Mode): TranslatableField[] {
  return ALL_FIELDS.filter(isTranslatable).filter(f => {
    if (!sourceValue(source, f)) return false
    if (mode === 'all') return true
    return LANGS.some(l => !(translations?.[l]?.[f] ?? '').trim())
  })
}

// Запрос к Groq: адрес, заголовки и тело. title и пустые поля сюда не попадают.
export function buildRequest(source: CaseSource, fields: CaseField[], key: string, model = GROQ_FALLBACK_MODEL) {
  const wanted = fields.filter(isTranslatable).filter(f => sourceValue(source, f))
  const payload = Object.fromEntries(wanted.map(f => [f, sourceValue(source, f)]))
  return {
    url: GROQ_URL,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(wanted) },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    },
  }
}

// Модель иногда отдаёт пункты списком вместо строки через перенос (как _as_text на бэке)
function asText(v: unknown): string {
  if (Array.isArray(v)) return v.map(x => String(x)).join('\n')
  return v == null ? '' : String(v)
}

const PARSE_FAIL = 'Не удалось разобрать перевод от Groq, попробуйте ещё раз'

// Разбор ответа Groq в {en, zh}. Битый ответ - GroqError('parse'). Поле, где у списка не совпало
// число строк, отбрасывается с предупреждением (лучше русский оригинал, чем сдвинутые пункты).
export function parseGroqReply(reply: unknown, source: CaseSource, fields: CaseField[]): FreshTranslations & { warnings: string[] } {
  let content: unknown
  try {
    content = (reply as { choices: { message: { content: unknown } }[] }).choices[0].message.content
  } catch {
    throw new GroqError('parse', PARSE_FAIL)
  }
  if (typeof content !== 'string') throw new GroqError('parse', PARSE_FAIL)
  // модель может обернуть JSON в ```json ... ```
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new GroqError('parse', PARSE_FAIL)
  }
  const obj = data as Record<string, unknown>
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!isObj(data) || !LANGS.some(l => isObj(obj[l]))) throw new GroqError('parse', PARSE_FAIL)

  const out: FreshTranslations = { en: {}, zh: {} }
  const warnings: string[] = []
  const wanted = fields.filter(isTranslatable)
  for (const lang of LANGS) {
    const part = isObj(obj[lang]) ? (obj[lang] as Record<string, unknown>) : {}
    for (const f of wanted) {
      let value = asText(part[f]).trim()
      if (!value) continue
      if (LIST_FIELDS.includes(f)) {
        const got = listLines(value)
        const want = listLines(sourceValue(source, f)).length
        if (got.length !== want) {
          warnings.push(`Поле «${f}» (${lang.toUpperCase()}): модель вернула строк ${got.length} вместо ${want}, поле пропущено`)
          continue
        }
        value = got.join('\n')
      }
      // числа приводим сами: в промпте про 万 сказано, но модель это выполняет через раз
      value = localizeNumbers(value, lang)
      if (looksTruncated(sourceValue(source, f), value)) {
        warnings.push(`Поле «${f}» (${lang.toUpperCase()}): модель вернула обрывок «${value}», поле пропущено`)
        continue
      }
      out[lang][f] = value
    }
  }
  return { ...out, warnings }
}

// Числа с сокращениями модель сворачивает как придётся: в одном кейсе выходило
// "3.4万+", в соседнем "22k+". Поэтому приводим их сами, уже после ответа.
// Для en латинские k/M, для zh принятое в китайском 万 (десять тысяч).
const NUM_RE = /(\d+(?:[.,]\d+)?)\s*(млн\.?|тыс\.?|[кk])(?![\w.])/gi
const NUM_MULT: Record<string, number> = { 'млн': 1e6, 'тыс': 1e3, 'к': 1e3, 'k': 1e3 }

function fmtNum(value: number): string {
  // 4.0 -> "4", 3.4 -> "3.4": хвост .0 в тексте не нужен
  return value % 1 ? String(Number(value.toFixed(1))) : String(Math.round(value))
}

/** "34к+" -> "34k+" (en) и "3.4万+" (zh); "1,9 млн" -> "1.9M" и "190万" */
export function localizeNumbers(text: string, lang: Lang): string {
  if (!text) return text
  return text.replace(NUM_RE, (_m, num: string, unit: string) => {
    const amount = Number(num.replace(',', '.'))
    const total = amount * (NUM_MULT[unit.toLowerCase().replace(/\.$/, '')] ?? 1)
    if (!Number.isFinite(total)) return _m
    if (lang === 'zh') return total >= 1e4 ? `${fmtNum(total / 1e4)}万` : fmtNum(total)
    if (total >= 1e6) return `${fmtNum(total / 1e6)}M`
    if (total >= 1e3) return `${fmtNum(total / 1e3)}k`
    return fmtNum(total)
  })
}

/** Похоже ли, что модель вернула обрывок: в оригинале были слова, а в переводе
 *  остались только цифры и знаки. Так вышло с "34к+ просмотров" -> "3.4万+":
 *  слово "просмотры" модель потеряла. Длину в лоб сравнивать нельзя, иероглифы
 *  всегда короче русского. */
export function looksTruncated(source: string, translated: string): boolean {
  if (!source || !translated) return false
  // Своя копия без флага g: у общей NUM_RE он есть, а такой regex помнит позицию
  // между вызовами и со второго раза начинает промахиваться
  const num = /(\d+(?:[.,]\d+)?)\s*(млн\.?|тыс\.?|[кk万])(?![\w.])/gi
  // убираем числа с единицами и знаки, смотрим, осталось ли что-то словесное
  const words = (s: string) => s.replace(num, ' ').replace(/[\d\s+.,:;!?()\-/]+/g, '')
  const srcWords = words(source)
  // в оригинале слов не было (например "34к+") - сравнивать нечего
  if (!srcWords) return false
  return words(translated).length === 0
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

// ---------- Список моделей Groq ----------

// Не chat-модели: распознавание речи, озвучка, эмбеддинги, guard/модерация и составные агенты (compound)
const NON_CHAT_MODEL = /whisper|embed|guard|safeguard|moderation|tts|playai|orpheus|compound|rerank/i

// Подходит ли id для перевода текста (обычная chat-модель)
export function isChatModel(id: string): boolean {
  return !!id && !NON_CHAT_MODEL.test(id)
}

// Размер модели в миллиардах параметров из id ("llama-3.3-70b-versatile" -> 70); неизвестный - 0
function modelSize(id: string): number {
  const m = id.match(/(\d+(?:\.\d+)?)b(?![a-z])/i)
  return m ? parseFloat(m[1]) : 0
}

// Ответ GET /models -> id подходящих chat-моделей. Отключённые (active: false) и дубли выбрасываются.
// Сортировка: крупные модели первыми (для перевода лучше), при равенстве по алфавиту.
// Так первая в списке и есть разумный выбор по умолчанию.
export function parseModelsReply(reply: unknown): string[] {
  const data = (reply as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const ids = new Set<string>()
  for (const m of data) {
    const id = typeof (m as { id?: unknown })?.id === 'string' ? (m as { id: string }).id.trim() : ''
    if ((m as { active?: unknown })?.active === false) continue
    if (isChatModel(id)) ids.add(id)
  }
  return [...ids].sort((a, b) => modelSize(b) - modelSize(a) || a.localeCompare(b))
}

// Какая модель реально уйдёт в запрос. selected - то, что сохранено в настройках.
// Список получен и выбранной в нём нет (модель убрали) - берём первую из списка.
// Список пуст (не загрузился) - выбранная руками как есть, иначе запасная константа.
export function resolveModel(selected: string, available: string[]): string {
  const sel = (selected || '').trim()
  if (available.length > 0) return available.includes(sel) ? sel : available[0]
  return sel || GROQ_FALLBACK_MODEL
}

// Вид ошибки Groq по коду и телу ответа
function errorKind(status: number, body: string): GroqErrorKind {
  return status === 401 ? 'auth'
    : status === 403 ? 'forbidden'
    : status === 429 ? 'rate'
    : (status === 400 || status === 404) && /model/i.test(body) ? 'model'
    : status >= 500 ? 'server'
    : 'http'
}

// Запрос списка моделей, доступных ключу. Ошибки - GroqError с понятным текстом (как при переводе).
export async function fetchGroqModels(key: string, fetchImpl?: FetchLike, timeoutMs = GROQ_MODELS_TIMEOUT_MS): Promise<string[]> {
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await doFetch(GROQ_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal })
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw new GroqError('timeout', 'Groq не ответил со списком моделей, введите id модели руками')
    }
    throw new GroqError('network', 'Нет связи с Groq: проверьте интернет и расширения браузера, блокирующие запросы')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    let body = ''
    try { body = await res.text() } catch { /* тело не нужно */ }
    throw new GroqError(errorKind(res.status, body), groqErrorText(res.status, body), res.status)
  }
  let reply: unknown
  try {
    reply = await res.json()
  } catch {
    throw new GroqError('parse', 'Groq вернул непонятный список моделей, введите id модели руками')
  }
  return parseModelsReply(reply)
}

// Один запрос к Groq: перевод указанных полей кейса на оба языка.
// Нечего переводить (все поля пустые) - запрос не делаем.
export async function translateWithGroq(opts: {
  source: CaseSource
  fields: CaseField[]
  key: string
  model?: string // id модели из настроек; не задан - запасная константа
  fetchImpl?: FetchLike
  timeoutMs?: number
}): Promise<FreshTranslations & { warnings: string[] }> {
  const { source, fields, key } = opts
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const wanted = fields.filter(isTranslatable).filter(f => sourceValue(source, f))
  if (wanted.length === 0) return { en: {}, zh: {}, warnings: [] }

  const req = buildRequest(source, wanted, key, opts.model || GROQ_FALLBACK_MODEL)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? GROQ_TIMEOUT_MS)
  let res
  try {
    res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: ctrl.signal })
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw new GroqError('timeout', 'Groq не ответил за 40 секунд, попробуйте ещё раз')
    }
    throw new GroqError('network', 'Нет связи с Groq: проверьте интернет и расширения браузера, блокирующие запросы')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    let body = ''
    try { body = await res.text() } catch { /* тело не нужно для обычных кодов */ }
    throw new GroqError(errorKind(res.status, body), groqErrorText(res.status, body, req.body.model), res.status)
  }
  let reply: unknown
  try {
    reply = await res.json()
  } catch {
    throw new GroqError('parse', PARSE_FAIL)
  }
  return parseGroqReply(reply, source, wanted)
}

// Слияние свежего перевода с тем, что уже лежит в кейсе. missing: готовые поля не трогаем,
// заполняем только пустые. all: заменяем всё, что модель вернула. Пустой ответ старое не стирает.
// title на обоих языках - русское название (если руками не вписан другой перевод), как на бэке.
export function mergeTranslations(
  existing: StoredTranslations,
  source: CaseSource,
  fresh: FreshTranslations,
  mode: Mode,
): FullTranslations {
  const result = { en: {} as Record<CaseField, string>, zh: {} as Record<CaseField, string> }
  for (const lang of LANGS) {
    for (const f of ALL_FIELDS) {
      const old = existing?.[lang]?.[f] ?? ''
      const next = isTranslatable(f) ? (fresh?.[lang]?.[f] ?? '') : ''
      if (next && (mode === 'all' || !old.trim())) result[lang][f] = next
      else result[lang][f] = old
    }
    if (!result[lang].title.trim()) result[lang].title = source.title
  }
  return result
}

export type BatchItem = { id: number; source: CaseSource; translations: StoredTranslations }
export type BatchResult = {
  total: number // сколько кейсов было в плане
  translated: number
  failed: { id: number; message: string }[]
  warnings: { id: number; text: string }[]
  fatal: string | null // причина остановки всего прогона (ключ, лимит, блокировка)
  fatalKind: GroqErrorKind | null // вид этой ошибки (model - повод заново запросить список моделей)
  stopped: boolean // пользователь нажал «стоп»
}

// Пакетный прогон: кейсы по очереди, каждый сохраняется сразу после перевода (если прогон
// оборвётся на лимите, сделанное не пропадёт). Битый ответ по одному кейсу остальные не роняет;
// ошибки ключа/лимита/блокировки останавливают прогон целиком.
export async function translateBatch(
  items: BatchItem[],
  key: string,
  mode: Mode,
  opts: {
    save: (id: number, translations: FullTranslations) => Promise<unknown>
    model?: string // id модели из настроек
    fetchImpl?: FetchLike
    onProgress?: (done: number, total: number, id: number | null) => void
    shouldStop?: () => boolean
  },
): Promise<BatchResult> {
  const plan = items
    .map(it => ({ ...it, fields: fieldsToTranslate(it.source, it.translations, mode) }))
    .filter(it => it.fields.length > 0)
  const result: BatchResult = { total: plan.length, translated: 0, failed: [], warnings: [], fatal: null, fatalKind: null, stopped: false }
  let done = 0
  opts.onProgress?.(0, plan.length, null)
  for (const it of plan) {
    if (opts.shouldStop?.()) {
      result.stopped = true
      break
    }
    try {
      const fresh = await translateWithGroq({ source: it.source, fields: it.fields, key, model: opts.model, fetchImpl: opts.fetchImpl })
      for (const w of fresh.warnings) result.warnings.push({ id: it.id, text: w })
      try {
        await opts.save(it.id, mergeTranslations(it.translations, it.source, fresh, mode))
      } catch {
        result.failed.push({ id: it.id, message: 'Не удалось сохранить перевод на сервер' })
        done++
        opts.onProgress?.(done, plan.length, it.id)
        continue
      }
      result.translated++
    } catch (e) {
      if (e instanceof GroqError && FATAL_KINDS.includes(e.kind)) {
        result.fatal = e.message
        result.fatalKind = e.kind
        break
      }
      result.failed.push({ id: it.id, message: e instanceof Error ? e.message : 'Не удалось перевести' })
    }
    done++
    opts.onProgress?.(done, plan.length, it.id)
  }
  return result
}
