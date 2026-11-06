/**
 * Default valuation assumptions and the input merge used by every client.
 *
 * Moved here from stockkitty's web store (loadCompany / recalculate) so the
 * web app and the mobile app can't drift: both seed assumptions and build
 * runValuation inputs through these two functions.
 */

export const DEFAULT_ASSUMPTIONS = {
  taxRate:          0.21,
  longTermGrowth:   0.025,
  rm:               0.095,
  // Last-resort fallback only (ASM-10): the financials response carries the
  // live 10-year Treasury yield (riskFreeRate), which deriveAssumptions
  // prefers. Keep in sync with backend market_config.RISK_FREE_RATE.
  rf:               0.043,
  capExpEfficiency: 1.0,
}

/**
 * Starting assumptions for a company, derived from its financials response.
 * The user may then edit any of them.
 */
export function deriveAssumptions(financials) {
  // Cost of debt = avg interest / avg debt, period-matched, capped at 20%
  // and floored at 1% — mirrors batch/runner._build_inputs (ASM-3/ASM-6).
  const rd = (() => {
    const intExp = financials.interestExpense || []
    const debtSeries = (financials.totalDebtSeries || financials.longTermDebtSeries || [])
      .filter((v) => v && v > 0)
    const avgDebt = debtSeries.length
      ? debtSeries.reduce((s, v) => s + v, 0) / debtSeries.length
      : (financials.debt || 0)
    const raw = (intExp.length && avgDebt > 0)
      ? intExp.reduce((s, v) => s + v, 0) / intExp.length / avgDebt
      : 0.05
    return Math.max(Math.min(raw, 0.20), 0.01)
  })()

  return {
    ...DEFAULT_ASSUMPTIONS,
    // Live 10-year Treasury yield attached by the backend (ASM-10) so clients
    // discount with the same rf the nightly batch used.
    rf:          financials.riskFreeRate || DEFAULT_ASSUMPTIONS.rf,
    // Company's own effective tax rate when the backend derived one (ASM-8);
    // falls back to the 21% statutory default.
    taxRate:     financials.effectiveTaxRate || DEFAULT_ASSUMPTIONS.taxRate,
    // Clamped to [0.2, 3.0] like the batch runner (ASM-7) — Yahoo betas
    // arrive unclamped and occasionally negative or extreme.
    beta:        Math.min(Math.max(financials.beta || 1.0, 0.2), 3.0),
    roic:        financials.roic        || 0.10,
    roe:         financials.roe         || 0.10,
    payoutRatio: financials.payoutRatio || 0.05,
    rd,
    salesGrowth: (() => {
      const rev = financials.revenue || []
      if (rev.length >= 2 && rev[0] > 0) {
        return Math.min(((rev[rev.length - 1] / rev[0]) ** (1 / (rev.length - 1)) - 1) * 0.7, 0.5)
      }
      return 0.05
    })(),
  }
}

/**
 * Depreciation out of the cost lines (COST-2). The models compute
 * EBT = revenue − costOfRevenue − opEx − depreciation − interest (the course
 * spreadsheet's layout, where opEx excludes D&A). Costs built from SEC
 * filings include D&A — stockkitty derives opEx as revenue − cost of revenue
 * − operating income, and operating income is after D&A — so feeding them in
 * as-is subtracts D&A twice. Per year, D&A comes out of opEx first (down to
 * 0), then out of cost of revenue (manufacturers carry it in COGS), so
 * revenue − C − O − D still equals the company's reported operating income.
 *
 * Only for EDGAR-sourced financials (source "edgar…"): other providers'
 * cost conventions aren't verified, and netting where D&A is NOT embedded
 * would overstate value. Mirrors backend batch/runner
 * net_depreciation_from_costs — keep the two identical.
 *
 * @returns {{ costOfRevenue: number[], opEx: number[] }}
 */
export function netDepreciationFromCosts(financials) {
  const cor = financials.costOfRevenue || []
  const opex = financials.opEx || []
  const dep = financials.depreciation || []
  const outC = [...cor]
  const outO = [...opex]
  if (!String(financials.source || '').startsWith('edgar')) return { costOfRevenue: outC, opEx: outO }
  for (let i = 0; i < Math.min(outO.length, dep.length); i++) {
    const d = dep[i]
    if (!(d > 0)) continue
    const fromOpex = Math.min(d, Math.max(outO[i] || 0, 0))
    outO[i] = (outO[i] || 0) - fromOpex
    const rest = d - fromOpex
    if (rest > 0 && i < outC.length) {
      outC[i] = (outC[i] || 0) - Math.min(rest, Math.max(outC[i] || 0, 0))
    }
  }
  return { costOfRevenue: outC, opEx: outO }
}

/**
 * Inputs for runValuation. Assumptions are spread LAST: they overlap the
 * financials on beta / roe / roic / payoutRatio (deriveAssumptions seeds them
 * from the financials), and the user's edits must win over the raw fetched
 * values. A financials-last merge silently discards every edit to those keys.
 */
export function buildValuationInputs(financials, assumptions) {
  return {
    ...financials,
    // EDGAR-sourced costs include D&A; take it out once (COST-2).
    ...(String(financials.source || '').startsWith('edgar') ? netDepreciationFromCosts(financials) : {}),
    ...assumptions,
    sharesOutstanding:  financials.sharesOutstanding,
    currentMarketPrice: financials.currentMarketPrice,
  }
}
