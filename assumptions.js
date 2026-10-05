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
 * Inputs for runValuation. Assumptions are spread LAST: they overlap the
 * financials on beta / roe / roic / payoutRatio (deriveAssumptions seeds them
 * from the financials), and the user's edits must win over the raw fetched
 * values. A financials-last merge silently discards every edit to those keys.
 */
export function buildValuationInputs(financials, assumptions) {
  return {
    ...financials,
    ...assumptions,
    sharesOutstanding:  financials.sharesOutstanding,
    currentMarketPrice: financials.currentMarketPrice,
  }
}
