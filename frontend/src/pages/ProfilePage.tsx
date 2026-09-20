import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '../api/auth'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Админ',
  editor: 'Редактор',
  viewer: 'Читатель',
}

export default function ProfilePage() {
  const qc = useQueryClient()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me })
  const { data: config } = useQuery({ queryKey: ['auth-config'], queryFn: authApi.config })
  const [label, setLabel] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (me) setLabel(me.label ?? '')
  }, [me])

  const save = useMutation({
    mutationFn: (value: string) => authApi.updateMe(value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  if (!me) return null

  return (
    <div className="p-4 sm:p-10 max-w-2xl">
      <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 mb-2">Личный кабинет</h1>
      <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">Твоё имя, роль в CRM и статус бота-уведомлений.</p>

      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-5 space-y-5">
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400">Имя</label>
          <div className="flex gap-2 mt-1">
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Как тебя называть в CRM"
              className="flex-1 bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
            />
            <button
              onClick={() => label.trim() && save.mutate(label.trim())}
              disabled={!label.trim() || save.isPending}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium shrink-0"
            >
              Сохранить
            </button>
          </div>
          {saved && <div className="text-xs text-emerald-600 mt-1">Сохранено</div>}
        </div>

        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400">Роль</label>
          <div className="mt-1 text-slate-900 dark:text-slate-100">
            {ROLE_LABELS[me.role] ?? me.role}
            <span className="text-xs text-slate-400 ml-2">роль назначает администратор</span>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400">Бот-уведомления</label>
          <div className="mt-1">
            {me.tg_chat_ready ? (
              <span className="text-sm text-emerald-600">✓ Подключён — бот шлёт уведомления в Telegram</span>
            ) : (
              <div className="text-sm">
                <span className="text-amber-600">Не подключён</span>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Напиши боту {config?.bot_username ? <a href={`https://t.me/${config.bot_username}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">@{config.bot_username}</a> : ''} команду <code className="bg-slate-100 dark:bg-brand-900 px-1.5 py-0.5 rounded">/start</code>, чтобы получать напоминания по интеграциям.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
