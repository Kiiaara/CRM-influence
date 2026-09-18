import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { usersApi } from '../api/users'

export default function AdminUsersPage() {
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const [tgId, setTgId] = useState('')
  const [label, setLabel] = useState('')
  const [role, setRole] = useState('editor')

  const add = useMutation({
    mutationFn: () => usersApi.create({ tg_id: Number(tgId), role, label: label || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setTgId(''); setLabel('')
    },
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
    <div className="p-10 max-w-4xl">
      <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mb-2">Пользователи</h1>
      <p className="text-slate-500 dark:text-slate-400 mb-6">Кто может заходить и редактировать. Роли: админ - всё; редактор - писать; читатель - только смотреть.</p>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input value={tgId} onChange={e => setTgId(e.target.value)} placeholder="TG ID" className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100" />
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Имя / заметка" className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100" />
          <select value={role} onChange={e => setRole(e.target.value)} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100">
            <option value="admin">Админ</option>
            <option value="editor">Редактор</option>
            <option value="viewer">Читатель</option>
          </select>
          <button onClick={() => add.mutate()} disabled={!tgId} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
            + Добавить
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50">
            <tr>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300">TG ID</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300">Имя</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300">Роль</th>
              <th className="text-left px-4 py-2 text-slate-700 dark:text-slate-300">Бот</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.tg_id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{u.tg_id}{u.is_self && <span className="ml-2 text-xs text-brand-600">(это ты)</span>}</td>
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
                <td className="px-4 py-2 text-xs">{u.tg_chat_ready ? <span className="text-emerald-600">подключён</span> : <span className="text-amber-600">нужен /start боту</span>}</td>
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
