// Проверка логики горячих задач по сделкам и ссылок на модалку блогера в кампании.
// Запуск: node --experimental-strip-types scripts\check_alerts.mjs
import { buildDealGroups, isIntegrationDone } from '../frontend/src/utils/alerts.ts'
import { campaignBloggerLink, parseBloggerLink } from '../frontend/src/utils/dealLinks.ts'

let failed = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} (получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)})`)
}

// фиксированное "сейчас", чтобы прогон не зависел от даты запуска
const NOW = new Date('2026-06-15T12:00:00')
const day = offset => {
  const d = new Date(NOW)
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

// минимальная строка сделки; всё лишнее нейтральное
let nextId = 1
const row = (over = {}) => ({
  id: nextId++,
  brand: 'Бренд',
  streamer_name: 'Блогер',
  campaign_id: 7,
  stage: 'agreed',
  content_status: null,
  amount: 1000,
  deadline: null,
  integration_date: null,
  contract_status: 'not_sent',
  contract_sent_date: null,
  contract_valid_until: null,
  payment_status: 'not_invoiced',
  ord_responsible: 'not_required',
  ord_status: 'done',
  ord_reporting_status: 'submitted',
  has_case: false,
  ...over,
})

const opts = { now: NOW, casesEnabled: true, draftAlertsEnabled: true }
const groupItems = (rows, key, o = opts) => buildDealGroups(rows, o).find(g => g.key === key)?.items.map(i => i.id) ?? []

console.log('--- признак "интеграция сделана" ---')
check('стадия done', isIntegrationDone(row({ stage: 'done' }), NOW), true)
check('контент снят (filmed)', isIntegrationDone(row({ content_status: 'filmed' }), NOW), true)
check('дата выхода вчера', isIntegrationDone(row({ integration_date: day(-1) }), NOW), true)
check('дата выхода сегодня - ещё не сделана', isIntegrationDone(row({ integration_date: day(0) }), NOW), false)
check('дата выхода в будущем', isIntegrationDone(row({ integration_date: day(5) }), NOW), false)
check('в работе (filming)', isIntegrationDone(row({ content_status: 'filming' }), NOW), false)
check('ничего не заполнено', isIntegrationDone(row(), NOW), false)

console.log('--- договор истёк ---')
const expiredNotDone = row({ contract_valid_until: day(-3) })
const expiredDone = row({ contract_valid_until: day(-3), integration_date: day(-1) })
const expiredFilmed = row({ contract_valid_until: day(-3), content_status: 'filmed' })
const expiredStageDone = row({ contract_valid_until: day(-3), stage: 'done' })
const expiredCancelled = row({ contract_valid_until: day(-3), stage: 'cancelled' })
const all1 = [expiredNotDone, expiredDone, expiredFilmed, expiredStageDone, expiredCancelled]
check('не сделана - показываем, остальные нет', groupItems(all1, 'contractExpired'), [expiredNotDone.id])

console.log('--- договор истекает в течение недели ---')
const soonNotDone = row({ contract_valid_until: day(3) })
const soonDone = row({ contract_valid_until: day(3), integration_date: day(-2) })
const soonFilmed = row({ contract_valid_until: day(3), content_status: 'filmed' })
const soonLate = row({ contract_valid_until: day(9) })
check('не сделана - показываем', groupItems([soonNotDone, soonDone, soonFilmed, soonLate], 'contractExpiring'), [soonNotDone.id])

console.log('--- сделки вне кампании ---')
const orphan = row({ campaign_id: null, deadline: day(-2), contract_valid_until: day(-1), stage: 'negotiation', amount: null })
const orphanUndef = row({ campaign_id: undefined, deadline: day(-2) })
const inCamp = row({ deadline: day(-2) })
const rows2 = [orphan, orphanUndef, inCamp]
for (const key of ['deadlineOverdue', 'contractExpired', 'drafts']) {
  check(`${key}: сделка без кампании скрыта`, groupItems(rows2, key).includes(orphan.id) || groupItems(rows2, key).includes(orphanUndef.id), false)
}
check('сделка в кампании остаётся', groupItems(rows2, 'deadlineOverdue'), [inCamp.id])
check('все группы пусты для одних сделок без кампании', buildDealGroups([orphan, orphanUndef], opts).every(g => g.items.length === 0), true)

console.log('--- черновики и флаг пространства ---')
const draft = row({ stage: 'negotiation', amount: null })
check('флаг включён - черновик виден', groupItems([draft], 'drafts'), [draft.id])
check('флаг выключен - черновика нет', groupItems([draft], 'drafts', { ...opts, draftAlertsEnabled: false }), [])
check('флаг не пришёл (undefined) - черновик виден', groupItems([draft], 'drafts', { ...opts, draftAlertsEnabled: undefined }), [draft.id])
check('другие группы флаг черновиков не трогает', groupItems([row({ deadline: day(-1) })], 'deadlineOverdue', { ...opts, draftAlertsEnabled: false }).length, 1)

console.log('--- кейсы ---')
const noCase = row({ stage: 'done' })
check('кейсы включены - напоминание есть', groupItems([noCase], 'caseMissing'), [noCase.id])
check('кейсы выключены - напоминания нет', groupItems([noCase], 'caseMissing', { ...opts, casesEnabled: false }), [])

console.log('--- оставленные группы работают как раньше ---')
const dl = row({ deadline: day(2) })
check('дедлайн через 1-3 дня', groupItems([dl], 'deadlineSoon'), [dl.id])
const contractOld = row({ contract_status: 'sent_to_streamer', contract_sent_date: day(-6) })
check('договор > 5 дней без ответа', groupItems([contractOld], 'contractOverdue'), [contractOld.id])
const pay = row({ payment_status: 'invoiced', deadline: day(-1) })
check('оплата просрочена', groupItems([pay], 'paymentOverdue'), [pay.id])
const ord = row({ ord_responsible: 'us', ord_status: 'todo', integration_date: day(1) })
check('маркировка не готова', groupItems([ord], 'ordTodo'), [ord.id])

console.log('--- ссылка ведёт в кампанию, не на канбан ---')
const it = buildDealGroups([dl], opts).find(g => g.key === 'deadlineSoon').items[0]
check('to алерта', it.to, `/campaigns?blogger=${dl.id}&campaign=7`)
check('ссылка не содержит /integrations', it.to.includes('/integrations'), false)
check('campaignBloggerLink', campaignBloggerLink(5, 42), '/campaigns?blogger=42&campaign=5')
check('parseBloggerLink', parseBloggerLink('?blogger=42&campaign=5'), { streamerId: 42, campaignId: 5 })
check('parseBloggerLink без campaign', parseBloggerLink('?blogger=42'), null)
check('parseBloggerLink мусор', parseBloggerLink('?blogger=abc&campaign=5'), null)
check('parseBloggerLink пусто', parseBloggerLink(''), null)

console.log(failed ? `\n${failed} провалов` : '\nвсё зелёное')
process.exit(failed ? 1 : 0)
