import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { usersApi } from '../api/users'
import type { UserRow } from '../api/users'
import { workspacesApi } from '../api/workspaces'
import type { WorkspaceRole } from '../api/workspaces'

interface Membership {
  workspaceId: number
  workspaceTitle: string
  tgId: number
  role: WorkspaceRole
}

const inputCls =
  'w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100'

// подпись над полем: глобальная роль и роль в проекте выглядят похоже, без подписей их путают
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

export default function AdminUsersPage() {
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const { data: workspaces = [] } = useQuery({ queryKey: ['workspaces'], queryFn: workspacesApi.list })
  const [tgId, setTgId] = useState('')
  const [vkId, setVkId] = useState('')
  const [label, setLabel] = useState('')
  const [role, setRole] = useState('editor')
  const [wsId, setWsId] = useState('')
  const [wsRole, setWsRole] = useState<WorkspaceRole>('viewer')
  const [addError, setAddError] = useState<string | null>(null)

  // участники по каждому пространству - чтобы показать, кто в какие проекты входит
  const memberQueries = useQueries({
    queries: workspaces.map(w => ({
      queryKey: ['workspace-members', w.id],
      queryFn: () => workspacesApi.members(w.id),
    })),
  })
  const memberships: Membership[] = workspaces.flatMap((w, i) =>
    (memberQueries[i]?.data ?? []).map(m => ({
      workspaceId: w.id,
      workspaceTitle: w.title,
      tgId: m.user_tg_id,
      role: m.role,
    }))
  )

  const add = useMutation({
    mutationFn: () =>
      usersApi.create({
        tg_id: tgId ? Number(tgId) : undefined,
        vk_id: vkId ? Number(vkId) : undefined,
        role,
        label: label || undefined,
        workspace_id: wsId ? Number(wsId) : undefined,
        workspace_role: wsId ? wsRole : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['workspace-members'] })
      setTgId(''); setVkId(''); setLabel(''); setAddError(null)
    },
    onError: (e: any) => setAddError(e?.response?.data?.detail ?? 'Не удалось добавить пользователя'),
  })
  const update = useMutation({
    mutationFn: ({ tg_id, p }: { tg_id: number; p: any }) => usersApi.update(tg_id, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
  const remove = useMutation({
    mutationFn: (tg_id: number) => usersApi.remove(tg_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <div className="p-4 sm:p-10 max-w-4xl">
      <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 mb-2">Пользователи</h1>
      <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm sm:text-base">Кто может заходить и редактировать. Роли: админ - всё; редактор - писать; читатель - только смотреть.</p>

      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="TG ID">
            <input value={tgId} onChange={e => setTgId(e.target.value)} placeholder="123456789" className={inputCls} />
          </Field>
          <Field label="VK ID">
            <input value={vkId} onChange={e => setVkId(e.target.value)} placeholder="можно позже" className={inputCls} />
          </Field>
          <Field label="Имя / заметка">
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Как называть" className={inputCls} />
          </Field>
          <Field label="Доступ к сайту">
            <select value={role} onChange={e => setRole(e.target.value)} className={inputCls}>
              <option value="admin">Админ</option>
              <option value="editor">Редактор</option>
              <option value="viewer">Читатель</option>
            </select>
          </Field>
          <Field label="Пространство">
            <select value={wsId} onChange={e => setWsId(e.target.value)} className={inputCls}>
              <option value="">Не добавлять никуда</option>
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
          </Field>
          {wsId && (
            <Field label="Доступ к проекту">
              <select value={wsRole} onChange={e => setWsRole(e.target.value as WorkspaceRole)} className={inputCls}>
                <option value="lead">Руководитель</option>
                <option value="viewer">Наблюдатель</option>
              </select>
            </Field>
          )}
          <div className="flex items-end">
            <button onClick={() => add.mutate()} disabled={(!tgId && !vkId) || add.isPending} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
              {add.isPending ? 'Добавляю…' : '+ Добавить'}
            </button>
          </div>
        </div>
        {addError && <div className="text-xs text-red-500 mt-2">{addError}</div>}
        {!tgId && vkId && (
          <div className="text-xs text-amber-600 dark:text-amber-400 mt-2">
            Без TG ID человек будет заходить только через VK и не получит уведомлений о задачах и дедлайнах.
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3">
          Достаточно одного из ID. VK ID человек узнает, попробовав войти через VK - ему покажут номер, который нужно прислать вам.
          Без пространства он войдёт на сайт, но не увидит ни одного проекта.
        </p>
      </div>

      {/* Мобилка: карточки вместо таблицы */}
      <div className="space-y-3 sm:hidden">
        {users.map(u => (
          <div key={u.tg_id} className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-slate-900 dark:text-slate-100">
                {u.label || u.tg_first_name || u.tg_username || `id ${u.tg_id}`}
                {u.is_self && <span className="ml-2 text-xs text-brand-600">(это ты)</span>}
              </div>
              {!u.is_self && (
                <button onClick={() => confirm('Удалить?') && remove.mutate(u.tg_id)} className="text-red-500 hover:text-red-700 text-xs shrink-0">удалить</button>
              )}
            </div>
            <div className="text-xs text-slate-400 mb-2 flex items-center gap-2 flex-wrap">
              <span>TG ID: {u.has_telegram ? u.tg_id : 'нет'}</span>
              <span className="flex items-center gap-1">
                VK ID: <VkIdCell user={u} onSave={v => update.mutate({ tg_id: u.tg_id, p: { vk_id: v } })} />
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                value={u.role}
                disabled={u.is_self}
                onChange={e => update.mutate({ tg_id: u.tg_id, p: { role: e.target.value } })}
                className="bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-2 py-1 text-sm text-slate-700 dark:text-slate-300"
              >
                <option value="admin">Админ</option>
                <option value="editor">Редактор</option>
                <option value="viewer">Читатель</option>
              </select>
              <span className="text-xs">
                {!u.has_telegram ? (
                  <span className="text-slate-400">нет Telegram</span>
                ) : u.tg_chat_ready ? (
                  <span className="text-emerald-600">бот подключён</span>
                ) : (
                  <span className="text-amber-600">нужен /start боту</span>
                )}
              </span>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-brand-900">
              <div className="text-xs text-slate-400 mb-1">Проекты</div>
              <UserWorkspaces tgId={u.tg_id} memberships={memberships} />
            </div>
          </div>
        ))}
        {users.length === 0 && <div className="text-sm text-slate-400 text-center py-6">Пользователей нет</div>}
      </div>

      {/* Десктоп: таблица */}
      <div className="hidden sm:block bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-brand-900/50">
            <tr>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300">TG ID</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300">VK ID</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300">Имя</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300">Доступ к сайту</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300">Проекты</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300">Бот</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.tg_id} className="border-t border-slate-100 dark:border-brand-900">
                <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                  {u.has_telegram ? u.tg_id : <span className="text-slate-400 text-xs">нет</span>}
                  {u.is_self && <span className="ml-2 text-xs text-brand-600">(это ты)</span>}
                </td>
                <td className="px-4 py-2">
                  <VkIdCell user={u} onSave={v => update.mutate({ tg_id: u.tg_id, p: { vk_id: v } })} />
                </td>
                <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{u.label || u.tg_first_name || u.tg_username || '—'}</td>
                <td className="px-4 py-2">
                  <select
                    value={u.role}
                    disabled={u.is_self}
                    onChange={e => update.mutate({ tg_id: u.tg_id, p: { role: e.target.value } })}
                    className="bg-transparent text-slate-700 dark:text-slate-300 outline-none"
                  >
                    <option value="admin">Админ</option>
                    <option value="editor">Редактор</option>
                    <option value="viewer">Читатель</option>
                  </select>
                </td>
                <td className="px-4 py-2">
                  <UserWorkspaces tgId={u.tg_id} memberships={memberships} />
                </td>
                <td className="px-4 py-2 text-xs">
                  {!u.has_telegram ? (
                    <span className="text-slate-400" title="Без Telegram уведомления невозможны">нет Telegram</span>
                  ) : u.tg_chat_ready ? (
                    <span className="text-emerald-600">подключён</span>
                  ) : (
                    <span className="text-amber-600">нужен /start боту</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {!u.is_self && (
                    <button onClick={() => confirm('Удалить?') && remove.mutate(u.tg_id)} className="text-red-500 hover:text-red-700 text-xs">удалить</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// VK ID: показываем привязанный или кнопку привязать, по клику - инпут
function VkIdCell({ user, onSave }: { user: UserRow; onSave: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(user.vk_id ? String(user.vk_id) : '')

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    const next = trimmed ? Number(trimmed) : null
    if (trimmed && !Number.isFinite(next)) return
    if (next !== user.vk_id) onSave(next)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        placeholder="VK ID"
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(user.vk_id ? String(user.vk_id) : ''); setEditing(false) }
        }}
        className="w-28 bg-slate-50 dark:bg-brand-950/60 border border-brand-400 rounded px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`text-xs ${user.vk_id ? 'text-slate-700 dark:text-slate-300 hover:text-brand-600' : 'text-slate-400 hover:text-brand-600'}`}
      title={user.vk_id ? 'Изменить или отвязать' : 'Привязать VK ID'}
    >
      {user.vk_id ?? '+ привязать'}
    </button>
  )
}

const WS_ROLE_SHORT: Record<WorkspaceRole, string> = {
  owner: 'влад.',
  lead: 'рук.',
  viewer: 'набл.',
}

// проекты одного человека: бейджи с ролью, крестик убрать, плюс добавить в ещё один
function UserWorkspaces({ tgId, memberships }: { tgId: number; memberships: Membership[] }) {
  const qc = useQueryClient()
  const { data: workspaces = [] } = useQuery({ queryKey: ['workspaces'], queryFn: workspacesApi.list })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mine = memberships.filter(m => m.tgId === tgId)
  const available = workspaces.filter(w => !mine.some(m => m.workspaceId === w.id))

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workspace-members'] })

  const invite = useMutation({
    mutationFn: ({ wsId, role }: { wsId: number; role: WorkspaceRole }) =>
      workspacesApi.invite(wsId, tgId, role),
    onSuccess: () => { invalidate(); setAdding(false); setError(null) },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось добавить'),
  })

  const kick = useMutation({
    mutationFn: (wsId: number) => workspacesApi.removeMember(wsId, tgId),
    onSuccess: invalidate,
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось убрать'),
  })

  return (
    <div className="flex flex-wrap items-center gap-1">
      {mine.map(m => (
        <span
          key={m.workspaceId}
          className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-brand-900 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full"
        >
          {m.workspaceTitle}
          <span className="text-slate-400">{WS_ROLE_SHORT[m.role]}</span>
          {m.role !== 'owner' && (
            <button
              onClick={() => confirm(`Убрать из «${m.workspaceTitle}»?`) && kick.mutate(m.workspaceId)}
              className="text-slate-400 hover:text-red-500"
              title="Убрать из проекта"
            >
              ✕
            </button>
          )}
        </span>
      ))}

      {mine.length === 0 && !adding && <span className="text-xs text-slate-400">нет доступа</span>}

      {adding ? (
        <select
          autoFocus
          defaultValue=""
          onChange={e => {
            if (e.target.value) invite.mutate({ wsId: Number(e.target.value), role: 'viewer' })
          }}
          onBlur={() => setAdding(false)}
          className="text-xs bg-slate-50 dark:bg-brand-950/60 border border-brand-400 rounded px-1 py-0.5 text-slate-900 dark:text-slate-100"
        >
          <option value="">выбрать проект…</option>
          {available.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      ) : (
        available.length > 0 && (
          <button
            onClick={() => { setAdding(true); setError(null) }}
            className="text-xs w-5 h-5 flex items-center justify-center rounded-full bg-brand-600 hover:bg-brand-700 text-white"
            title="Добавить в проект"
          >
            +
          </button>
        )
      )}
      {error && <span className="text-xs text-red-500 w-full">{error}</span>}
    </div>
  )
}
