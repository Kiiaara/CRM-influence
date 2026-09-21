import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { tasksApi, TASK_STATUS_LABELS, TASK_STATUS_COLORS } from '../api/tasks'
import type { Task, TaskStatus } from '../api/tasks'

type View = 'calendar' | 'list'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const inputCls =
  'w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100'

export default function TasksPage() {
  const qc = useQueryClient()
  const [view, setView] = useState<View>('calendar')
  const [month, setMonth] = useState(() => dayjs().startOf('month'))
  const [editing, setEditing] = useState<Partial<Task> | null>(null)
  const [hideDone, setHideDone] = useState(false)

  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => tasksApi.list() })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] })

  const update = useMutation({
    mutationFn: ({ id, p }: { id: number; p: Parameters<typeof tasksApi.update>[1] }) => tasksApi.update(id, p),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: number) => tasksApi.remove(id),
    onSuccess: invalidate,
  })

  const visible = hideDone ? tasks.filter(t => t.status !== 'done') : tasks
  const openCount = tasks.filter(t => t.status !== 'done').length

  return (
    <div className="p-4 sm:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Задачи</h1>
        <button
          onClick={() => setEditing({ status: 'todo', due_at: dayjs().format('YYYY-MM-DDTHH:mm') })}
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium w-full sm:w-auto"
        >
          + Новая задача
        </button>
      </div>
      <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">
        Открытых: {openCount}. Исполнителю придёт уведомление в Telegram сразу и ещё раз за полчаса до дедлайна.
      </p>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-2">
          <button
            onClick={() => setView('calendar')}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              view === 'calendar' ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Календарь
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              view === 'list' ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-200 dark:border-brand-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Список
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 ml-auto cursor-pointer">
          <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} />
          Скрыть готовые
        </label>
      </div>

      {view === 'calendar' ? (
        <CalendarView
          month={month}
          tasks={visible}
          onPrev={() => setMonth(m => m.subtract(1, 'month'))}
          onNext={() => setMonth(m => m.add(1, 'month'))}
          onToday={() => setMonth(dayjs().startOf('month'))}
          onPickDay={day => setEditing({ status: 'todo', due_at: day.hour(12).minute(0).format('YYYY-MM-DDTHH:mm') })}
          onOpen={setEditing}
        />
      ) : (
        <ListView
          tasks={visible}
          onOpen={setEditing}
          onToggle={t => update.mutate({ id: t.id, p: { status: t.status === 'done' ? 'todo' : 'done' } })}
          onRemove={id => confirm('Удалить задачу?') && remove.mutate(id)}
        />
      )}

      {editing && <TaskModal task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ---------- календарь ----------

function CalendarView({
  month,
  tasks,
  onPrev,
  onNext,
  onToday,
  onPickDay,
  onOpen,
}: {
  month: dayjs.Dayjs
  tasks: Task[]
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onPickDay: (d: dayjs.Dayjs) => void
  onOpen: (t: Task) => void
}) {
  // сетка всегда с понедельника, поэтому смещаем на (day+6)%7
  const days = useMemo(() => {
    const first = month.startOf('month')
    const start = first.subtract((first.day() + 6) % 7, 'day')
    return Array.from({ length: 42 }).map((_, i) => start.add(i, 'day'))
  }, [month])

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.due_at) continue
      const key = dayjs(t.due_at).format('YYYY-MM-DD')
      map.set(key, [...(map.get(key) ?? []), t])
    }
    return map
  }, [tasks])

  const noDate = tasks.filter(t => !t.due_at)
  const today = dayjs().format('YYYY-MM-DD')

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-medium text-slate-900 dark:text-slate-100 capitalize">
          {month.format('MMMM YYYY')}
        </div>
        <div className="flex gap-1">
          <button onClick={onPrev} className="px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900">‹</button>
          <button onClick={onToday} className="px-3 py-1 rounded-lg text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900">Сегодня</button>
          <button onClick={onNext} className="px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900">›</button>
        </div>
      </div>

      <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 bg-slate-50 dark:bg-brand-900/50">
          {WEEKDAYS.map(d => (
            <div key={d} className="px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map(d => {
            const key = d.format('YYYY-MM-DD')
            const dayTasks = byDay.get(key) ?? []
            const otherMonth = d.month() !== month.month()
            const isToday = key === today
            return (
              <div
                key={key}
                onClick={() => onPickDay(d)}
                className={`min-h-[84px] border-t border-r border-slate-100 dark:border-brand-900 p-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-brand-900/30 ${
                  otherMonth ? 'bg-slate-50/50 dark:bg-brand-950/40' : ''
                }`}
              >
                <div
                  className={`text-xs mb-1 w-5 h-5 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-brand-600 text-white' : otherMonth ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {d.date()}
                </div>
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 3).map(t => (
                    <div
                      key={t.id}
                      onClick={e => { e.stopPropagation(); onOpen(t) }}
                      title={t.assignee_label ? `${t.title} · ${t.assignee_label}` : t.title}
                      className={`text-[11px] px-1 py-0.5 rounded truncate ${TASK_STATUS_COLORS[t.status]} ${
                        t.status === 'done' ? 'line-through opacity-60' : ''
                      }`}
                    >
                      {t.title}
                    </div>
                  ))}
                  {dayTasks.length > 3 && (
                    <div className="text-[11px] text-slate-400 px-1">ещё {dayTasks.length - 3}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {noDate.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Без срока</div>
          <div className="flex flex-wrap gap-1.5">
            {noDate.map(t => (
              <button
                key={t.id}
                onClick={() => onOpen(t)}
                className={`text-xs px-2 py-1 rounded-full ${TASK_STATUS_COLORS[t.status]}`}
              >
                {t.title}
                {t.assignee_label && <span className="opacity-60"> · {t.assignee_label}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- список ----------

function ListView({
  tasks,
  onOpen,
  onToggle,
  onRemove,
}: {
  tasks: Task[]
  onOpen: (t: Task) => void
  onToggle: (t: Task) => void
  onRemove: (id: number) => void
}) {
  const now = dayjs()
  const groups = useMemo(() => {
    const overdue: Task[] = []
    const today: Task[] = []
    const later: Task[] = []
    const noDate: Task[] = []
    for (const t of tasks) {
      if (!t.due_at) { noDate.push(t); continue }
      const d = dayjs(t.due_at)
      if (t.status !== 'done' && d.isBefore(now, 'day')) overdue.push(t)
      else if (d.isSame(now, 'day')) today.push(t)
      else later.push(t)
    }
    const byDate = (a: Task, b: Task) => dayjs(a.due_at).valueOf() - dayjs(b.due_at).valueOf()
    return [
      { key: 'overdue', title: 'Просрочено', items: overdue.sort(byDate) },
      { key: 'today', title: 'Сегодня', items: today.sort(byDate) },
      { key: 'later', title: 'Дальше', items: later.sort(byDate) },
      { key: 'noDate', title: 'Без срока', items: noDate },
    ].filter(g => g.items.length > 0)
  }, [tasks, now])

  if (groups.length === 0) {
    return <div className="text-sm text-slate-400 text-center py-10">Задач пока нет</div>
  }

  return (
    <div className="space-y-4">
      {groups.map(g => (
        <div key={g.key}>
          <div className={`text-xs mb-2 uppercase tracking-wide ${g.key === 'overdue' ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
            {g.title} · {g.items.length}
          </div>
          <div className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl divide-y divide-slate-100 dark:divide-brand-900">
            {g.items.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={t.status === 'done'}
                  onChange={() => onToggle(t)}
                  className="shrink-0"
                />
                <button onClick={() => onOpen(t)} className="flex-1 text-left min-w-0">
                  <div className={`text-sm text-slate-900 dark:text-slate-100 truncate ${t.status === 'done' ? 'line-through text-slate-400' : ''}`}>
                    {t.title}
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                    {t.due_at && <span>{dayjs(t.due_at).format('DD.MM HH:mm')}</span>}
                    {t.assignee_label && <span>👤 {t.assignee_label}</span>}
                    <span className={`px-1.5 py-0.5 rounded ${TASK_STATUS_COLORS[t.status]}`}>{TASK_STATUS_LABELS[t.status]}</span>
                  </div>
                </button>
                <button onClick={() => onRemove(t.id)} className="text-slate-400 hover:text-red-500 text-xs shrink-0">✕</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- модалка ----------

function TaskModal({ task, onClose }: { task: Partial<Task>; onClose: () => void }) {
  const qc = useQueryClient()
  const isNew = !task.id
  const [title, setTitle] = useState(task.title ?? '')
  const [description, setDescription] = useState(task.description ?? '')
  const [dueAt, setDueAt] = useState(task.due_at ? dayjs(task.due_at).format('YYYY-MM-DDTHH:mm') : '')
  const [status, setStatus] = useState<TaskStatus>(task.status ?? 'todo')
  const [assignee, setAssignee] = useState<string>(task.assignee_tg_id ? String(task.assignee_tg_id) : '')
  const [error, setError] = useState<string | null>(null)

  const { data: assignees = [] } = useQuery({ queryKey: ['task-assignees'], queryFn: tasksApi.assignees })

  const done = () => {
    qc.invalidateQueries({ queryKey: ['tasks'] })
    onClose()
  }
  const fail = (e: any) => setError(e?.response?.data?.detail ?? 'Не удалось сохранить')

  const create = useMutation({
    mutationFn: () =>
      tasksApi.create({
        title: title.trim(),
        description,
        due_at: dueAt ? dayjs(dueAt).toISOString() : null,
        status,
        assignee_tg_id: assignee ? Number(assignee) : null,
      }),
    onSuccess: done,
    onError: fail,
  })

  const update = useMutation({
    mutationFn: () =>
      tasksApi.update(task.id!, {
        title: title.trim(),
        description,
        due_at: dueAt ? dayjs(dueAt).toISOString() : null,
        status,
        assignee_tg_id: assignee ? Number(assignee) : null,
      }),
    onSuccess: done,
    onError: fail,
  })

  const save = () => {
    if (!title.trim()) return
    isNew ? create.mutate() : update.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
          {isNew ? 'Новая задача' : 'Задача'}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Что сделать</label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Подробности</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={inputCls} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Кому</label>
              <select value={assignee} onChange={e => setAssignee(e.target.value)} className={inputCls}>
                <option value="">— не назначена —</option>
                {assignees.map(a => <option key={a.tg_id} value={a.tg_id}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Срок</label>
              <input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Статус</label>
            <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)} className={inputCls}>
              {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {assignee && (
            <div className="text-xs text-slate-400">
              Исполнителю уйдёт уведомление в Telegram. Если он ещё не писал боту /start, сообщение не дойдёт.
            </div>
          )}
          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={save}
            disabled={!title.trim() || create.isPending || update.isPending}
            className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {create.isPending || update.isPending ? 'Сохраняю…' : 'Сохранить'}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-brand-900">
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
