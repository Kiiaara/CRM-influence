// Логика горячих задач по сделкам блогеров. Вынесена из AlertsPanel, чтобы
// проверять без React: scripts/check_alerts.mjs.
import dayjs from 'dayjs'
import type { Streamer } from '../api/integrations'
import { campaignBloggerLink } from './dealLinks.ts'

export interface AlertItem {
  id: number
  brand: string
  streamer: string
  detail: string
  // куда ведёт строка
  to: string
}

export interface AlertGroup {
  key: string
  title: string
  items: AlertItem[]
}

// строка сделки: инфлюенсер + бренд и кампания из родительской интеграции
export type AlertRow = Streamer & { brand: string; campaign_id: number | null }

export interface DealAlertOptions {
  // "сейчас"; параметром, чтобы проверка не зависела от даты запуска
  now: Date
  // выключен раздел Кейсы - напоминание про кейс не нужно
  casesEnabled: boolean
  // выключены напоминания про черновики в этом пространстве
  draftAlertsEnabled?: boolean
}

// активные стадии - те, где дедлайн/договор/оплата ещё имеют значение
const ACTIVE_STAGES = ['negotiation', 'agreed', 'awaiting_contract', 'awaiting_payment']
const CONTRACT_PENDING = ['sent_to_streamer', 'sent_to_brand']

// Интеграция сделана, если выполнено любое из:
//  - стадия "Завершено";
//  - контент снят (content_status = filmed): работа блогера выполнена, срок договора уже ничего не решает;
//  - дата выхода уже прошла (строго раньше сегодняшнего дня: в день выхода ещё не сделана).
// awaiting_brief и filming не считаем: ТЗ или съёмка в процессе, договор ещё нужен.
export function isIntegrationDone(r: AlertRow, now: Date): boolean {
  if (r.stage === 'done') return true
  if (r.content_status === 'filmed') return true
  if (r.integration_date && dayjs(r.integration_date).startOf('day').isBefore(dayjs(now).startOf('day'))) return true
  return false
}

// Группы алертов по сделкам. Сделки вне кампании не показываем вообще
// (модалка блогера живёт только внутри кампании). Пустые группы тоже возвращаются.
export function buildDealGroups(allRows: AlertRow[], opts: DealAlertOptions): AlertGroup[] {
  const now = dayjs(opts.now)
  const today = now.startOf('day')
  const rows = allRows.filter(r => r.campaign_id != null)

  const toItems = (list: AlertRow[], detail: (r: AlertRow) => string): AlertItem[] =>
    list.map(r => ({
      id: r.id,
      brand: r.brand,
      streamer: r.streamer_name,
      detail: detail(r),
      to: campaignBloggerLink(r.campaign_id as number, r.id),
    }))

  const drafts = opts.draftAlertsEnabled === false
    ? []
    : rows.filter(r => r.stage === 'negotiation' && (r.amount == null || !r.deadline))

  const deadlineSoon = rows.filter(r => {
    if (!r.deadline || !ACTIVE_STAGES.includes(r.stage)) return false
    const diff = dayjs(r.deadline).startOf('day').diff(today, 'day')
    return diff >= 0 && diff <= 3
  })

  const deadlineOverdue = rows.filter(
    r => !!r.deadline && ACTIVE_STAGES.includes(r.stage) && dayjs(r.deadline).startOf('day').isBefore(today)
  )

  const contractOverdue = rows.filter(
    r =>
      CONTRACT_PENDING.includes(r.contract_status) &&
      !!r.contract_sent_date &&
      now.diff(dayjs(r.contract_sent_date), 'day') > 5
  )

  const paymentOverdue = rows.filter(
    r =>
      r.payment_status !== 'paid' &&
      r.payment_status !== 'not_invoiced' &&
      !!r.deadline &&
      r.stage !== 'cancelled' &&
      dayjs(r.deadline).startOf('day').isBefore(today)
  )

  const caseMissing = opts.casesEnabled ? rows.filter(r => r.stage === 'done' && !r.has_case) : []

  // срок договора важен, только пока интеграция не сделана
  const contractExpiring = rows.filter(r => {
    if (!r.contract_valid_until || !ACTIVE_STAGES.includes(r.stage)) return false
    if (isIntegrationDone(r, opts.now)) return false
    const diff = dayjs(r.contract_valid_until).startOf('day').diff(today, 'day')
    return diff >= 0 && diff <= 7
  })

  const contractExpired = rows.filter(
    r =>
      !!r.contract_valid_until &&
      r.stage !== 'cancelled' &&
      !isIntegrationDone(r, opts.now) &&
      dayjs(r.contract_valid_until).startOf('day').isBefore(today)
  )

  // маркировку надо получить до выхода рекламы, иначе штраф
  const ordTodo = rows.filter(r => {
    if (r.ord_responsible === 'not_required' || r.ord_status !== 'todo') return false
    if (r.stage === 'cancelled') return false
    if (!r.integration_date) return false
    const diff = dayjs(r.integration_date).startOf('day').diff(today, 'day')
    return diff <= 2
  })

  const ordReportOverdue = rows.filter(
    r => r.ord_responsible !== 'not_required' && r.ord_reporting_status === 'overdue' && r.stage !== 'cancelled'
  )

  return [
    { key: 'drafts', title: 'Черновики без суммы/даты', items: toItems(drafts, () => 'заполните карточку') },
    { key: 'deadlineSoon', title: 'Дедлайн через 1-3 дня', items: toItems(deadlineSoon, r => dayjs(r.deadline).format('DD.MM')) },
    { key: 'deadlineOverdue', title: 'Дедлайн просрочен', items: toItems(deadlineOverdue, r => dayjs(r.deadline).format('DD.MM')) },
    {
      key: 'contractOverdue',
      title: 'Договор > 5 дней без ответа',
      items: toItems(contractOverdue, r => `отправлен ${dayjs(r.contract_sent_date).format('DD.MM')}`),
    },
    { key: 'paymentOverdue', title: 'Оплата просрочена', items: toItems(paymentOverdue, r => `дедлайн ${dayjs(r.deadline).format('DD.MM')}`) },
    {
      key: 'ordTodo',
      title: 'Маркировка не готова, скоро эфир',
      items: toItems(ordTodo, r => `эфир ${dayjs(r.integration_date).format('DD.MM')}`),
    },
    { key: 'ordReportOverdue', title: 'Отчётность в ОРД просрочена', items: toItems(ordReportOverdue, () => 'сдайте отчёт') },
    {
      key: 'contractExpiring',
      title: 'Договор истекает в течение недели',
      items: toItems(contractExpiring, r => `до ${dayjs(r.contract_valid_until).format('DD.MM')}`),
    },
    {
      key: 'contractExpired',
      title: 'Договор истёк',
      items: toItems(contractExpired, r => `истёк ${dayjs(r.contract_valid_until).format('DD.MM')}`),
    },
    { key: 'caseMissing', title: 'Завершено, нет кейса для сайта', items: toItems(caseMissing, () => 'добавьте кейс') },
  ]
}
