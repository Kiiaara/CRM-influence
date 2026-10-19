import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { workspacesApi } from '../api/workspaces'
import { useWorkspace } from '../workspaceContext'
import { DEFAULT_MARGIN_DIVISOR, calcMargin, fmtPercent, parseMarginDivisor } from '../utils/margin'

// клиентская сумма для живого примера: 100 000 блогеру * 1,25 * 1,10
const EXAMPLE_AMOUNT = 137500

const fmtRub = (n: number) => n.toLocaleString('ru-RU')

const card =
  'bg-white dark:bg-brand-950 border border-slate-200 dark:border-brand-900 rounded-xl p-4 sm:p-5'
const labelCls = 'text-xs text-slate-500 dark:text-slate-400'
const inputCls =
  'w-full bg-slate-50 dark:bg-brand-950/60 border border-slate-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed'
const btnCls =
  'bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium'

// человеческий текст ошибки: сырой ответ сервера пользователю не показываем
function errText(e: unknown): string {
  if (isAxiosError(e)) {
    if (e.response?.status === 403) return 'Это может менять только владелец пространства'
    if (e.response?.status === 400) return 'Сервер не принял значение, проверьте поле'
  }
  return 'Не получилось сохранить, попробуйте ещё раз'
}

export default function WorkspaceSettingsPage() {
  const qc = useQueryClient()
  const { current } = useWorkspace()
  const [title, setTitle] = useState('')
  const [divisor, setDivisor] = useState('')
  const [titleSaved, setTitleSaved] = useState(false)
  const [divisorSaved, setDivisorSaved] = useState(false)
  const [titleErr, setTitleErr] = useState<string | null>(null)
  const [divisorErr, setDivisorErr] = useState<string | null>(null)

  // подставляем значения при смене пространства и после обновления списка
  useEffect(() => {
    if (!current) return
    setTitle(current.title)
    // показываем с запятой, как принято в интерфейсе
    setDivisor(String(current.margin_divisor ?? DEFAULT_MARGIN_DIVISOR).replace('.', ','))
  }, [current?.id, current?.title, current?.margin_divisor]) // eslint-disable-line react-hooks/exhaustive-deps

  const isOwner = current?.my_role === 'owner'
  const canEditTitle = current?.my_role === 'owner' || current?.my_role === 'lead'

  // после сохранения обновляем список пространств: оттуда расчёт дохода берут модалка блогера и кампании
  const saveTitle = useMutation({
    mutationFn: (value: string) => workspacesApi.update(current!.id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      setTitleErr(null)
      setTitleSaved(true)
      setTimeout(() => setTitleSaved(false), 2000)
    },
    onError: e => setTitleErr(errText(e)),
  })

  const saveDivisor = useMutation({
    mutationFn: (value: number) => workspacesApi.updateMarginDivisor(current!.id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      setDivisorErr(null)
      setDivisorSaved(true)
      setTimeout(() => setDivisorSaved(false), 2000)
    },
    onError: e => setDivisorErr(errText(e)),
  })

  if (!current) return null

  const parsed = parseMarginDivisor(divisor)
  const parsedValue = 'value' in parsed ? parsed.value : null
  // ошибку показываем сразу, пока поле не пустое, чтобы не пугать до ввода
  const liveErr = 'error' in parsed && divisor.trim() ? parsed.error : null
  const example = calcMargin(EXAMPLE_AMOUNT, parsedValue)
  const titleTrim = title.trim()

  return (
    <div className="p-4 sm:p-10 max-w-2xl">
      <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 mb-2">Настройки</h1>
      <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">
        Название пространства и коэффициент, по которому считается наш доход.
      </p>

      <div className="space-y-4">
        <div className={card}>
          <label className={labelCls} htmlFor="ws-title">Название пространства</label>
          <div className="flex flex-col sm:flex-row gap-2 mt-1">
            <input
              id="ws-title"
              value={title}
              onChange={e => { setTitle(e.target.value); setTitleErr(null) }}
              disabled={!canEditTitle}
              maxLength={255}
              className={inputCls}
            />
            {canEditTitle && (
              <button
                onClick={() => titleTrim && saveTitle.mutate(titleTrim)}
                disabled={!titleTrim || titleTrim === current.title || saveTitle.isPending}
                className={`${btnCls} shrink-0`}
              >
                Сохранить
              </button>
            )}
          </div>
          {!canEditTitle && (
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Название меняют владелец и руководитель.
            </div>
          )}
          {titleSaved && <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Сохранено</div>}
          {titleErr && <div className="text-xs text-red-600 dark:text-red-400 mt-1">{titleErr}</div>}
        </div>

        <div className={card}>
          <label className={labelCls} htmlFor="ws-divisor">Коэффициент дохода</label>
          <div className="flex flex-col sm:flex-row gap-2 mt-1">
            <input
              id="ws-divisor"
              type="text"
              inputMode="decimal"
              value={divisor}
              onChange={e => { setDivisor(e.target.value); setDivisorErr(null) }}
              disabled={!isOwner}
              aria-invalid={!!liveErr}
              className={`${inputCls} sm:max-w-[10rem]`}
            />
            {isOwner && (
              <button
                onClick={() => parsedValue !== null && saveDivisor.mutate(parsedValue)}
                disabled={parsedValue === null || parsedValue === current.margin_divisor || saveDivisor.isPending}
                className={`${btnCls} shrink-0`}
              >
                Сохранить
              </button>
            )}
          </div>
          {!isOwner && (
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Коэффициент меняет только владелец пространства: от него зависят суммы блогерам и наш доход.
            </div>
          )}
          {liveErr && <div className="text-xs text-red-600 dark:text-red-400 mt-1">{liveErr}</div>}
          {divisorSaved && <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Сохранено</div>}
          {divisorErr && <div className="text-xs text-red-600 dark:text-red-400 mt-1">{divisorErr}</div>}

          <div className="mt-4 rounded-lg bg-brand-50 dark:bg-brand-900/30 px-3 py-2 text-sm text-slate-800 dark:text-slate-200">
            {example ? (
              <>
                При клиентской сумме {fmtRub(EXAMPLE_AMOUNT)} блогеру уйдёт {fmtRub(example.toBlogger)}, наш доход{' '}
                {fmtRub(example.margin)} ({fmtPercent(example.marginPercent)}%)
              </>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">Введите коэффициент, и здесь появится пример расчёта.</span>
            )}
          </div>

          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            Как это считается. Блогер хочет получить 100 000 на руки. Мы накидываем 25% агентских и ещё 10% сверху,
            выходит клиентская сумма 137 500. Множитель 1,25 * 1,10 = 1,375. Чтобы понять, сколько из клиентской
            суммы наши деньги, делим её на этот коэффициент: 137 500 / 1,375 = 100 000 блогеру, остальное - наш доход.
          </p>
        </div>
      </div>
    </div>
  )
}
