/**
 * Free Cash Flow (FCF) Valuation Model
 *
 * Mirrors the "Free Cash Flow Valuation" section of the spreadsheet.
 * Projects 10 years of FCF, discounts at WACC, adds terminal value.
 *
 * @param {object} inputs
 * @param {number}   inputs.taxRate           Effective tax rate (e.g. 0.35)
 * @param {number}   inputs.salesGrowth       Forecasted 5-yr sales growth (e.g. 0.74)
 * @param {number}   inputs.longTermGrowth    Terminal growth rate (e.g. 0.03)
 * @param {number}   inputs.rm               Expected market return (e.g. 0.10)
 * @param {number}   inputs.rd               Cost of debt (e.g. 0.09)
 * @param {number}   inputs.rf               Risk-free rate (e.g. 0.04)
 * @param {number}   inputs.beta             Equity beta (e.g. 1.69)
 * @param {number}   inputs.debt             Long-term debt from balance sheet
 * @param {number}   inputs.equity           Total stockholders' equity from balance sheet
 * @param {number}   inputs.nppe             Net property, plant & equipment
 * @param {number}   inputs.capExpEfficiency  CapEx efficiency factor (1 = no reduction)
 * @param {number}   inputs.sharesOutstanding
 * @param {number[]} inputs.revenue          4 years of historical revenue [oldest → newest]
 * @param {number[]} inputs.costOfRevenue    4 years historical
 * @param {number[]} inputs.opEx             4 years historical (total operating expenses)
 * @param {number[]} inputs.depreciation     4 years historical (from cash flow statement)
 * @param {number[]} inputs.interestExpense  4 years historical
 * @param {number[]} inputs.capEx            4 years historical
 * @param {number[]} inputs.currentAssets    4 years historical
 * @param {number[]} inputs.currentLiabilities 4 years historical
 *
 * @returns {object} { firmValue, pricePerShare, wacc, projections }
 */

import { avgRatio, projectRevenue, calcWACC, waccEquityWeight, pv, terminalValue } from './utils.js'

export function fcfValuation(inputs) {
  const {
    taxRate, salesGrowth, longTermGrowth,
    rm, rd, rf, beta,
    debt, equity, nppe, capExpEfficiency = 1, cash = 0,
    sharesOutstanding,
    revenue, costOfRevenue, opEx, depreciation,
    interestExpense, capEx, currentAssets, currentLiabilities,
  } = inputs

  // Market-equity weights when marketCap is present (ASM-4) — see utils.js.
  const wacc = calcWACC({ debt, equity: waccEquityWeight(inputs), rd, rf, rm, beta, taxRate })

  // Historical NWC and changes
  const nwc = currentAssets.map((ca, i) => ca - currentLiabilities[i])
  const nwcChanges = nwc.slice(1).map((n, i) => n - nwc[i]) // 3 changes from 4 years

  // Average historical ratios to revenue
  const costRatio  = avgRatio(costOfRevenue, revenue)
  const opExRatio  = avgRatio(opEx, revenue)
  const deprRatio  = avgRatio(depreciation, revenue)
  const intRatio   = avgRatio(interestExpense, revenue)
  const capExRatio = avgRatio(capEx, revenue)
  const nwcRatio   = avgRatio(nwcChanges, revenue.slice(1)) // 3-period avg

  // Base year values (most recent historical year)
  const baseRevenue = revenue[revenue.length - 1]

  // Project 10 years of revenue (growth fades salesGrowth → longTermGrowth, VAL-6)
  const projRevenue = projectRevenue(baseRevenue, salesGrowth, longTermGrowth)

  // Build year-by-year projections
  const years = projRevenue.map((rev, i) => {
    const yr = i + 1

    const cogs        = rev * costRatio
    const opExProj    = rev * opExRatio
    const deprProj    = rev * deprRatio
    const intExp      = rev * intRatio
    const ebt         = rev - cogs - opExProj - deprProj - intExp
    const taxes       = Math.max(ebt * taxRate, 0)
    const eat         = ebt - taxes
    const grossCF     = eat + deprProj
    const capExProj   = rev * capExRatio * capExpEfficiency
    const nwcChange   = rev * nwcRatio
    const afterTaxInt = (1 - taxRate) * intExp
    const fcf         = grossCF - capExProj - nwcChange + afterTaxInt

    return { year: yr, revenue: rev, ebt, taxes, eat, grossCF, capExProj, nwcChange, afterTaxInt, fcf }
  })

  // Terminal value at end of year 10
  const lastFCF = years[9].fcf
  const tv = terminalValue(lastFCF, longTermGrowth, wacc)

  // Present values — year 1 discounted 1 period, year 2 two periods, etc.
  const pvFCFs = years.map(({ fcf }, i) => pv(fcf, wacc, i + 1))
  const pvTV   = pv(tv, wacc, 10)

  // Firm/enterprise value = PV of projected FCFs + PV of terminal value.
  // Previously also added an undiscounted year-0 FCF, injecting ~one extra
  // full year of cash flow at face value and inflating value. (VAL-4)
  const firmValue    = pvFCFs.reduce((s, v) => s + v, 0) + pvTV
  // Net-debt bridge (VAL-1): firm value is enterprise value; equity = EV - net
  // debt (debt - cash). Dividing firm value straight by shares over-counted
  // debtholders' claim as equity. Cash defaults to 0 (subtract gross debt).
  const pricePerShare = (firmValue - (debt - cash)) / sharesOutstanding

  return {
    model: 'FCF',
    firmValue,
    pricePerShare,
    wacc,
    terminalValue: tv,
    projections: years,
  }
}
