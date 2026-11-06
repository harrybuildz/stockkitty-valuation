import { describe, it, expect } from 'vitest'
import { DEFAULT_ASSUMPTIONS, deriveAssumptions, buildValuationInputs, runValuation, netDepreciationFromCosts } from './index.js'

describe('deriveAssumptions', () => {
  it('falls back to defaults for an empty financials payload', () => {
    expect(deriveAssumptions({})).toEqual({
      ...DEFAULT_ASSUMPTIONS,
      beta: 1.0,
      roic: 0.10,
      roe: 0.10,
      payoutRatio: 0.05,
      rd: 0.05,
      salesGrowth: 0.05,
    })
  })

  it('prefers the live risk-free rate and effective tax rate from the backend', () => {
    const a = deriveAssumptions({ riskFreeRate: 0.0412, effectiveTaxRate: 0.18 })
    expect(a.rf).toBe(0.0412)
    expect(a.taxRate).toBe(0.18)
  })

  it('clamps beta to [0.2, 3.0]', () => {
    expect(deriveAssumptions({ beta: -0.4 }).beta).toBe(0.2)
    expect(deriveAssumptions({ beta: 7 }).beta).toBe(3.0)
    expect(deriveAssumptions({ beta: 1.3 }).beta).toBe(1.3)
  })

  it('derives cost of debt from period-matched averages, capped and floored', () => {
    // avg interest 100 / avg debt 2000 = 5%
    expect(deriveAssumptions({ interestExpense: [80, 120], totalDebtSeries: [1500, 2500] }).rd).toBeCloseTo(0.05)
    // zero-debt years are ignored in the average
    expect(deriveAssumptions({ interestExpense: [100], totalDebtSeries: [0, 2000] }).rd).toBeCloseTo(0.05)
    // falls back to point-in-time debt without a series
    expect(deriveAssumptions({ interestExpense: [100], debt: 1000 }).rd).toBeCloseTo(0.10)
    expect(deriveAssumptions({ interestExpense: [500], debt: 1000 }).rd).toBe(0.20)
    expect(deriveAssumptions({ interestExpense: [1], debt: 1000 }).rd).toBe(0.01)
  })

  it('takes 70% of historical revenue CAGR as sales growth, capped at 50%', () => {
    // 100 → 121 over 2 years = 10% CAGR → 7%
    expect(deriveAssumptions({ revenue: [100, 110, 121] }).salesGrowth).toBeCloseTo(0.07)
    expect(deriveAssumptions({ revenue: [1, 100] }).salesGrowth).toBe(0.5)
    expect(deriveAssumptions({ revenue: [0, 100] }).salesGrowth).toBe(0.05)
  })
})

describe('buildValuationInputs', () => {
  it("lets the user's assumptions win over overlapping financials fields", () => {
    const financials = { beta: 2.5, roe: 0.3, sharesOutstanding: 10, currentMarketPrice: 50 }
    const inputs = buildValuationInputs(financials, { beta: 1.1, roe: 0.12 })
    expect(inputs.beta).toBe(1.1)
    expect(inputs.roe).toBe(0.12)
    expect(inputs.sharesOutstanding).toBe(10)
    expect(inputs.currentMarketPrice).toBe(50)
  })

  it('changes the valuation when an overlapping assumption is edited', () => {
    const financials = {
      beta: 1.69, roic: 0.1182, roe: 0.4022, payoutRatio: 0.0386,
      debt: 9_703_000, equity: 22_101_000, nppe: 4_845_000,
      sharesOutstanding: 2_470_000, currentMarketPrice: 483.35,
      revenue:            [10_918_000, 16_675_000, 26_914_000, 26_974_000],
      costOfRevenue:      [4_150_000,   6_279_000,  9_439_000, 11_618_000],
      opEx:               [3_922_000,   5_864_000,  7_434_000,  9_779_000],
      depreciation:       [  381_000,   1_098_000,  1_174_000,  1_544_000],
      interestExpense:    [   52_000,     184_000,    236_000,    262_000],
      capEx:              [  489_000,   1_128_000,    976_000,  1_833_000],
      currentAssets:      [13_690_000, 16_055_000, 28_829_000, 23_073_000],
      currentLiabilities: [1_784_000,   3_925_000,  4_335_000,  6_563_000],
    }
    const base = deriveAssumptions(financials)
    const before = runValuation(buildValuationInputs(financials, base)).summary.avgIntrinsicValue
    const after = runValuation(buildValuationInputs(financials, { ...base, beta: 1.0 })).summary.avgIntrinsicValue
    expect(after).not.toBeCloseTo(before, 2)
  })
})

describe('netDepreciationFromCosts (COST-2)', () => {
  const B = 1e9
  // Walmart-shaped: D&A sits inside SG&A (opEx).
  const wmt = {
    source: 'edgar+yahoo',
    revenue:       [611 * B, 648 * B, 681 * B],
    costOfRevenue: [463 * B, 490 * B, 511 * B],
    opEx:          [127 * B, 131 * B, 140 * B],
    depreciation:  [ 11 * B,  12 * B,  13 * B],
  }

  it('takes D&A out of opEx, leaving implied EBIT unchanged', () => {
    const { costOfRevenue, opEx } = netDepreciationFromCosts(wmt)
    expect(opEx).toEqual([116 * B, 119 * B, 127 * B])
    expect(costOfRevenue).toEqual(wmt.costOfRevenue)
    wmt.revenue.forEach((r, i) => {
      const before = r - wmt.costOfRevenue[i] - wmt.opEx[i]
      const after = r - costOfRevenue[i] - opEx[i] - wmt.depreciation[i]
      expect(after).toBeCloseTo(before, 0)
    })
  })

  it('spills D&A larger than opEx into cost of revenue', () => {
    const r = netDepreciationFromCosts({
      source: 'edgar', costOfRevenue: [70], opEx: [10], depreciation: [15],
    })
    expect(r.opEx).toEqual([0])
    expect(r.costOfRevenue).toEqual([65])
  })

  it('leaves years without D&A alone and does not mutate the input', () => {
    const fin = { source: 'edgar', costOfRevenue: [50, 50], opEx: [20, 20], depreciation: [0, 5] }
    const r = netDepreciationFromCosts(fin)
    expect(r.opEx).toEqual([20, 15])
    expect(fin.opEx).toEqual([20, 20])
  })

  it('is applied by buildValuationInputs only for EDGAR-sourced financials', () => {
    expect(buildValuationInputs(wmt, {}).opEx).toEqual([116 * B, 119 * B, 127 * B])
    const yahoo = { ...wmt, source: 'yahoo' }
    expect(buildValuationInputs(yahoo, {}).opEx).toEqual(yahoo.opEx)
    expect(buildValuationInputs({ revenue: [1] }, {}).opEx).toBeUndefined()
  })
})
