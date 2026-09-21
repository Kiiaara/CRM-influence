import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  advertisersApi,
  CONTACT_TYPE_LABELS,
  CONTACT_TYPE_ICONS,
  contactQuickLink,
} from '../api/advertisers'
import type { Advertiser, BrandContact, ContactType } from '../api/advertisers'
import { integrationsApi } from '../api/integrations'

export default function AdvertisersPage() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [q, setQ] = useState(searchParams.get('q') ?? '')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [opened, setOpened] = useState<Advertiser | null>(null)

  const { data: advertisers = [] } = useQuery({ queryKey: ['advertisers'], queryFn: advertisersApi.list })

  // если пришли по ссылке с ?q=Бренд из другой страницы - сразу открываем совпадение
  useEffect(() => {
    const qp = searchParams.get('q')
    if (!qp || advertisers.length === 0) return
    const exact = advertisers.find(a => a.name.toLowerCase() === qp.toLowerCase())
    if (exact) {
      setOpened(exact)
      searchParams.delete('q')
      setSearchParams(searchParams, { replace: true })
    }
  }, [advertisers, searchParams, setSearchParams])

  const filtered = useMemo(
    () => advertisers.filter(a => !q.trim() || a.name.toLowerCase().includes(q.toLowerCase())),
    [advertisers, q]
  )

  const create = useMutation({
    mutationFn: (name: string) => advertisersApi.create({ name }),
    onSuccess: adv => {
      qc.invalidateQueries({ queryKey: ['advertisers'] })
      setNewName('')
      setCreating(false)
      setOpened(adv)
    },
  })

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Рекламодатели</h1>
        <div className="flex gap-2 w-full sm:w-auto">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Поиск по названию"
            className="flex-1 sm:w-64 bg-slate-100 dark:bg-brand-900 border border-transparent focus:border-brand-500 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none"
          />
          <button
            onClick={() => setCreating(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
          >
            + Рекламодатель
          </button>
        </div>
      </div>
      <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">Всего: {advertisers.length}</p>

      {creating && (
        <div className="mb-4 flex gap-2 items-center bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-3">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && newName.trim() && create.mutate(newName.trim())}
            placeholder="Название рекламодателя"
            className="flex-1 bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
          <button
            onClick={() => newName.trim() && create.mutate(newName.trim())}
            className="bg-brand-600 hover:bg-brand-700 text-white px-3 py-2 rounded-lg text-sm"
          >
            Создать
          </button>
          <button
            onClick={() => { setCreating(false); setNewName('') }}
            className="px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900 rounded-lg"
          >
            Отмена
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Название</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Сделок</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Контакты</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <tr
                key={a.id}
                onClick={() => setOpened(a)}
                className="border-t border-slate-100 dark:border-brand-900 hover:bg-slate-50 dark:hover:bg-brand-900/30 cursor-pointer"
              >
                <td className="px-3 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">{a.name}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{a.deals_count}</td>
                <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                  <QuickContacts advertiserId={a.id} contacts={a.contacts} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Рекламодателей пока нет</div>}
      </div>

      {opened && <AdvertiserModal advertiser={opened} onClose={() => setOpened(null)} />}
    </div>
  )
}

function QuickContacts({ advertiserId, contacts }: { advertiserId: number; contacts: BrandContact[] }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addContact = useMutation({
    mutationFn: (p: Partial<BrandContact>) => advertisersApi.addContact(advertiserId, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advertisers'] })
      qc.invalidateQueries({ queryKey: ['advertisers', advertiserId, 'contacts'] })
      setAdding(false)
      setError(null)
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось сохранить контакт'),
  })

  if (adding) {
    return (
      <div className="w-64">
        <BrandContactForm
          onCancel={() => { setAdding(false); setError(null) }}
          onSave={payload => addContact.mutate(payload)}
        />
        {error && <div className="text-xs text-red-500 mt-1">{error}</div>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {contacts.map(c => {
        const link = contactQuickLink(c)
        return link ? (
          <a
            key={c.id}
            href={link}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-xs bg-slate-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400 hover:underline px-2 py-1 rounded-full whitespace-nowrap"
          >
            {CONTACT_TYPE_ICONS[c.contact_type]} {c.value}
          </a>
        ) : (
          <span
            key={c.id}
            className="text-xs bg-slate-100 dark:bg-brand-900 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-full whitespace-nowrap"
          >
            {CONTACT_TYPE_ICONS[c.contact_type]} {c.value}
          </span>
        )
      })}
      <button
        onClick={() => setAdding(true)}
        className="text-xs w-6 h-6 flex items-center justify-center rounded-full bg-brand-600 hover:bg-brand-700 text-white shrink-0"
        title="Добавить контакт"
      >
        +
      </button>
    </div>
  )
}

function AdvertiserModal({ advertiser, onClose }: { advertiser: Advertiser; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(advertiser.name)
  const [notes, setNotes] = useState(advertiser.notes)
  const [error, setError] = useState<string | null>(null)

  const { data: deals = [] } = useQuery({
    queryKey: ['advertisers', advertiser.id, 'deals'],
    queryFn: () => advertisersApi.deals(advertiser.id),
  })

  const save = useMutation({
    mutationFn: () => advertisersApi.update(advertiser.id, { name: name.trim(), notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advertisers'] })
      qc.invalidateQueries({ queryKey: ['integrations'] })
      setError(null)
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось сохранить'),
  })

  const remove = useMutation({
    mutationFn: () => advertisersApi.remove(advertiser.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advertisers'] })
      onClose()
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось удалить'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Название</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Заметки</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
            />
          </div>
          {error && <div className="text-xs text-red-500">{error}</div>}

          <AdvertiserContacts advertiserId={advertiser.id} />

          <div className="border border-slate-200 dark:border-brand-900 rounded-lg p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Сделки ({deals.length})</div>
            <div className="space-y-1">
              {deals.map(d => <DealRow key={d.id} deal={d} />)}
              {deals.length === 0 && <div className="text-xs text-slate-400">Сделок ещё не было</div>}
            </div>
          </div>
        </div>

        <div className="flex justify-between mt-6">
          <button
            onClick={() => confirm('Удалить рекламодателя?') && remove.mutate()}
            className="text-red-500 hover:text-red-700 text-sm"
          >
            Удалить
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-900 rounded-lg">Закрыть</button>
            <button onClick={() => save.mutate()} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// строка сделки в карточке рекламодателя: ссылка на сделку (?deal=<id> в интеграциях) можно
// скопировать и кинуть коллеге, плюс сразу выгрузить в Excel
function DealRow({ deal }: { deal: { id: number; description: string; streamers_count: number; updated_at: string } }) {
  const [copied, setCopied] = useState(false)

  const copyLink = () => {
    const url = `${window.location.origin}/integrations?deal=${deal.id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-slate-700 dark:text-slate-300 truncate">
        {deal.description || `Сделка #${deal.id}`} <span className="text-slate-400">· {deal.streamers_count} стример(ов)</span>
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-slate-400">{new Date(deal.updated_at).toLocaleDateString('ru-RU')}</span>
        <a
          href={integrationsApi.exportUrl(deal.id)}
          title="Скачать в Excel"
          className="text-slate-300 hover:text-brand-500 text-xs"
        >
          ⬇
        </a>
        <button onClick={copyLink} title="Скопировать ссылку на сделку" className="text-slate-300 hover:text-brand-500 text-xs">
          {copied ? '✓' : '🔗'}
        </button>
      </div>
    </div>
  )
}

function AdvertiserContacts({ advertiserId }: { advertiserId: number }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: contacts = [] } = useQuery({
    queryKey: ['advertisers', advertiserId, 'contacts'],
    queryFn: () => advertisersApi.contacts(advertiserId),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['advertisers', advertiserId, 'contacts'] })
    qc.invalidateQueries({ queryKey: ['advertisers'] })
  }

  const addContact = useMutation({
    mutationFn: (p: Partial<BrandContact>) => advertisersApi.addContact(advertiserId, p),
    onSuccess: () => { invalidate(); setAdding(false); setError(null) },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось сохранить контакт'),
  })
  const updateContact = useMutation({
    mutationFn: (p: { id: number; payload: Partial<BrandContact> }) => advertisersApi.updateContact(p.id, p.payload),
    onSuccess: () => { invalidate(); setEditingId(null); setError(null) },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось сохранить контакт'),
  })
  const removeContact = useMutation({
    mutationFn: (id: number) => advertisersApi.removeContact(id),
    onSuccess: invalidate,
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось удалить контакт'),
  })

  return (
    <div className="border border-slate-200 dark:border-brand-900 rounded-lg p-3">
      <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Контакты</div>
      {error && <div className="text-xs text-red-500 mb-2">{error}</div>}
      <div className="space-y-1.5 mb-2">
        {contacts.map(c =>
          editingId === c.id ? (
            <BrandContactForm
              key={c.id}
              initial={c}
              onCancel={() => setEditingId(null)}
              onSave={payload => updateContact.mutate({ id: c.id, payload })}
            />
          ) : (
            <div key={c.id} className="flex items-center justify-between gap-2 text-sm bg-slate-50 dark:bg-brand-950/60 rounded-lg px-2 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span>{CONTACT_TYPE_ICONS[c.contact_type]}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {contactQuickLink(c) ? (
                      <a href={contactQuickLink(c)!} target="_blank" rel="noreferrer" className="text-brand-600 dark:text-brand-400 hover:underline truncate">
                        {c.value}
                      </a>
                    ) : (
                      <span className="text-slate-700 dark:text-slate-300 truncate">{c.value}</span>
                    )}
                    {c.is_primary && <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 shrink-0">основной</span>}
                  </div>
                  {(c.label || c.notes) && (
                    <div className="text-[11px] text-slate-400 truncate">{[c.label, c.notes].filter(Boolean).join(' · ')}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setEditingId(c.id)} className="text-xs text-slate-400 hover:text-brand-600">изм.</button>
                <button onClick={() => removeContact.mutate(c.id)} className="text-slate-300 hover:text-red-500 text-xs">×</button>
              </div>
            </div>
          )
        )}
        {contacts.length === 0 && !adding && <div className="text-xs text-slate-400">Контактов ещё нет</div>}
      </div>

      {adding ? (
        <BrandContactForm onCancel={() => setAdding(false)} onSave={payload => addContact.mutate(payload)} />
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1 rounded-lg">
          + Контакт
        </button>
      )}
    </div>
  )
}

function BrandContactForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: BrandContact
  onSave: (payload: { contact_type: ContactType; value: string; label: string; is_primary: boolean; notes: string }) => void
  onCancel: () => void
}) {
  const [contactType, setContactType] = useState<ContactType>(initial?.contact_type ?? 'telegram')
  const [value, setValue] = useState(initial?.value ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [isPrimary, setIsPrimary] = useState(initial?.is_primary ?? false)

  const fieldCls = "w-full bg-white dark:bg-brand-900/30 border border-slate-200 dark:border-brand-800 rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-slate-100"

  const save = () => {
    if (value.trim()) onSave({ contact_type: contactType, value: value.trim(), label, is_primary: isPrimary, notes })
  }
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') save() }

  return (
    <div className="border border-slate-200 dark:border-brand-800 rounded-lg p-2 space-y-1.5 bg-slate-50 dark:bg-brand-950/40">
      <div className="grid grid-cols-2 gap-1.5">
        <select value={contactType} onChange={e => setContactType(e.target.value as ContactType)} className={fieldCls}>
          {Object.entries(CONTACT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{CONTACT_TYPE_ICONS[k as ContactType]} {v}</option>)}
        </select>
        <input value={value} onChange={e => setValue(e.target.value)} onKeyDown={onEnter} placeholder="Значение" className={fieldCls} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <input value={label} onChange={e => setLabel(e.target.value)} onKeyDown={onEnter} placeholder="Роль (менеджер, директор…)" className={fieldCls} />
        <input value={notes} onChange={e => setNotes(e.target.value)} onKeyDown={onEnter} placeholder="Заметка (часовой пояс и т.п.)" className={fieldCls} />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} />
          Основной контакт
        </label>
        <div className="flex gap-2">
          <button onClick={onCancel} className="text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900 px-2 py-1 rounded-lg">Отмена</button>
          <button
            onClick={save}
            className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1 rounded-lg"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
