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

// "27,3" вместо "27.3" - как принято в интерфейсе
export const fmtPercent = (p: number) => p.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
