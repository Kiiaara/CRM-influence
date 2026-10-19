// Расчёт маржи по клиентской сумме. Чистые функции без React, чтобы проверять их
// скриптом scripts/check_margin.mjs.
// Логика: блогер хочет N на руки, мы накидываем 25% комиссии и ещё 10% - получается
// клиентская сумма (N * 1,25 * 1,10 = N * 1,375). Обратно: блогеру = клиентская / 1,375.

// дефолт коэффициента, совпадает с Workspace.margin_divisor на бэке
export const DEFAULT_MARGIN_DIVISOR = 1.375

export type Margin = {
  toBlogger: number // блогеру на руки, целые рубли
  margin: number // наша маржа, целые рубли
  marginPercent: number // маржа в процентах от клиентской суммы, один знак после запятой
}

// Возвращает null, когда считать нельзя: сумма пустая/некорректная или коэффициент <= 0
// (деление на ноль и отрицательный делитель дали бы мусор). Коэффициент не пришёл - дефолт.
export function calcMargin(
  amount: number | null | undefined,
  divisor: number | null | undefined,
): Margin | null {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null
  const d = divisor ?? DEFAULT_MARGIN_DIVISOR
  if (!Number.isFinite(d) || d <= 0) return null

  const toBlogger = Math.round(amount / d)
  // маржу считаем вычитанием из округлённой суммы, чтобы блогеру + маржа сходились с клиентской
  const margin = Math.round(amount) - toBlogger
  // от нулевой суммы процент не определён - показываем 0
  const marginPercent = amount === 0 ? 0 : Math.round((1 - 1 / d) * 1000) / 10
  return { toBlogger, margin, marginPercent }
}

// Верхняя граница коэффициента, совпадает с MAX_MARGIN_DIVISOR на бэке (колонка Numeric(6,4))
export const MAX_MARGIN_DIVISOR = 100

// Разбор поля коэффициента на экране настроек. Те же правила, что на бэке (> 0 и < 100),
// плюс не больше 4 знаков после запятой - столько хранит колонка. Запятая тоже принимается.
export function parseMarginDivisor(raw: string): { value: number } | { error: string } {
  const text = raw.trim().replace(',', '.')
  if (!text) return { error: 'Введите коэффициент, например 1,375' }
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { error: 'Коэффициент - это число, например 1,375. Минус и буквы не подходят' }
  }
  const value = Number(text)
  if (!(value > 0)) return { error: 'Коэффициент должен быть больше нуля: на ноль делить нельзя' }
  if (value >= MAX_MARGIN_DIVISOR) {
    return { error: `Коэффициент должен быть меньше ${MAX_MARGIN_DIVISOR}` }
  }
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return { error: 'Не больше 4 знаков после запятой' }
  return { value }
}

// "27,3" вместо "27.3" - как принято в интерфейсе
export const fmtPercent = (p: number) => p.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
