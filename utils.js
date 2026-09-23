/**
 * Shared utilities for valuation models.
 */

/**
 * Average ratio of a line item to revenue across historical years.
 * Filters out invalid (zero/null) years automatically.
 */
export function avgRatio(lineItemHistory, revenueHistory) {
  const ratios = lineItemHistory
    .map((val, i) => (revenueHistory[i] > 0 ? val / revenueHistory[i] : null))
    .filter((r) => r !== null)
  return ratios.reduce((sum, r) => sum + r, 0) / ratios.length
}

/**
 * Per-year growth-rate glide path (VAL-6).
 *
 * Linearly fades from an initial growth rate (year 1) down to the terminal
 * rate (final year). Previously growth stepped down from the full rate in
 * years 1-5 to half in years 6-10 — an artificial kink that also fed a
 * half-rate final year into the Gordon terminal value (whose perpetuity
 * assumes the *terminal* rate), so the projection stepped off a cliff into
 * the terminal. A linear fade removes the kink and lands the last projected
 * year exactly on the terminal rate, so the terminal value connects
 * continuously to the projection. No new inputs — uses salesGrowth and
 * longTermGrowth, both already supplied.
 *
 * @returns {number[]} `years` rates, one per projection year (year 1 first).
 */
export function growthPath(initialGrowth, terminalGrowth, years = 10) {
  if (years <= 1) return [initialGrowth]
  const path = []
  for (let yr = 1; yr <= years; yr++) {
    const t = (yr - 1) / (years - 1) // 0 at year 1 → 1 at the final year
    path.push(initialGrowth + (terminalGrowth - initialGrowth) * t)
  }
  return path
}

/**
 * Project `years` of revenue from a base year value, fading growth from
 * salesGrowth (year 1) toward longTermGrowth (final year) along the linear
 * glide path above (VAL-6).
 */
export function projectRevenue(baseRevenue, salesGrowth, longTermGrowth, years = 10) {
  const path = growthPath(salesGrowth, longTermGrowth, years)
  const revenue = []
  let prev = baseRevenue
  for (let i = 0; i < years; i++) {
    prev = prev * (1 + path[i])
    revenue.push(prev)
  }
  return revenue
}

/**
 * Equity value to use for WACC weights (ASM-4).
 *
 * Market equity when available — book equity made the debt weight balloon for
 * high-P/B companies (dragging WACC toward after-tax rd and inflating FCF/EP
 * values) and went degenerate (>1/<0 weights) for buyback-shrunken negative
 * book equity. Falls back to book equity only when market cap is missing.
 * Mirrors backend valuation.wacc_equity_weight.
 */
export function waccEquityWeight(inputs) {
  const mktCap = inputs.marketCap || 0
  return mktCap > 0 ? mktCap : inputs.equity
}

/**
 * Calculate WACC.
 * Uses CAPM for cost of equity.
 */
export function calcWACC({ debt, equity, rd, rf, rm, beta, taxRate }) {
  const totalCapital = debt + equity
  const weightDebt = debt / totalCapital
  const weightEquity = equity / totalCapital
  const re = rf + beta * (rm - rf)
  return weightDebt * rd * (1 - taxRate) + weightEquity * re
}

/**
 * Calculate CAPM cost of equity.
 */
export function calcCostOfEquity({ rf, rm, beta }) {
  return rf + beta * (rm - rf)
}

/**
 * Discount a cash flow n years at rate r.
 */
export function pv(cashFlow, rate, years) {
  return cashFlow / Math.pow(1 + rate, years)
}

/**
 * Gordon Growth Model terminal value (perpetuity with growth).
 */
export function terminalValue(lastCashFlow, growthRate, discountRate) {
  // Require the discount rate to clear terminal growth by >= 50 bps. A razor-thin
  // (or inverted) spread makes the Gordon-growth denominator explode or flip
  // negative — a discontinuity at discount ~= growth. DDM guards the same way.
  // Below the floor we return 0 rather than a nonsense terminal value. (VAL-5)
  if (discountRate - growthRate < 0.005) return 0
  return (lastCashFlow * (1 + growthRate)) / (discountRate - growthRate)
}
