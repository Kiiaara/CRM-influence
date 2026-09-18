import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { streamerProfilesApi } from '../api/streamerProfiles'
import type { StreamerProfile } from '../api/streamerProfiles'

function emptyProfile(): StreamerProfile {
  return {
    id: 0,
    name: '',
    twitch_url: '',
    category: '',
    social_links: '',
    subscribers: null,
    avg_online: null,
    geo: '',
    views_per_month: null,
    views_per_stream: null,
    telegram_subscribers: null,
    telegram_reach: null,
    post_price: null,
    knd_registry: '',
    twitch_partner: false,
    stats_url: '',
    stats_updated_at: null,
    manager: '',
    branding_price_1w: null,
    branding_price_2w: null,
    branding_price_3w: null,
    branding_price_1m: null,
    special_stream_price: null,
    voice_integration_price: null,
    created_at: '',
    updated_at: '',
  }
}

export default function StreamerProfilesPage() {
  const qc = useQueryClient()
  const { data: profiles = [] } = useQuery({ queryKey: ['streamer-profiles'], queryFn: streamerProfilesApi.list })
  const [editing, setEditing] = useState<StreamerProfile | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [importResult, setImportResult] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: (id: number) => streamerProfilesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['streamer-profiles'] }),
  })

  const importFile = useMutation({
    mutationFn: (file: File) => streamerProfilesApi.importFile(file),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['streamer-profiles'] })
      setImportResult(`Импортировано: ${res.created} новых, ${res.updated} обновлено`)
    },
    onError: () => setImportResult('Ошибка импорта — проверь формат файла'),
  })

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected(prev => prev.size === profiles.length ? new Set() : new Set(profiles.map(p => p.id)))
  }

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">База стримеров</h1>
        <div className="flex flex-wrap gap-2">
          <a
            href="https://docs.google.com/spreadsheets/d/18js3QuVJ0S0JnPxCoavKJsSIHCoLDhSRo3POAXYOkdE/edit?pli=1&gid=216813285#gid=216813285"
            target="_blank"
            rel="noreferrer"
            className="bg-slate-100 dark:bg-brand-900 hover:bg-slate-200 dark:hover:bg-brand-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium"
          >
            🧮 Таблица расчёта
          </a>
          <label className="bg-slate-100 dark:bg-brand-900 hover:bg-slate-200 dark:hover:bg-brand-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer">
            📤 Импорт из Excel
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => e.target.files?.[0] && importFile.mutate(e.target.files[0])}
            />
          </label>
          <a
            href={streamerProfilesApi.exportUrl(selected.size > 0 ? [...selected] : undefined)}
            className="bg-slate-100 dark:bg-brand-900 hover:bg-slate-200 dark:hover:bg-brand-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium"
          >
            📥 {selected.size > 0 ? `Скачать КП (${selected.size})` : 'Скачать всё'}
          </a>
          <button
            onClick={() => setEditing(emptyProfile())}
            className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + Стример
          </button>
        </div>
      </div>
      {importResult && <div className="text-sm text-slate-500 dark:text-slate-400 mb-4">{importResult}</div>}
      <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">
        Отметь галочками нужных стримеров и скачай подборку как таблицу для клиента.
      </p>

      {/* Мобилка: карточки */}
      <div className="space-y-3 sm:hidden">
        {profiles.map(p => (
          <div key={p.id} className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="mt-1 w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0" onClick={() => setEditing(p)}>
                <div className="font-medium text-slate-900 dark:text-slate-100">{p.name}</div>
                <div className="text-xs text-slate-400">{p.category} {p.geo && `· ${p.geo}`}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {p.subscribers != null && <>👥 {p.subscribers.toLocaleString('ru-RU')} </>}
                  {p.avg_online != null && <>· 🟢 {p.avg_online.toLocaleString('ru-RU')} онлайн</>}
                </div>
                {p.post_price != null && (
                  <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Пост: {p.post_price.toLocaleString('ru-RU')} ₽</div>
                )}
              </div>
            </div>
          </div>
        ))}
        {profiles.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Стримеров нет — импортируй файл или добавь вручную</div>}
      </div>

      {/* Десктоп: таблица */}
      <div className="hidden sm:block bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              <th className="px-3 py-2"><input type="checkbox" checked={selected.size === profiles.length && profiles.length > 0} onChange={toggleAll} className="w-4 h-4" /></th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Имя</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Ссылка на Twitch</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Категория</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Соц. сети</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Гео</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Подписчики</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Ср. онлайн</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Просмотров/мес</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Просмотры/стрим</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Подп. Telegram</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Telegram охват</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Стоимость поста</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Реестр КНД</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Твич партнёр</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Статистика</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Обновлено статы</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Менеджер</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Брендинг 1 нед</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Брендинг 2 нед</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Брендинг 3 нед</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Брендинг 1 мес</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Спецстрим</th>
              <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">Голосовая интеграция</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map(p => {
              const money = (v: number | null) => v != null ? `${Math.round(v).toLocaleString('ru-RU')} ₽` : '—'
              const num = (v: number | null) => v != null ? v.toLocaleString('ru-RU') : '—'
              return (
              <tr key={p.id} className="border-t border-slate-100 dark:border-brand-900 hover:bg-slate-50 dark:hover:bg-brand-900/30">
                <td className="px-3 py-2"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="w-4 h-4" /></td>
                <td className="px-3 py-2 text-slate-900 dark:text-slate-100 cursor-pointer whitespace-nowrap" onClick={() => setEditing(p)}>{p.name}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[200px] truncate">
                  {p.twitch_url ? <a href={p.twitch_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{p.twitch_url}</a> : '—'}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{p.category || '—'}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[180px] truncate">{p.social_links || '—'}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{p.geo || '—'}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{num(p.subscribers)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{num(p.avg_online)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{num(p.views_per_month)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{num(p.views_per_stream)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{num(p.telegram_subscribers)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{num(p.telegram_reach)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{money(p.post_price)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[160px] truncate">{p.knd_registry || '—'}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{p.twitch_partner ? 'Да' : 'Нет'}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[160px] truncate">
                  {p.stats_url ? <a href={p.stats_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">ссылка</a> : '—'}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{p.stats_updated_at ? p.stats_updated_at.slice(0, 10) : '—'}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{p.manager || '—'}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{money(p.branding_price_1w)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{money(p.branding_price_2w)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{money(p.branding_price_3w)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{money(p.branding_price_1m)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{money(p.special_stream_price)}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{money(p.voice_integration_price)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(p)} className="text-brand-600 hover:text-brand-700 text-xs mr-2">править</button>
                  <button onClick={() => confirm('Удалить стримера из базы?') && remove.mutate(p.id)} className="text-red-500 hover:text-red-700 text-xs">удалить</button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        {profiles.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Стримеров нет — импортируй файл или добавь вручную</div>}
      </div>

      {editing && (
        <ProfileModal profile={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-500 dark:text-slate-400">{label}</label>
      {children}
    </div>
  )
}

const inputCls = "w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"

function ProfileModal({ profile, onClose }: { profile: StreamerProfile; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<StreamerProfile>(profile)
  const isNew = profile.id === 0

  const set = <K extends keyof StreamerProfile>(k: K, v: StreamerProfile[K]) => setForm({ ...form, [k]: v })
  const num = (v: string) => v === '' ? null : Number(v)

  const create = useMutation({
    mutationFn: (p: Partial<StreamerProfile>) => streamerProfilesApi.create(p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['streamer-profiles'] }); onClose() },
  })
  const update = useMutation({
    mutationFn: (p: Partial<StreamerProfile>) => streamerProfilesApi.update(profile.id, p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['streamer-profiles'] }); onClose() },
  })

  const save = () => {
    if (!form.name.trim()) return
    const { id, created_at, updated_at, ...payload } = form
    if (isNew) create.mutate(payload)
    else update.mutate(payload)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">{isNew ? 'Новый стример' : form.name}</h2>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Имя"><input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} /></Field>
            <Field label="Ссылка на Twitch"><input value={form.twitch_url} onChange={e => set('twitch_url', e.target.value)} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Категория"><input value={form.category} onChange={e => set('category', e.target.value)} className={inputCls} /></Field>
            <Field label="Гео"><input value={form.geo} onChange={e => set('geo', e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="Соц. сети"><input value={form.social_links} onChange={e => set('social_links', e.target.value)} className={inputCls} /></Field>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Подписчики"><input type="number" value={form.subscribers ?? ''} onChange={e => set('subscribers', num(e.target.value))} className={inputCls} /></Field>
            <Field label="Средний онлайн"><input type="number" value={form.avg_online ?? ''} onChange={e => set('avg_online', num(e.target.value))} className={inputCls} /></Field>
            <Field label="Просмотров за месяц"><input type="number" value={form.views_per_month ?? ''} onChange={e => set('views_per_month', num(e.target.value))} className={inputCls} /></Field>
            <Field label="Просмотры за 1 стрим"><input type="number" value={form.views_per_stream ?? ''} onChange={e => set('views_per_stream', num(e.target.value))} className={inputCls} /></Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Подписчики Telegram"><input type="number" value={form.telegram_subscribers ?? ''} onChange={e => set('telegram_subscribers', num(e.target.value))} className={inputCls} /></Field>
            <Field label="Telegram Охват"><input type="number" value={form.telegram_reach ?? ''} onChange={e => set('telegram_reach', num(e.target.value))} className={inputCls} /></Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Реестр КНД"><input value={form.knd_registry} onChange={e => set('knd_registry', e.target.value)} className={inputCls} /></Field>
            <Field label="Менеджер"><input value={form.manager} onChange={e => set('manager', e.target.value)} className={inputCls} /></Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Статистика (ссылка)"><input value={form.stats_url} onChange={e => set('stats_url', e.target.value)} className={inputCls} /></Field>
            <Field label="Дата обновления статы">
              <input type="date" value={form.stats_updated_at ? form.stats_updated_at.slice(0, 10) : ''} onChange={e => set('stats_updated_at', e.target.value || null)} className={inputCls} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.twitch_partner} onChange={e => set('twitch_partner', e.target.checked)} className="w-4 h-4" />
            Твич партнёр
          </label>

          <div className="border-t border-slate-200 dark:border-brand-900 pt-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 font-medium">Прайс-лист</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="Стоимость поста"><input type="number" value={form.post_price ?? ''} onChange={e => set('post_price', num(e.target.value))} className={inputCls} /></Field>
              <Field label="Стоимость спецстрима"><input type="number" value={form.special_stream_price ?? ''} onChange={e => set('special_stream_price', num(e.target.value))} className={inputCls} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="Брендинг на 1 неделю"><input type="number" value={form.branding_price_1w ?? ''} onChange={e => set('branding_price_1w', num(e.target.value))} className={inputCls} /></Field>
              <Field label="Брендинг на 2 недели"><input type="number" value={form.branding_price_2w ?? ''} onChange={e => set('branding_price_2w', num(e.target.value))} className={inputCls} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="Брендинг на 3 недели"><input type="number" value={form.branding_price_3w ?? ''} onChange={e => set('branding_price_3w', num(e.target.value))} className={inputCls} /></Field>
              <Field label="Брендинг на 1 месяц"><input type="number" value={form.branding_price_1m ?? ''} onChange={e => set('branding_price_1m', num(e.target.value))} className={inputCls} /></Field>
            </div>
            <Field label="Стоимость 1 голосовой интеграции"><input type="number" value={form.voice_integration_price ?? ''} onChange={e => set('voice_integration_price', num(e.target.value))} className={inputCls} /></Field>
          </div>
        </div>

        <div className="flex justify-between mt-6">
          <div />
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-900 rounded-lg">Отмена</button>
            <button onClick={save} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  )
}
