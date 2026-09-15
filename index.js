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

  const prices = [fcf.pricePerShare, ep.pricePerShare, re.pricePerShare]
  // Only positive model values enter the average — a negative value means a
  // broken model and shouldn't drag the consensus down. This also matches the
  // Python batch engine, which previously diverged by averaging all three here.
  const valid = prices.filter((p) => p != null && p > 0)
  const avgPrice = valid.length ? valid.reduce((s, p) => s + p, 0) / valid.length : 0

  const mos = inputs.currentMarketPrice
    ? (avgPrice - inputs.currentMarketPrice) / inputs.currentMarketPrice
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
