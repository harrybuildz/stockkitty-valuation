/**
 * Residual Earnings (RE) / Abnormal Earnings Model
 *
 * Mirrors the "Residual Earnings Model" section of the spreadsheet.
 * Firm Value = Current Book Value + PV of Abnormal Earnings + PV of Terminal Value
 *
 * Abnormal Earnings = (ROE - Re) × Book Value (Beginning of period)
 * Re = CAPM cost of equity = rf + beta × (rm - rf)
 * ROE fades to ROE/2 in years 6-10 (matching spreadsheet fade structure)
 *
 * @param {object} inputs — same base inputs as FCF, plus:
 * @param {number}   inputs.roe          Return on Equity (e.g. 0.4022)
 * @param {number}   inputs.payoutRatio  Dividend payout ratio (e.g. 0.0386)
 *
 * @returns {object} { firmValue, pricePerShare, costOfEquity, projections }
 */

import { calcCostOfEquity, pv, terminalValue } from './utils.js'

export function reValuation(inputs) {
  const {
    longTermGrowth,
    rm, rf, beta,
    equity, roe, payoutRatio,
    sharesOutstanding,
  } = inputs

  const re = calcCostOfEquity({ rf, rm, beta })

  // Cap ROE at 40% (ASM-5, mirrors backend re_valuation). ROE is derived as
  // average earnings / CURRENT book equity, so buyback-shrunken books produce
  // 100%+ readings; book compounds at roe×(1−payout) below, so an uncapped ROE
  // makes the model diverge. One-sided: low/negative ROE still expresses value
  // destruction (VAL-3).
  const roeCapped = Math.min(roe, 0.40)

  // Residual-income model, fully ROE-driven (VAL-3). Earnings = ROE × beginning
  // book value; book compounds by retained earnings (clean surplus); the
  // abnormal-earnings charge uses the SAME earnings that grow book. Previously
  // book grew off a revenue-projected EAT while the charge used ROE × book — two
  // different earnings definitions in one model. Negative residual earnings now
  // reduce value; the old code floored later-year AND terminal contributions at
  // 0, which could only bias value upward and hid post-year-5 value destruction.
  let bookValueEnd = equity
  const years = []
  for (let i = 0; i < 10; i++) {
    const yr           = i + 1
    const roeThisYear  = yr <= 5 ? roeCapped : roeCapped / 2    // fade in years 6-10
    const bookValueBeg = bookValueEnd
    const earnings     = roeThisYear * bookValueBeg
    bookValueEnd       = bookValueBeg + (1 - payoutRatio) * earnings  // retained earnings
    const abnormalEarnings = earnings - re * bookValueBeg              // = (roe - re) × BV

    years.push({ year: yr, bookValueBeg, bookValueEnd, roeThisYear, earnings, abnormalEarnings })
  }

  const lastAE = years[9].abnormalEarnings
  const tv     = terminalValue(lastAE, longTermGrowth, re)

  const pvAEs = years.map(({ abnormalEarnings }, i) => pv(abnormalEarnings, re, i + 1))
  const pvTV  = pv(tv, re, 10)

  // Firm value = current book equity + PV of abnormal earnings + PV of terminal value
  const firmValue     = equity + pvAEs.reduce((s, v) => s + v, 0) + pvTV
  const pricePerShare = firmValue / sharesOutstanding

  return {
    model: 'RE',
    firmValue,
    pricePerShare,
    costOfEquity: re,
    terminalValue: tv,
    projections: years,
  }
}
