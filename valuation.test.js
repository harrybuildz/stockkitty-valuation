/**
 * Valuation engine tests using hardcoded data from the spreadsheet
 * (FIN 605 Firm Valuation Models - Harry Clemente Fall 2023)
 *
 * Run with: npx vitest run
 */

import { describe, it, expect } from 'vitest'
import { runValuation } from './index.js'
import { terminalValue, growthPath, projectRevenue } from './utils.js'

// Exact values from the spreadsheet
const spreadsheetInputs = {
  // Assumptions
  taxRate:          0.35,
  salesGrowth:      0.7422,
  longTermGrowth:   0.03,
  rm:               0.10,
  rd:               0.09,
  rf:               0.04,
  beta:             1.69,

  // Balance sheet inputs
  debt:             9_703_000,
  equity:           22_101_000,
  nppe:             4_845_000,
  capExpEfficiency: 1,

  // EP model
  roic:             0.1182,

  // RE model
  roe:              0.4022,
  payoutRatio:      0.0386,

  // Market data
  sharesOutstanding: 2_470_000,
  currentMarketPrice: 483.35,

  // Historical financials [2020, 2021, 2022, 2023]
  revenue:            [10_918_000, 16_675_000, 26_914_000, 26_974_000],
  costOfRevenue:      [4_150_000,   6_279_000,  9_439_000, 11_618_000],
  opEx:               [3_922_000,   5_864_000,  7_434_000,  9_779_000],
  depreciation:       [  381_000,   1_098_000,  1_174_000,  1_544_000],
  interestExpense:    [   52_000,     184_000,    236_000,    262_000],
  capEx:              [  489_000,   1_128_000,    976_000,  1_833_000],
  currentAssets:      [13_690_000, 16_055_000, 28_829_000, 23_073_000],
  currentLiabilities: [1_784_000,   3_925_000,  4_335_000,  6_563_000],
}

describe('Valuation Engine', () => {
  const results = runValuation(spreadsheetInputs)

  it('calculates WACC correctly', () => {
    // Expected: (9703/(9703+22101))*0.09*(1-0.35) + (22101/(9703+22101))*(0.04+1.69*(0.10-0.04))
    const expectedWACC = (9_703_000 / 31_804_000) * 0.09 * 0.65
                       + (22_101_000 / 31_804_000) * (0.04 + 1.69 * 0.06)
    expect(results.fcf.wacc).toBeCloseTo(expectedWACC, 6)
  })

  it('FCF model returns a positive firm value', () => {
    expect(results.fcf.firmValue).toBeGreaterThan(0)
    expect(results.fcf.pricePerShare).toBeGreaterThan(0)
  })

  it('EP model returns a positive firm value', () => {
    expect(results.ep.firmValue).toBeGreaterThan(0)
    expect(results.ep.pricePerShare).toBeGreaterThan(0)
  })

  it('RE model returns a positive firm value', () => {
    expect(results.re.firmValue).toBeGreaterThan(0)
    expect(results.re.pricePerShare).toBeGreaterThan(0)
  })

  it('RE cost of equity equals CAPM formula', () => {
    const expectedRe = 0.04 + 1.69 * (0.10 - 0.04)
    expect(results.re.costOfEquity).toBeCloseTo(expectedRe, 6)
  })

  it('summary margin of safety is calculated correctly', () => {
    const { avgIntrinsicValue, currentMarketPrice, marginOfSafety } = results.summary
    expect(marginOfSafety).toBeCloseTo((avgIntrinsicValue - currentMarketPrice) / currentMarketPrice, 6)
  })

  it('FCF and EP apply the net-debt bridge (VAL-1)', () => {
    // spreadsheetInputs has no `cash` field, so cash defaults to 0 → net debt = gross debt.
    const netDebt = spreadsheetInputs.debt
    const shares  = spreadsheetInputs.sharesOutstanding
    expect(results.fcf.pricePerShare).toBeCloseTo((results.fcf.firmValue - netDebt) / shares, 6)
    expect(results.ep.pricePerShare).toBeCloseTo((results.ep.firmValue - netDebt) / shares, 6)
  })

  it('cash reduces net debt, raising per-share value (VAL-1)', () => {
    const withCash = runValuation({ ...spreadsheetInputs, cash: 5_000_000 })
    expect(withCash.fcf.pricePerShare).toBeGreaterThan(results.fcf.pricePerShare)
    expect(withCash.ep.pricePerShare).toBeGreaterThan(results.ep.pricePerShare)
  })

  it('EP no longer depends on the roic input (VAL-2 rolls IC from the balance sheet)', () => {
    const lo = runValuation({ ...spreadsheetInputs, roic: 0.05 })
    const hi = runValuation({ ...spreadsheetInputs, roic: 0.30 })
    expect(lo.ep.pricePerShare).toBeCloseTo(hi.ep.pricePerShare, 6)
  })

  it('RE can express value destruction when ROE < cost of equity (VAL-3 removes the floors)', () => {
    // Cost of equity here is ~14%; a 2% ROE earns below it, so residual
    // earnings are negative every year and RE value must fall below book equity
    // — the old asymmetric zero-floors made that impossible.
    const weak = runValuation({ ...spreadsheetInputs, roe: 0.02 })
    const bookPerShare = spreadsheetInputs.equity / spreadsheetInputs.sharesOutstanding
    expect(weak.re.pricePerShare).toBeLessThan(bookPerShare)
  })
})

describe('WACC equity weights (ASM-4)', () => {
  const results = runValuation(spreadsheetInputs)

  it('uses market cap for the equity weight when present', () => {
    const marketCap = 200_000_000 // ~9× book equity
    const r = runValuation({ ...spreadsheetInputs, marketCap })
    const { debt, rd, rf, rm, beta, taxRate } = spreadsheetInputs
    const total = debt + marketCap
    const expected = (debt / total) * rd * (1 - taxRate)
                   + (marketCap / total) * (rf + beta * (rm - rf))
    expect(r.fcf.wacc).toBeCloseTo(expected, 6)
    expect(r.ep.wacc).toBeCloseTo(expected, 6)
    // Cost of equity (~14%) exceeds after-tax rd here, so a bigger equity
    // weight must RAISE WACC vs the book-weight baseline.
    expect(r.fcf.wacc).toBeGreaterThan(results.fcf.wacc)
  })

  it('falls back to book equity when marketCap is missing or zero', () => {
    const r = runValuation({ ...spreadsheetInputs, marketCap: 0 })
    expect(r.fcf.wacc).toBeCloseTo(results.fcf.wacc, 10)
  })

  it('keeps sane weights for negative book equity when marketCap is present', () => {
    const r = runValuation({ ...spreadsheetInputs, equity: -1_000_000, marketCap: 200_000_000 })
    // Book weights would give wd > 1 and a ~3% WACC; market weights keep the
    // discount rate between after-tax rd and the cost of equity.
    expect(r.fcf.wacc).toBeGreaterThan(0.09 * 0.65)
    expect(r.fcf.wacc).toBeLessThan(0.04 + 1.69 * 0.06)
  })
})

describe('Terminal value guard (VAL-5)', () => {
  it('returns 0 when the discount rate does not clear growth by >= 50 bps', () => {
    expect(terminalValue(100, 0.03, 0.032)).toBe(0)  // 20 bps spread
    expect(terminalValue(100, 0.03, 0.03)).toBe(0)   // zero spread
    expect(terminalValue(100, 0.05, 0.03)).toBe(0)   // inverted spread
  })
  it('computes Gordon-growth terminal value when the spread is adequate', () => {
    expect(terminalValue(100, 0.03, 0.10)).toBeCloseTo((100 * 1.03) / 0.07, 6)
  })
})

describe('Model dispersion (VAL-7)', () => {
  it('reports the relative spread of the averaged model values', () => {
    const r = runValuation(spreadsheetInputs)
    const { summary } = r
    const prices = [
      r.fcf.pricePerShare,
      r.ep.pricePerShare,
      r.re.pricePerShare,
    ].filter((p) => p > 0)
    const expected = (Math.max(...prices) - Math.min(...prices)) / summary.avgIntrinsicValue
    expect(summary.modelDispersion).toBeCloseTo(expected, 6)
    expect(summary.valueLow).toBeCloseTo(Math.min(...prices), 6)
    expect(summary.valueHigh).toBeCloseTo(Math.max(...prices), 6)
    // Fixture spans $45 (RE) to $133 (FCF) on a ~$96 average → wide spread.
    expect(summary.modelDispersion).toBeGreaterThan(0.5)
  })

  it('excludes negative model values from the average and the spread', () => {
    // Force RE negative with a below-cost-of-equity ROE; it should drop out of
    // both the average and the dispersion range rather than distort them.
    const weak = runValuation({ ...spreadsheetInputs, roe: -0.20 })
    expect(weak.re.pricePerShare).toBeLessThan(0)
    expect(weak.summary.valueLow).toBeGreaterThan(0)   // negative RE excluded
  })
})

describe('Growth glide path (VAL-6)', () => {
  it('starts at salesGrowth and lands exactly on longTermGrowth', () => {
    const path = growthPath(0.30, 0.03, 10)
    expect(path).toHaveLength(10)
    expect(path[0]).toBeCloseTo(0.30, 10)   // year 1 = full salesGrowth
    expect(path[9]).toBeCloseTo(0.03, 10)   // final year = terminal growth
  })

  it('fades monotonically with no year-5→6 kink', () => {
    const path = growthPath(0.30, 0.03, 10)
    for (let i = 1; i < path.length; i++) {
      expect(path[i]).toBeLessThan(path[i - 1])          // strictly decreasing
    }
    // Every step is the same size (linear) — the old step model had one big
    // jump at year 5→6 and zero change elsewhere.
    const steps = path.slice(1).map((r, i) => path[i] - r)
    for (const s of steps) expect(s).toBeCloseTo(steps[0], 10)
  })

  it('projected revenue grows at the terminal rate in the final year', () => {
    const rev = projectRevenue(1000, 0.30, 0.03, 10)
    expect(rev).toHaveLength(10)
    expect(rev[0] / 1000 - 1).toBeCloseTo(0.30, 10)       // year 1 at salesGrowth
    expect(rev[9] / rev[8] - 1).toBeCloseTo(0.03, 10)     // final year at longTermGrowth
  })

  it('is continuous into the terminal value (last projected growth = perpetuity growth)', () => {
    // The whole point of VAL-6: the last projected year already grows at the
    // long-term rate the Gordon terminal assumes, so there is no step-off.
    const ltg = 0.025
    const rev = projectRevenue(500, 0.18, ltg, 10)
    expect(rev[9] / rev[8] - 1).toBeCloseTo(ltg, 10)
  })
})

describe('Valuation Engine (logging)', () => {
  const results = runValuation(spreadsheetInputs)
  it('logs results for manual comparison with spreadsheet', () => {
    const { fcf, ep, re, summary } = results
    console.log('\n=== VALUATION RESULTS ===')
    console.log(`WACC:              ${(fcf.wacc * 100).toFixed(2)}%`)
    console.log(`Re (cost equity):  ${(re.costOfEquity * 100).toFixed(2)}%`)
    console.log(`FCF price/share:   $${fcf.pricePerShare.toFixed(2)}`)
    console.log(`EP  price/share:   $${ep.pricePerShare.toFixed(2)}`)
    console.log(`RE  price/share:   $${re.pricePerShare.toFixed(2)}`)
    console.log(`Avg intrinsic:     $${summary.avgIntrinsicValue.toFixed(2)}`)
    console.log(`Market price:      $${summary.currentMarketPrice.toFixed(2)}`)
    console.log(`Margin of safety:  ${(summary.marginOfSafety * 100).toFixed(1)}%`)
    console.log(`Verdict:           ${summary.isUndervalued ? 'UNDERVALUED' : 'OVERVALUED'}`)
  })
})
