/**
 * Economic Profit (EP) Valuation Model
 *
 * Mirrors the "Economic Profit Valuation" section of the spreadsheet.
 * Firm Value = Invested Capital + PV of Economic Profits + PV of Terminal Value
 *
 * Economic Profit = NOPLAT - Capital Charge
 * NOPLAT = Earnings After Tax + After-tax Interest Expense
 * Capital Charge = beginning-of-year Invested Capital × WACC
 * Invested Capital = balance-sheet IC (NPPE + NWC) rolled forward along the
 *                    revenue growth glide path (VAL-2 — see comment below;
 *                    the old NOPLAT/ROIC projection is gone and `roic` is
 *                    no longer an input to this model)
 *
 * @param {object} inputs — same base inputs as FCF
 *
 * @returns {object} { firmValue, pricePerShare, wacc, projections }
 */

import { avgRatio, projectRevenue, growthPath, calcWACC, waccEquityWeight, operatingNWC, pv, terminalValue } from './utils.js'

export function epValuation(inputs) {
  const {
    taxRate, salesGrowth, longTermGrowth,
    rm, rd, rf, beta,
    debt, equity, nppe, cash = 0,
    sharesOutstanding,
    revenue, costOfRevenue, opEx, depreciation,
    interestExpense, currentAssets, currentLiabilities,
  } = inputs

  // Market-equity weights when marketCap is present (ASM-4) — see utils.js.
  const wacc = calcWACC({ debt, equity: waccEquityWeight(inputs), rd, rf, rm, beta, taxRate })

  // Initial invested capital = NPPE + operating NWC (most recent year; cash
  // excluded when the per-year series is available — ASM-9, see utils.js).
  const nwcSeries = operatingNWC(inputs)
  const latestNWC = nwcSeries[nwcSeries.length - 1]
  const initialInvestedCapital = nppe + latestNWC

  // Average historical ratios
  const costRatio = avgRatio(costOfRevenue, revenue)
  const opExRatio = avgRatio(opEx, revenue)
  const deprRatio = avgRatio(depreciation, revenue)
  const intRatio  = avgRatio(interestExpense, revenue)

  const baseRevenue = revenue[revenue.length - 1]
  const projRevenue = projectRevenue(baseRevenue, salesGrowth, longTermGrowth)

  // Base year NOPLAT (year 0 — used as starting invested capital anchor)
  const calcNOPLAT = (rev) => {
    const cogs  = rev * costRatio
    const opE   = rev * opExRatio
    const dep   = rev * deprRatio
    const inte  = rev * intRatio
    const ebt   = rev - cogs - opE - dep - inte
    const tax   = Math.max(ebt * taxRate, 0)
    const eat   = ebt - tax
    const ati   = (1 - taxRate) * inte
    return eat + ati
  }

  // Invested capital rolled forward from the balance sheet, growing with the
  // business (VAL-2). Previously IC for year i>0 was implied as prior-year
  // NOPLAT / ROIC — with ROIC frequently defaulted to 0.10 that decoupled the
  // capital charge from reality. Each year's NOPLAT is charged against
  // beginning-of-year invested capital. IC grows along the SAME glide path as
  // revenue (VAL-6) so the capital base and the sales it supports stay in step.
  const gPath = growthPath(salesGrowth, longTermGrowth)
  const icBegin = []
  let ic = initialInvestedCapital
  for (let i = 0; i < projRevenue.length; i++) {
    icBegin.push(ic)
    ic = ic * (1 + gPath[i])
  }

  const years = projRevenue.map((rev, i) => {
    const noplat        = calcNOPLAT(rev)
    const investedCap   = icBegin[i]
    const capitalCharge = investedCap * wacc
    const ep            = noplat - capitalCharge

    return { year: i + 1, revenue: rev, noplat, investedCap, capitalCharge, ep }
  })

  const lastEP = years[9].ep
  const tv     = terminalValue(lastEP, longTermGrowth, wacc)

  // PV of economic profits (year 1 discounted 1 period, etc.)
  const pvEPs = years.map(({ ep }, i) => pv(ep, wacc, i + 1))
  const pvTV  = pv(tv, wacc, 10)

  // Firm value = initial invested capital + PV of all EPs + PV of terminal value
  const firmValue     = initialInvestedCapital + pvEPs.reduce((s, v) => s + v, 0) + pvTV
  // Net-debt bridge (VAL-1): firm value is enterprise value; equity = EV - net debt.
  const pricePerShare = (firmValue - (debt - cash)) / sharesOutstanding

  return {
    model: 'EP',
    firmValue,
    pricePerShare,
    wacc,
    terminalValue: tv,
    projections: years,
  }
}
