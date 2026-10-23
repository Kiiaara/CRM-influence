// Проверка расчёта маржи: блогеру = клиентская сумма / коэффициент, маржа = клиентская - блогеру.
// Запуск: node --experimental-strip-types scripts\check_margin.mjs
import { DEFAULT_MARGIN_DIVISOR, calcMargin, parseMarginDivisor } from '../frontend/src/utils/margin.ts'

let failed = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} (получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)})`)
}

console.log('--- дефолт ---')
check('коэффициент по умолчанию', DEFAULT_MARGIN_DIVISOR, 1.375)

console.log('--- пример заказчика: 100000 на руки +25% +10% = 137500 ---')
check('137500 при 1.375', calcMargin(137500, 1.375), { toBlogger: 100000, margin: 37500, marginPercent: 27.3, manual: false })
check('коэффициент не пришёл - берём дефолт', calcMargin(137500, undefined), { toBlogger: 100000, margin: 37500, marginPercent: 27.3, manual: false })
check('коэффициент null - берём дефолт', calcMargin(137500, null), { toBlogger: 100000, margin: 37500, marginPercent: 27.3, manual: false })

console.log('--- округление до целых рублей ---')
check('100000 при 1.375', calcMargin(100000, 1.375), { toBlogger: 72727, margin: 27273, marginPercent: 27.3, manual: false })
check('сумма блогеру + маржа = клиентская', (() => { const r = calcMargin(99999, 1.375); return r.toBlogger + r.margin })(), 99999)
check('другой коэффициент 1.5', calcMargin(150000, 1.5), { toBlogger: 100000, margin: 50000, marginPercent: 33.3, manual: false })
check('коэффициент 1 - вся сумма блогеру', calcMargin(5000, 1), { toBlogger: 5000, margin: 0, marginPercent: 0, manual: false })
check('сумма 0 - нули', calcMargin(0, 1.375), { toBlogger: 0, margin: 0, marginPercent: 0, manual: false })

console.log('--- расчёт не показываем ---')
check('пустая сумма null', calcMargin(null, 1.375), null)
check('пустая сумма undefined', calcMargin(undefined, 1.375), null)
check('сумма NaN', calcMargin(NaN, 1.375), null)
check('отрицательная сумма', calcMargin(-100, 1.375), null)
check('divisor 0', calcMargin(137500, 0), null)
check('divisor отрицательный', calcMargin(137500, -1.375), null)
check('divisor NaN', calcMargin(137500, NaN), null)
check('divisor Infinity', calcMargin(137500, Infinity), null)

console.log('--- разбор поля коэффициента на экране настроек ---')
check('обычное число', parseMarginDivisor('1.375'), { value: 1.375 })
check('запятая как разделитель', parseMarginDivisor('1,4'), { value: 1.4 })
check('пробелы по краям', parseMarginDivisor(' 1.5 '), { value: 1.5 })
check('пустое поле', parseMarginDivisor('').error !== undefined, true)
check('не число', parseMarginDivisor('abc').error !== undefined, true)
check('ноль', parseMarginDivisor('0').error !== undefined, true)
check('отрицательное', parseMarginDivisor('-1').error !== undefined, true)
check('ровно 100', parseMarginDivisor('100').error !== undefined, true)
check('больше 100', parseMarginDivisor('250').error !== undefined, true)
check('99.9999 допустимо', parseMarginDivisor('99.9999'), { value: 99.9999 })
check('больше 4 знаков после запятой', parseMarginDivisor('1.37512').error !== undefined, true)

console.log('--- ручная выплата блогеру на руки ---')
check('5000 / вручную 2000', calcMargin(5000, 1.375, 2000), { toBlogger: 2000, margin: 3000, marginPercent: 60, manual: true })
check('выплата 0 - доход вся сумма', calcMargin(5000, 1.375, 0), { toBlogger: 0, margin: 5000, marginPercent: 100, manual: true })
check('выплата равна сумме - доход 0', calcMargin(5000, 1.375, 5000), { toBlogger: 5000, margin: 0, marginPercent: 0, manual: true })
check('выплата больше суммы игнорируется', calcMargin(5000, 1.375, 6000), { toBlogger: 3636, margin: 1364, marginPercent: 27.3, manual: false })
check('выплата отрицательная игнорируется', calcMargin(5000, 1.375, -1), { toBlogger: 3636, margin: 1364, marginPercent: 27.3, manual: false })
check('выплата NaN игнорируется', calcMargin(5000, 1.375, NaN), { toBlogger: 3636, margin: 1364, marginPercent: 27.3, manual: false })
check('выплата null - прежнее поведение', calcMargin(5000, 1.375, null), { toBlogger: 3636, margin: 1364, marginPercent: 27.3, manual: false })
check('выплата undefined - прежнее поведение', calcMargin(5000, 1.375, undefined), { toBlogger: 3636, margin: 1364, marginPercent: 27.3, manual: false })
check('ручная выплата при сумме 0: процент 0', calcMargin(0, 1.375, 0), { toBlogger: 0, margin: 0, marginPercent: 0, manual: true })
check('ручная выплата не требует рабочего коэффициента', calcMargin(5000, undefined, 2000).manual, true)
check('сумма пустая - расчёта нет даже с выплатой', calcMargin(null, 1.375, 2000), null)

console.log(failed ?`\n${failed} провалов` : '\nвсё зелёное')
process.exit(failed ? 1 : 0)
