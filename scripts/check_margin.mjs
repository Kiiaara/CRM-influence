// Проверка расчёта маржи: блогеру = клиентская сумма / коэффициент, маржа = клиентская - блогеру.
// Запуск: node --experimental-strip-types scripts\check_margin.mjs
import { DEFAULT_MARGIN_DIVISOR, calcMargin } from '../frontend/src/utils/margin.ts'

let failed = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} (получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)})`)
}

console.log('--- дефолт ---')
check('коэффициент по умолчанию', DEFAULT_MARGIN_DIVISOR, 1.375)

console.log('--- пример заказчика: 100000 на руки +25% +10% = 137500 ---')
check('137500 при 1.375', calcMargin(137500, 1.375), { toBlogger: 100000, margin: 37500, marginPercent: 27.3 })
check('коэффициент не пришёл - берём дефолт', calcMargin(137500, undefined), { toBlogger: 100000, margin: 37500, marginPercent: 27.3 })
check('коэффициент null - берём дефолт', calcMargin(137500, null), { toBlogger: 100000, margin: 37500, marginPercent: 27.3 })

console.log('--- округление до целых рублей ---')
check('100000 при 1.375', calcMargin(100000, 1.375), { toBlogger: 72727, margin: 27273, marginPercent: 27.3 })
check('сумма блогеру + маржа = клиентская', (() => { const r = calcMargin(99999, 1.375); return r.toBlogger + r.margin })(), 99999)
check('другой коэффициент 1.5', calcMargin(150000, 1.5), { toBlogger: 100000, margin: 50000, marginPercent: 33.3 })
check('коэффициент 1 - вся сумма блогеру', calcMargin(5000, 1), { toBlogger: 5000, margin: 0, marginPercent: 0 })
check('сумма 0 - нули', calcMargin(0, 1.375), { toBlogger: 0, margin: 0, marginPercent: 0 })

console.log('--- расчёт не показываем ---')
check('пустая сумма null', calcMargin(null, 1.375), null)
check('пустая сумма undefined', calcMargin(undefined, 1.375), null)
check('сумма NaN', calcMargin(NaN, 1.375), null)
check('отрицательная сумма', calcMargin(-100, 1.375), null)
check('divisor 0', calcMargin(137500, 0), null)
check('divisor отрицательный', calcMargin(137500, -1.375), null)
check('divisor NaN', calcMargin(137500, NaN), null)
check('divisor Infinity', calcMargin(137500, Infinity), null)

console.log(failed ? `\n${failed} провалов` : '\nвсё зелёное')
process.exit(failed ? 1 : 0)
