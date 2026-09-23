/**
 * Main valuation entry point.
 * Runs all three models and returns a unified result with margin of safety.
 */

import { fcfValuation } from './fcf.js'
import { epValuation }  from './ep.js'
import { reValuation }  from './re.js'

/**
 * Run all three valuation models and compute an average intrinsic value.
 *
 * @param {object} inputs  — combined inputs for all three models
 * @param {number} inputs.currentMarketPrice — current stock price for MoS calculation
 * @returns {object} results from all three models plus summary
 */
export function runValuation(inputs) {
  const fcf = fcfValuation(inputs)
  const ep  = epValuation(inputs)
  const re  = reValuation(inputs)

  // Only positive model values enter the average — a negative value means a
  // broken model and shouldn't drag the consensus down. Models judged extreme
  // are excluded too (ASM-5): >5× market price, tightened to 3× for a model
  // whose cost inputs the source flagged missing (mirrors the backend's
  // extreme_value / DAT-5 thresholds in valuation.detect_flags — keep in sync).
  const market  = inputs.currentMarketPrice || 0
  const missing = new Set(inputs.missingFields || [])
  const extremeMult = {
    FCF: missing.has('capEx') ? 3 : 5,
    EP:  missing.has('depreciation') ? 3 : 5,
    RE:  5,
  }
  const valid = [['FCF', fcf.pricePerShare], ['EP', ep.pricePerShare], ['RE', re.pricePerShare]]
    .filter(([name, p]) => p != null && p > 0
      && !(market > 0 && p / market > extremeMult[name]))
    .map(([, p]) => p)
  const avgPrice = valid.length ? valid.reduce((s, p) => s + p, 0) / valid.length : 0

  // No surviving model means "no consensus", not "worth $0" — MoS is unknown
  // rather than −100%. Matches the Python engine.
  const mos = market > 0 && valid.length
    ? (avgPrice - market) / market
    : null

  // Model dispersion (VAL-7): relative spread of the averaged model values,
  // (max − min) / average, so the consensus is read alongside how far apart the
  // models actually are. null when fewer than two positive models.
  const valueLow  = valid.length ? Math.min(...valid) : null
  const valueHigh = valid.length ? Math.max(...valid) : null
  const modelDispersion = (valid.length >= 2 && avgPrice > 0)
    ? (valueHigh - valueLow) / avgPrice
    : null

  return {
    fcf,
    ep,
    re,
    summary: {
      avgIntrinsicValue: avgPrice,
      currentMarketPrice: inputs.currentMarketPrice,
      marginOfSafety: mos,          // positive = undervalued, negative = overvalued
      isUndervalued: mos !== null ? mos > 0 : null,
      modelDispersion,
      valueLow,
      valueHigh,
    },
  }
}

export { fcfValuation, epValuation, reValuation }
