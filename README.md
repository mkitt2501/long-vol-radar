# Long Vol Radar

A morning research dashboard for exploratory GLD same-day options hypotheses. It shows when frozen signal rules qualify, keeps overlapping checks together, and preserves the evidence that weakens each idea.

The app is intentionally useful without an account or API key. The included snapshots contain **invented inputs**, visibly labeled as a demonstration. They are not live prices, historical market observations, or simulated trading returns.

## Run locally

Requires Python 3 to serve the files and Node.js 20+ for the tests. No application dependencies are installed.

```sh
python3 -m http.server 8765 --directory . --bind 127.0.0.1
```

Open `http://127.0.0.1:8765`. Files cannot be opened directly with a `file://` URL because the app loads its snapshot as JSON.

```sh
node --test tests/*.test.mjs
```

## The workflow

1. Choose a demonstration morning or import your own snapshot.
2. Inspect qualified, failed, waiting, and unavailable conditions.
3. Open any card to see its exact rule, input checks, timestamp, saved results, and contradictory evidence.
4. Save the morning in browser storage or export its observations and evaluation.

The input worksheet is for explicit, sourced observations. It does not fetch prices, estimate missing values, or mark unprovided inputs as passing. A blank input stays missing.

## Reading the headline

The main count includes the core volatility/option-pricing checks. Related gold realized-volatility checks contribute only one driver group. Directional long-option ideas, macro context and the pending two-cent experiment appear separately.

Driver grouping is a conservative product taxonomy; it is **not** a statistical claim of independence. Multiple qualifying checks mean more frozen criteria are satisfied. No combined predictive probability, expected profit, or “strong buy” score has been calibrated.

Green means the supplied inputs meet the rule. Evidence quality is a separate badge. A weak or negative research finding can still meet its mechanical trigger.

## Data and privacy

- The prototype supports a JSON snapshot contract with per-observation timestamps and provenance.
- Importing and editing snapshots runs entirely in the browser. Data and logs are not uploaded to a server.
- Saved mornings use local browser storage; exports are needed for a durable backup.
- No brokerage credentials, order entry, or broker integrations are present.
- Market-data redistribution rights are not assumed. The repository does not include licensed option quote history.
- The app has no automatic market-data connection or unattended schedule in this version. A real exporter must construct and attest each documented metric before real daily readings are available.
- The interface identifies demo, manual and imported observations. Old or future-dated snapshots are identified as such, rather than represented as current readings.

See [the frozen rules](docs/rules.md) and [the snapshot contract](docs/snapshot-contract.md).

## Research scope

Included: weekly hidden volatility, overnight turbulence, a futures burst, low opening IV, three-day XAU momentum, pre-open macro context, the first downside touch, and the pending two-cent quote trigger.

Unconditioned morning-window option studies are execution comparisons, rather than independent predictors. Alternative strike targets and exit times belong inside the same study. Forecast-based conditional-tail and neighboring-strike discrepancy studies remain archived research; they are not added as green lights without a reproducible, validated input adapter.

Saved findings are summarized from independent research. Source report and script filenames cited in the rule catalog identify research provenance; the reports, research scripts, and raw market data are not bundled in this repository. They do not establish executable alpha. Option research returns refer to gross P&L divided by premium spent, unless otherwise stated; they are not account returns. Midpoint marks are hypothetical. Missing exits, concentration, selection among many variants, fees and quote size can materially change conclusions.

## Architecture

`engine.mjs` evaluates a validated snapshot using `catalog.mjs`. Neither the engine nor an imported snapshot can execute user-supplied code. `app.mjs` provides the interface, import/export and observation log. The rule catalog owns data-type, timing and freshness policy; imports cannot override those policies.

This separation supports a future read-only QuantConnect exporter without coupling signal calculations to UI code or broker permissions.

## Author

Michael Kitt · Independent financial workflow prototype.
