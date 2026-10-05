# @stockkitty/valuation

Shared JavaScript DCF valuation engine used by both
[stockkitty](https://github.com/harrybuildz/stockkitty) (the web app) and
`stockkitty-mobile` (the Expo React Native app). Extracted from
`stockkitty/frontend/src/valuation/` so there is a single source of truth —
the Python side at `stockkitty/backend/valuation*.py` is kept in lockstep by
house rule (`CLAUDE.md`).

Three models, documented in the FIN 605 Firm Valuation Models notes
(Harry Clemente, Fall 2023):

- **FCF** — Free Cash Flow DCF (`fcf.js`)
- **EP**  — Excess Profit (`ep.js`)
- **RE**  — Residual Earnings (`re.js`)

Plus `index.js` → `runValuation()` which runs all three, averages the
positive non-extreme intrinsic values, and reports margin of safety against
`currentMarketPrice`.

Also `assumptions.js`: `deriveAssumptions(financials)` seeds a company's
starting assumptions from its financials response, and
`buildValuationInputs(financials, assumptions)` merges them for
`runValuation` (assumptions win, so user edits take effect). Both clients
use these instead of their own copies.

## Install

Consumed as a git dependency, pinned to a commit sha in the consumer's
`package.json`:

```json
{
  "dependencies": {
    "@stockkitty/valuation": "github:harrybuildz/stockkitty-valuation#<sha>"
  }
}
```

## Usage

Barrel import covers every public symbol:

```js
import {
  runValuation,
  fcfValuation, epValuation, reValuation,
  calcWACC, calcCostOfEquity, pv, terminalValue, growthPath,
  DEFAULT_ASSUMPTIONS, deriveAssumptions, buildValuationInputs,
} from '@stockkitty/valuation'
```

## Test

```sh
npm ci
npm test
```

The existing `valuation.test.js` validates results against hardcoded values
from the Harry Clemente spreadsheet.
