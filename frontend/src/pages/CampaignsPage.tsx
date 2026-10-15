import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
  campaignsApi,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_COLORS,
} from '../api/campaigns'
import type { Campaign, CampaignBlogger, CampaignPayload, CampaignStatus } from '../api/campaigns'
import { advertisersApi } from '../api/advertisers'
import type { Advertiser } from '../api/advertisers'
import { bloggerProfilesApi } from '../api/bloggerProfiles'
import { streamerProfilesApi } from '../api/streamerProfiles'
import { integrationsApi, PAYMENT_LABELS, STAGES } from '../api/integrations'
import type { TalentType } from '../api/integrations'
import { tasksApi } from '../api/tasks'
import { displayNick, matchesQuery, sheetRowLinks } from '../utils/bloggerSearch'

const cellInput =
  'w-full bg-transparent border border-transparent hover:border-slate-200 dark:hover:border-brand-800 focus:border-brand-400 rounded px-1.5 py-1 text-sm text-slate-900 dark:text-slate-100 outline-none'

// поле с рамкой для блока деталей и формы добавления
const boxInput =
  'w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 focus:border-brand-400 rounded-lg px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none'

type Assignee = { tg_id: number; label: string }
type SetFn = (id: number, p: CampaignPayload) => void

const fmtMoney = (n: number, currency: string) => `${Math.round(n).toLocaleString('ru-RU')} ${currency}`

// Недописанный блогер по каждой кампании. Живёт вне компонента, поэтому
// переживает сворачивание панели: свернули случайно - введённое на месте.
type Draft = { name: string; amount: string; type: TalentType }
const drafts = new Map<number, Draft>()
const emptyDraft: Draft = { name: '', amount: '', type: 'blogger' }

export default function CampaignsPage() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  // раскрытые кампании (блок с деталями и блогерами)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const { data: campaigns = [] } = useQuery({ queryKey: ['campaigns'], queryFn: campaignsApi.list })
  const { data: advertisers = [] } = useQuery({ queryKey: ['advertisers'], queryFn: advertisersApi.list })
  const { data: assignees = [] } = useQuery({ queryKey: ['task-assignees'], queryFn: tasksApi.assignees })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['campaigns'] })

  const create = useMutation({
    mutationFn: (name: string) => campaignsApi.create({ name }),
    onSuccess: () => { invalidate(); setNewName(''); setAdding(false); setError(null) },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось создать'),
  })
  const update = useMutation({
    mutationFn: ({ id, p }: { id: number; p: CampaignPayload }) => campaignsApi.update(id, p),
    onSuccess: () => {
      invalidate()
      // смена рекламодателя/названия меняет бренд сделки на канбане
      qc.invalidateQueries({ queryKey: ['integrations'] })
      setError(null)
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось сохранить'),
  })
  const remove = useMutation({
    mutationFn: (id: number) => campaignsApi.remove(id),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['integrations'] }) },
  })

  const rows = useMemo(() => {
    let list = campaigns
    if (q.trim()) {
      const needle = q.toLowerCase()
      list = list.filter(
        c =>
          c.name.toLowerCase().includes(needle) ||
          (c.advertiser_name ?? '').toLowerCase().includes(needle)
      )
    }
    return list
  }, [campaigns, q])

  const set: SetFn = (id, p) => update.mutate({ id, p })
  const toggle = (id: number) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const askRemove = (c: Campaign) => confirm(`Удалить «${c.name}»? Сделки блогеров останутся на канбане.`) && remove.mutate(c.id)

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Рекламные кампании</h1>
        <button
          onClick={() => setAdding(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium w-full sm:w-auto"
        >
          + Новая РК
        </button>
      </div>
      <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">
        Запросы от брендов: от поступления до запуска. Нажмите на строку, чтобы открыть блогеров, бюджет и КП.
      </p>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск по названию или бренду"
          className="w-full sm:w-64 bg-slate-100 dark:bg-brand-900 border border-transparent focus:border-brand-500 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none"
        />
      </div>

      {error && <div className="text-sm text-red-500 mb-3">{error}</div>}

      {adding && (
        <div className="bg-white dark:bg-brand-950 border border-brand-300 dark:border-brand-700 rounded-xl p-4 mb-4 flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newName.trim()) create.mutate(newName.trim())
              if (e.key === 'Escape') { setAdding(false); setNewName('') }
            }}
            placeholder="Название кампании"
            className="flex-1 min-w-0 bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
          <button
            onClick={() => newName.trim() && create.mutate(newName.trim())}
            disabled={!newName.trim() || create.isPending}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm shrink-0"
          >
            Создать
          </button>
          <button
            onClick={() => { setAdding(false); setNewName('') }}
            className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900 shrink-0"
          >
            Отмена
          </button>
        </div>
      )}

      {/* мобильная вёрстка: карточки */}
      <div className="sm:hidden space-y-3">
        {rows.map(c => {
          const open = expanded.has(c.id)
          return (
            <div key={c.id} className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-3">
              <div className="flex items-center gap-1">
                <Chevron open={open} onClick={() => toggle(c.id)} />
                <div className="flex-1 min-w-0">
                  <TextCell value={c.name} onSave={v => v.trim() && set(c.id, { name: v })} />
                </div>
                <DeleteButton onClick={() => askRemove(c)} />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Labeled label="Рекламодатель"><AdvertiserSelect c={c} advertisers={advertisers} set={set} /></Labeled>
                <Labeled label="Ответственный"><OwnerSelect c={c} assignees={assignees} set={set} /></Labeled>
                <Labeled label="Запрос от"><DateCell value={c.requested_at} onSave={v => set(c.id, { requested_at: v })} /></Labeled>
                <Labeled label="Статус"><StatusSelect c={c} set={set} /></Labeled>
                <Labeled label="ДЛ подборки"><DateCell value={c.selection_due_at} onSave={v => set(c.id, { selection_due_at: v })} highlight /></Labeled>
                <Labeled label="ДЛ РК"><DateCell value={c.campaign_due_at} onSave={v => set(c.id, { campaign_due_at: v })} highlight /></Labeled>
              </div>
              {/* сводка только раскрывает: закрыть можно шевроном, чтобы
                  случайный тап не схлопнул панель с недописанными данными */}
              <button
                onClick={() => !open && toggle(c.id)}
                className="mt-2 w-full text-left text-sm rounded-lg bg-slate-50 dark:bg-brand-900/40 px-3 py-2"
              >
                <BloggersSummary c={c} />
              </button>
              {open && <div className="mt-3"><CampaignDetails c={c} set={set} /></div>}
            </div>
          )
        })}
      </div>

      {/* десктоп: таблица, детали раскрываются под строкой */}
      <div className="hidden sm:block bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              <Th />
              <Th>Название РК</Th>
              <Th>Рекламодатель</Th>
              <Th>Запрос от</Th>
              <Th>ДЛ подборки</Th>
              <Th>ДЛ РК</Th>
              <Th>Статус</Th>
              <Th>Блогеры</Th>
              <Th>Ответственный</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const open = expanded.has(c.id)
              return (
                <CampaignRow
                  key={c.id}
                  c={c}
                  open={open}
                  onToggle={() => toggle(c.id)}
                  advertisers={advertisers}
                  assignees={assignees}
                  set={set}
                  onRemove={() => askRemove(c)}
                />
              )
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <div className="text-sm text-slate-400 text-center py-10">
          {campaigns.length === 0
            ? 'Кампаний пока нет. Нажмите «Новая РК», чтобы завести первую.'
            : 'Ничего не найдено'}
        </div>
      )}
    </div>
  )
}

function CampaignRow({
  c,
  open,
  onToggle,
  advertisers,
  assignees,
  set,
  onRemove,
}: {
  c: Campaign
  open: boolean
  onToggle: () => void
  advertisers: Advertiser[]
  assignees: Assignee[]
  set: SetFn
  onRemove: () => void
}) {
  return (
    <>
      <tr
        // раскрытие висит ТОЛЬКО на шевроне: раньше клик по пустому месту строки
        // схлопывал её, и мисклик мимо поля закрывал панель с недописанным блогером
        className={`border-t border-slate-100 dark:border-brand-900 align-top ${
          open ? 'bg-slate-50/60 dark:bg-brand-900/20' : ''
        }`}
      >
        <td className="pl-2 py-1.5 w-8"><Chevron open={open} onClick={onToggle} /></td>
        <td className="px-2 py-1.5 min-w-[160px]">
          <TextCell value={c.name} onSave={v => v.trim() && set(c.id, { name: v })} />
        </td>
        <td className="px-2 py-1.5"><AdvertiserSelect c={c} advertisers={advertisers} set={set} /></td>
        <td className="px-2 py-1.5">
          <DateCell value={c.requested_at} onSave={v => set(c.id, { requested_at: v })} />
        </td>
        <td className="px-2 py-1.5">
          <DateCell value={c.selection_due_at} onSave={v => set(c.id, { selection_due_at: v })} highlight />
        </td>
        <td className="px-2 py-1.5">
          <DateCell value={c.campaign_due_at} onSave={v => set(c.id, { campaign_due_at: v })} highlight />
        </td>
        <td className="px-2 py-1.5"><StatusSelect c={c} set={set} /></td>
        <td className="px-2 py-2 whitespace-nowrap">
          <BloggersSummary c={c} />
        </td>
        <td className="px-2 py-1.5"><OwnerSelect c={c} assignees={assignees} set={set} /></td>
        <td className="px-2 py-1.5 text-right"><DeleteButton onClick={onRemove} /></td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60 dark:bg-brand-900/20">
          <td />
          <td colSpan={9} className="px-2 pb-4 pt-1">
            <CampaignDetails c={c} set={set} />
          </td>
        </tr>
      )}
    </>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-2 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap font-medium text-xs">{children}</th>
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-slate-400 dark:text-slate-500 px-1.5">{label}</div>
      {children}
    </div>
  )
}

function Chevron({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={open ? 'Свернуть' : 'Развернуть'}
      className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-slate-400 hover:text-brand-600 hover:bg-slate-100 dark:hover:bg-brand-900"
    >
      <span className={`inline-block transition-transform text-xs ${open ? 'rotate-90' : ''}`}>▶</span>
    </button>
  )
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-slate-300 hover:text-red-500 text-xs px-1" title="Удалить">
      ✕
    </button>
  )
}

// счётчик и сумма по блогерам видны без раскрытия строки
function BloggersSummary({ c }: { c: Campaign }) {
  // если панель свернули с недописанным блогером - показываем, что он не потерян
  const draft = drafts.get(c.id)
  const draftMark = draft ? (
    <span className="text-amber-600 dark:text-amber-400 text-xs"> · черновик: {draft.name || 'без имени'}</span>
  ) : null

  if (c.bloggers_count === 0) {
    return (
      <span>
        <span className="text-slate-400 dark:text-slate-500 text-xs">+ добавить блогеров</span>
        {draftMark}
      </span>
    )
  }
  return (
    <span className="text-slate-700 dark:text-slate-200">
      <span className="font-medium">{c.bloggers_count}</span>
      <span className="text-slate-400 dark:text-slate-500"> · </span>
      {fmtMoney(c.bloggers_total, c.currency)}
      {draftMark}
    </span>
  )
}

function AdvertiserSelect({ c, advertisers, set }: { c: Campaign; advertisers: Advertiser[]; set: SetFn }) {
  return (
    <select
      value={c.advertiser_id ?? ''}
      onChange={e => set(c.id, { advertiser_id: e.target.value ? Number(e.target.value) : null })}
      className={`${cellInput} min-w-[120px]`}
    >
      <option value="">-</option>
      {advertisers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  )
}

function OwnerSelect({ c, assignees, set }: { c: Campaign; assignees: Assignee[]; set: SetFn }) {
  return (
    <select
      value={c.owner_tg_id ?? ''}
      onChange={e => set(c.id, { owner_tg_id: e.target.value ? Number(e.target.value) : null })}
      className={`${cellInput} min-w-[110px]`}
    >
      <option value="">-</option>
      {assignees.map(a => <option key={a.tg_id} value={a.tg_id}>{a.label}</option>)}
    </select>
  )
}

function StatusSelect({ c, set }: { c: Campaign; set: SetFn }) {
  return (
    <select
      value={c.status}
      onChange={e => set(c.id, { status: e.target.value as CampaignStatus })}
      className={`rounded-full px-2 py-1 text-xs outline-none border-0 ${CAMPAIGN_STATUS_COLORS[c.status]}`}
    >
      {CAMPAIGN_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
  )
}

// раскрытый блок: слева бюджет, КП и комментарий, справа блогеры кампании
function CampaignDetails({ c, set }: { c: Campaign; set: SetFn }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr] bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-3 sm:p-4">
      <div className="space-y-3 min-w-0">
        <Labeled label="Бюджет">
          <NumberCell value={c.budget} currency={c.currency} onSave={v => set(c.id, { budget: v })} />
        </Labeled>
        <Labeled label="КП (ссылка)">
          <KpLinkInput value={c.kp_url} onSave={v => set(c.id, { kp_url: v })} />
        </Labeled>
        <Labeled label="Комментарий">
          <TextCell value={c.notes} placeholder="-" onSave={v => set(c.id, { notes: v })} />
        </Labeled>
      </div>
      <BloggersBlock c={c} />
    </div>
  )
}

// ссылка на КП: инпут + кнопка ↗, если адрес валидный (как OrdLinkInput на канбане)
function KpLinkInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const href = draft.trim()
  const valid = /^https?:\/\//i.test(href)
  return (
    <div className="flex gap-2">
      <input
        type="url"
        value={draft}
        placeholder="https://docs.google.com/spreadsheets/..."
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() !== value) onSave(draft.trim()) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={boxInput}
      />
      {valid && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          title="Открыть"
          className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-brand-800 text-slate-500 dark:text-slate-300 hover:border-brand-400"
        >
          ↗
        </a>
      )}
    </div>
  )
}

const dateShort = (v: string | null) => (v ? dayjs(v).format('DD.MM.YY') : '-')

function BloggersBlock({ c }: { c: Campaign }) {
  const qc = useQueryClient()
  const { data: bloggers = [], isLoading } = useQuery({
    queryKey: ['campaign-bloggers', c.id],
    queryFn: () => campaignsApi.bloggers(c.id),
  })

  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
        Блогеры кампании {bloggers.length > 0 && `(${bloggers.length})`}
      </div>

      {isLoading && <div className="text-sm text-slate-400 py-2">Загрузка...</div>}
      {!isLoading && bloggers.length === 0 && (
        <div className="text-sm text-slate-400 dark:text-slate-500 py-2">Пока никого. Добавьте первого блогера ниже.</div>
      )}

      {bloggers.length > 0 && (
        <div className="rounded-lg border border-slate-100 dark:border-brand-900 divide-y divide-slate-100 dark:divide-brand-900 mb-3">
          <div className="hidden sm:grid grid-cols-[minmax(140px,1.6fr)_110px_120px_80px_80px_130px_28px] gap-x-3 px-3 py-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            <span>Блогер</span><span>Сумма</span><span>Оплата</span><span>Выход</span><span>Дедлайн</span><span>Стадия</span><span />
          </div>
          {bloggers.map(b => <BloggerRow key={b.streamer_id} b={b} />)}
        </div>
      )}

      <AddBloggerForm
        c={c}
        existing={bloggers.map(b => b.name.toLowerCase())}
        onAdded={() => {
          qc.invalidateQueries({ queryKey: ['campaign-bloggers', c.id] })
          qc.invalidateQueries({ queryKey: ['campaigns'] })
          qc.invalidateQueries({ queryKey: ['integrations'] })
        }}
      />
    </div>
  )
}

function BloggerRow({ b }: { b: CampaignBlogger }) {
  const stage = STAGES.find(s => s.key === b.stage)?.label ?? b.stage
  const pay = PAYMENT_LABELS[b.payment_status] ?? b.payment_status
  const paid = b.payment_status === 'paid'
  const cancelled = b.stage === 'cancelled'
  return (
    // строка намеренно НЕ ссылка: мисклик уводил со страницы на скрытый канбан.
    // Переход в карточку сделки - только по стрелке справа
    <div
      className={`grid grid-cols-2 sm:grid-cols-[minmax(140px,1.6fr)_110px_120px_80px_80px_130px_28px] gap-x-3 gap-y-0.5 px-3 py-2 text-sm ${
        cancelled ? 'opacity-50' : ''
      }`}
    >
      <span className="col-span-2 sm:col-span-1 font-medium text-slate-900 dark:text-slate-100 truncate">
        {b.talent_type === 'blogger' && <span className="mr-1" title="Блогер">📱</span>}
        {b.name}
      </span>
      <span className="text-slate-700 dark:text-slate-200 whitespace-nowrap">
        {b.amount != null ? fmtMoney(b.amount, b.currency) : <span className="text-slate-300 dark:text-slate-600">-</span>}
      </span>
      <span className={paid ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>{pay}</span>
      <span className="text-slate-600 dark:text-slate-300"><span className="sm:hidden text-slate-400">Выход: </span>{dateShort(b.integration_date)}</span>
      <span className="text-slate-600 dark:text-slate-300"><span className="sm:hidden text-slate-400">ДЛ: </span>{dateShort(b.deadline)}</span>
      <span>
        <span className="inline-block rounded-full px-2 py-0.5 text-xs bg-slate-100 text-slate-600 dark:bg-brand-900 dark:text-slate-300">{stage}</span>
      </span>
      <Link
        to={`/integrations?open=${b.streamer_id}`}
        title="Открыть карточку сделки"
        className="justify-self-end text-slate-300 hover:text-brand-600 dark:text-slate-600 dark:hover:text-brand-400"
      >
        ↗
      </Link>
    </div>
  )
}

type Suggestion = {
  name: string
  hint: string
  price: number | null
  type: TalentType
  // по ним тоже ищем: в базе имя бывает русское, а знают человека по нику из ссылки
  url?: string
  telegram?: string
  links?: string
}

// добавление блогера: подсказки из базы блогеров (с ценой) и ранее вводимых имён
function AddBloggerForm({ c, existing, onAdded }: { c: Campaign; existing: string[]; onAdded: () => void }) {
  const saved = drafts.get(c.id) ?? emptyDraft
  const [name, setName] = useState(saved.name)
  const [amount, setAmount] = useState(saved.amount)
  const [type, setType] = useState<TalentType>(saved.type)
  const [focus, setFocus] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // пишем черновик на каждое изменение, чтобы он пережил размонтирование
  useEffect(() => {
    if (name || amount) drafts.set(c.id, { name, amount, type })
    else drafts.delete(c.id)
  }, [c.id, name, amount, type])

  const { data: profiles = [] } = useQuery({ queryKey: ['blogger-profiles'], queryFn: bloggerProfilesApi.list })
  const { data: influencers = [] } = useQuery({ queryKey: ['streamer-profiles'], queryFn: streamerProfilesApi.list })
  const { data: oldNames = [] } = useQuery({ queryKey: ['streamer-names'], queryFn: integrationsApi.streamerNames })

  const suggestions = useMemo<Suggestion[]>(() => {
    const fromBase: Suggestion[] = profiles.map(p => ({
      name: p.name,
      hint: [p.platform, p.category].filter(Boolean).join(' · '),
      price: p.price,
      type: 'blogger',
      url: p.url,
      telegram: p.telegram,
      // у блогеров из гугл-таблицы url пустой, ссылка только в сырой строке
      links: sheetRowLinks(p.sheet_row),
    }))
    // вторая база: инфлюенсеры. Раньше их в подсказках не было вообще
    const fromInfluencers: Suggestion[] = influencers.map(p => ({
      name: p.name,
      hint: ['Инфлюенсер', p.category].filter(Boolean).join(' · '),
      // цен у инфлюенсера несколько, подставляем голосовую как самую частую
      price: p.voice_integration_price ?? p.special_stream_price ?? null,
      type: 'streamer',
      url: p.twitch_url,
      links: p.social_links,
    }))
    const known = new Set([...fromBase, ...fromInfluencers].map(s => s.name.toLowerCase()))
    const fromHistory: Suggestion[] = oldNames
      .filter(n => !known.has(n.toLowerCase()))
      .map(n => ({ name: n, hint: 'ранее добавляли', price: null, type: 'streamer' }))
    return [...fromBase, ...fromHistory]
  }, [profiles, oldNames])

  const needle = name.trim().toLowerCase()
  const shown = needle ? suggestions.filter(s => matchesQuery(s, name)).slice(0, 8) : []

  const pick = (s: Suggestion) => {
    setName(s.name)
    setType(s.type)
    // цена из базы блогеров подставляется, но остаётся редактируемой
    if (s.price != null) setAmount(String(s.price))
    setFocus(false)
  }

  const add = useMutation({
    mutationFn: () =>
      campaignsApi.addBlogger(c.id, {
        name: name.trim(),
        talent_type: type,
        amount: amount.trim() ? Number(amount) : null,
        currency: c.currency,
      }),
    onSuccess: () => {
      drafts.delete(c.id) // блогер добавлен, черновик больше не нужен
      setName(''); setAmount(''); setType('blogger'); setErr(null)
      onAdded()
    },
    onError: (e: any) => setErr(e?.response?.data?.detail ?? 'Не удалось добавить'),
  })

  const dup = name.trim() !== '' && existing.includes(name.trim().toLowerCase())
  const amountBad = amount.trim() !== '' && !Number.isFinite(Number(amount))
  const canAdd = name.trim() !== '' && !amountBad && !add.isPending

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            value={name}
            onChange={e => { setName(e.target.value); setType('blogger'); setFocus(true) }}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 150)}
            onKeyDown={e => { if (e.key === 'Enter' && canAdd) add.mutate() }}
            placeholder="Имя, ник или ссылка"
            className={boxInput}
          />
          {focus && shown.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-800 rounded-lg shadow-lg">
              {shown.map(s => (
                <button
                  key={`${s.type}-${s.name}-${s.hint}`}
                  // mousedown, чтобы выбор сработал раньше blur инпута
                  onMouseDown={e => { e.preventDefault(); pick(s) }}
                  className="w-full flex justify-between gap-3 text-left px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-brand-900"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-slate-900 dark:text-slate-100">{s.name}</span>
                    {/* ник показываем, иначе непонятно, почему русское имя нашлось по латинице */}
                    {displayNick(s) && <span className="text-slate-400"> @{displayNick(s)}</span>}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0">
                    {s.hint}{s.price != null && ` · ${s.price.toLocaleString('ru-RU')}`}
                  </span>
                </button>
              ))}
            </div>
          )}
          {/* в базах 700+ человек, но нужного может не быть. Без этой строки кажется,
              что поиск сломан, хотя имя просто можно вписать руками */}
          {focus && name.trim() !== '' && shown.length === 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-800 rounded-lg shadow-lg px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
              В базах никого не нашли. Можно добавить «{name.trim()}» как есть.
            </div>
          )}
        </div>
        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canAdd) add.mutate() }}
          placeholder={`Сумма, ${c.currency}`}
          className={`${boxInput} sm:w-36`}
        />
        <button
          onClick={() => add.mutate()}
          disabled={!canAdd}
          className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium shrink-0"
        >
          + Добавить
        </button>
      </div>
      {dup && <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">Такой блогер в кампании уже есть - добавится ещё одна карточка</div>}
      {err && <div className="text-xs text-red-500 mt-1">{err}</div>}
    </div>
  )
}

// правка по месту: коммитим на blur, чтобы не дёргать сеть на каждую букву
function TextCell({
  value,
  placeholder,
  onSave,
}: {
  value: string
  placeholder?: string
  onSave: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft) }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur() }
      }}
      className={cellInput}
    />
  )
}

function DateCell({
  value,
  onSave,
  highlight,
}: {
  value: string | null
  onSave: (v: string | null) => void
  highlight?: boolean
}) {
  const serverValue = value ? value.slice(0, 10) : ''
  const [draft, setDraft] = useState(serverValue)
  useEffect(() => { setDraft(serverValue) }, [serverValue])

  // дедлайн горит, если он сегодня или уже прошёл
  const overdue =
    highlight && serverValue ? dayjs(serverValue).isBefore(dayjs(), 'day') : false
  const today = highlight && serverValue ? dayjs(serverValue).isSame(dayjs(), 'day') : false

  return (
    <input
      type="date"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== serverValue) onSave(draft || null) }}
      className={`${cellInput} ${
        overdue ? 'text-red-600 dark:text-red-400 font-medium' : today ? 'text-amber-600 dark:text-amber-400 font-medium' : ''
      }`}
    />
  )
}

function NumberCell({
  value,
  currency,
  onSave,
}: {
  value: number | null
  currency: string
  onSave: (v: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  useEffect(() => { setDraft(value != null ? String(value) : '') }, [value])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    const next = trimmed ? Number(trimmed) : null
    if (trimmed && !Number.isFinite(next)) { setDraft(value != null ? String(value) : ''); return }
    if (next !== value) onSave(next)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value != null ? String(value) : ''); setEditing(false) }
        }}
        className={`${cellInput} min-w-[90px]`}
      />
    )
  }

  return (
    <button onClick={() => setEditing(true)} className={`${cellInput} text-left whitespace-nowrap`}>
      {value != null ? `${value.toLocaleString('ru-RU')} ${currency}` : <span className="text-slate-300 dark:text-slate-600">-</span>}
    </button>
  )
}
