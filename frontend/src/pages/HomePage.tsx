import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { integrationsApi, STAGES } from '../api/integrations'
import { tasksApi } from '../api/tasks'
import { authApi } from '../api/auth'
import dayjs from 'dayjs'

export default function HomePage() {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me, retry: false })
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => tasksApi.list() })

  const cards = integrations.flatMap(it => it.streamers.map(s => ({ ...s, brand: it.brand })))
  const active = cards.filter(c => !['done', 'cancelled'].includes(c.stage))
  const toCollect = cards.reduce((sum, c) => sum + (c.commission_amount ?? 0), 0)
  const upcomingIntegrations = cards
    .filter(c => c.deadline && !['done', 'cancelled'].includes(c.stage))
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
    .slice(0, 5)
  const upcomingTasks = tasks.filter(t => t.due_at && t.status !== 'done').slice(0, 5)

  return (
    <div className="p-4 sm:p-10 max-w-6xl">
      <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mb-1">
        Привет{me?.first_name ? `, ${me.first_name}` : ''}
      </h1>
      <p className="text-slate-500 dark:text-slate-400 mb-8">Сводка по интеграциям и задачам.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon="🤝" label="Активных стримеров" value={active.length} to="/integrations" />
        <StatCard icon="💰" label="Трясти со стримеров, ₽" value={Math.round(toCollect)} to="/integrations" />
        <StatCard icon="📄" label="Брендов" value={integrations.length} to="/integrations" />
        <StatCard icon="📅" label="Открытых задач" value={tasks.filter(t => t.status !== 'done').length} to="/calendar" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Ближайшие дедлайны по интеграциям" to="/integrations">
          {upcomingIntegrations.map(c => (
            <Link key={c.id} to={`/integrations?open=${c.id}`} className="flex justify-between items-center py-2 px-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
              <span>
                <span className="font-medium">{c.brand}</span>
                <span className="text-slate-400"> × {c.streamer_name}</span>
                <span className="text-xs text-slate-400 ml-2">({STAGES.find(s => s.key === c.stage)?.label})</span>
              </span>
              <span className="text-xs text-slate-400">{dayjs(c.deadline!).format('DD.MM')}</span>
            </Link>
          ))}
          {upcomingIntegrations.length === 0 && <div className="text-sm text-slate-400 px-3 py-2">Дедлайнов нет.</div>}
        </Section>

        <Section title="Ближайшие задачи" to="/calendar">
          {upcomingTasks.map(t => (
            <div key={t.id} className="flex justify-between items-center py-2 px-3 text-sm text-slate-700 dark:text-slate-300">
              <span>
                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${t.status === 'doing' ? 'bg-amber-500' : 'bg-brand-500'}`} />
                {t.title}
              </span>
              <span className="text-xs text-slate-400">{dayjs(t.due_at!).format('DD.MM HH:mm')}</span>
            </div>
          ))}
          {upcomingTasks.length === 0 && <div className="text-sm text-slate-400 px-3 py-2">Задач нет.</div>}
        </Section>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, to }: { icon: string; label: string; value: number; to: string }) {
  return (
    <Link to={to} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-brand-400 dark:hover:border-brand-600 transition flex items-center gap-4">
      <div className="text-3xl">{icon}</div>
      <div>
        <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">{value.toLocaleString('ru-RU')}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      </div>
    </Link>
  )
}

function Section({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <Link to={to} className="text-xs text-brand-600 hover:text-brand-700">все →</Link>
      </div>
      <div>{children}</div>
    </div>
  )
}
