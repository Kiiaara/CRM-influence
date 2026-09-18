import { useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tasksApi } from '../api/tasks'
import type { Task } from '../api/tasks'
import { usersApi } from '../api/users'

export default function CalendarPage() {
  const qc = useQueryClient()
  const calRef = useRef<any>(null)
  const [editing, setEditing] = useState<Task | null>(null)

  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => tasksApi.list() })
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })

  const create = useMutation({
    mutationFn: tasksApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const update = useMutation({
    mutationFn: ({ id, p }: { id: number; p: Partial<Task> }) => tasksApi.update(id, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const remove = useMutation({
    mutationFn: tasksApi.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setEditing(null)
    },
  })

  const events = tasks
    .filter(t => t.due_at)
    .map(t => ({
      id: String(t.id),
      title: (t.status === 'done' ? '✓ ' : '') + t.title,
      start: t.due_at!,
      backgroundColor: t.status === 'done' ? '#94a3b8' : t.status === 'doing' ? '#f59e0b' : '#3b82f6',
      borderColor: 'transparent',
    }))

  return (
    <div className="p-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">Календарь задач</h1>
        <button
          onClick={() => setEditing({ id: 0, title: '', description: '', due_at: new Date().toISOString().slice(0, 16), status: 'todo', assignee_tg_id: null, created_at: '' })}
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Новая задача
        </button>
      </div>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 [&_.fc]:text-slate-800 dark:[&_.fc]:text-slate-200 [&_.fc-button-primary]:!bg-brand-600 [&_.fc-button-primary]:!border-brand-600 dark:[&_.fc-theme-standard_td]:!border-slate-800 dark:[&_.fc-theme-standard_th]:!border-slate-800 dark:[&_.fc-scrollgrid]:!border-slate-800">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale="ru"
          firstDay={1}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          buttonText={{ today: 'Сегодня', month: 'Месяц', week: 'Неделя', day: 'День' }}
          events={events}
          editable
          selectable
          height={650}
          dateClick={(info) => {
            setEditing({ id: 0, title: '', description: '', due_at: info.dateStr.length === 10 ? info.dateStr + 'T12:00' : info.dateStr.slice(0, 16), status: 'todo', assignee_tg_id: null, created_at: '' })
          }}
          eventClick={(info) => {
            const t = tasks.find(x => String(x.id) === info.event.id)
            if (t) setEditing({ ...t, due_at: t.due_at ? t.due_at.slice(0, 16) : null })
          }}
          eventDrop={(info) => {
            const id = Number(info.event.id)
            update.mutate({ id, p: { due_at: info.event.startStr } })
          }}
        />
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
            {editing.id ? 'Задача' : 'Новая задача'}
          </h2>
          <div className="space-y-3">
            <input
              value={editing.title}
              onChange={e => setEditing({ ...editing, title: e.target.value })}
              placeholder="Что сделать"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-brand-500 text-slate-900 dark:text-slate-100"
            />
            <textarea
              value={editing.description}
              onChange={e => setEditing({ ...editing, description: e.target.value })}
              placeholder="Описание"
              rows={3}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-brand-500 text-slate-900 dark:text-slate-100"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400">Дедлайн</label>
                <input
                  type="datetime-local"
                  value={editing.due_at ?? ''}
                  onChange={e => setEditing({ ...editing, due_at: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400">Статус</label>
                <select
                  value={editing.status}
                  onChange={e => setEditing({ ...editing, status: e.target.value as Task['status'] })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
                >
                  <option value="todo">Сделать</option>
                  <option value="doing">В работе</option>
                  <option value="done">Готово</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Кому</label>
              <select
                value={editing.assignee_tg_id ?? ''}
                onChange={e => setEditing({ ...editing, assignee_tg_id: e.target.value ? Number(e.target.value) : null })}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
              >
                <option value="">— не назначено —</option>
                {users.map(u => (
                  <option key={u.tg_id} value={u.tg_id}>
                    {u.label || u.tg_first_name || u.tg_username || `id ${u.tg_id}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-between mt-6">
            <div>
              {editing.id !== 0 && (
                <button onClick={() => confirm('Удалить задачу?') && remove.mutate(editing.id)} className="text-red-500 hover:text-red-700 text-sm">
                  Удалить
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Отмена</button>
              <button
                onClick={async () => {
                  if (!editing.title.trim()) return
                  if (editing.id === 0) {
                    await create.mutateAsync({
                      title: editing.title,
                      description: editing.description,
                      due_at: editing.due_at || null,
                      status: editing.status,
                      assignee_tg_id: editing.assignee_tg_id,
                    })
                  } else {
                    await update.mutateAsync({
                      id: editing.id,
                      p: {
                        title: editing.title,
                        description: editing.description,
                        due_at: editing.due_at || null,
                        status: editing.status,
                        assignee_tg_id: editing.assignee_tg_id,
                      },
                    })
                  }
                  setEditing(null)
                }}
                className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Сохранить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
