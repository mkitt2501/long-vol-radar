# Morning snapshot contract

The app evaluates observations; it does not manufacture market data. A source adapter must construct each summary metric according to the frozen rule catalog.

```json
{
  "schemaVersion": 1,
  "date": "2026-10-07",
  "asOf": "2026-10-07T10:01:00-04:00",
  "mode": "imported",
  "source": "Your read-only research exporter",
  "session": {
    "isTradingDay": true,
    "isFullSession": true,
    "has0dte": true
  },
  "observations": {
    "weeklyRatioRank": {
      "value": 0.82,
      "observedAt": "2026-10-06T16:00:00-04:00",
      "source": "Your documented prior-close calculation"
    }
  }
}
```

The example numbers are invented. A partial snapshot is valid: checks requiring absent metrics show unavailable. Optional observations with `value: null` represent missing data, never zero.

- `date` is the New York trading-session date. `asOf` includes a timezone offset and must refer to that session date in New York.
- Session flags are source attestations, not inferred expiry listings. A weekday alone is not evidence that a same-day contract is listed.
- Each observation includes a typed value, its original observation time, and a source. Numeric strings and nonfinite values are rejected.
- Bounds, baseline policies and freshness limits live in the catalog. Imported metadata cannot override them.
- Historical baseline values must precede the snapshot. The current observation must be excluded from its rank/percentile baseline.
- Current quote/futures observations expire after five minutes. A completed opening/overnight summary can be frozen within its own session after its defined availability time.
- All observations must be known by `asOf`. Future quotes cannot qualify a present snapshot.
- Two-cent quote observations must represent the same contract, have consecutive timestamps, and belong to the frozen opening universe. A detected condition precedes a separate next-minute attempted entry.

The template can be downloaded from the app footer. `catalog.mjs` defines the complete metric inventory and construction requirements. Missing source coverage must be reported rather than filled with default values.

## Real data connection

An exporter must compute or retrieve the required metrics, preserve original timestamps, and explicitly attest the associated coverage rules. Merely mapping an underlying price to these metrics is insufficient. Broker/order permissions are unnecessary.

To add unattended daily refresh later, use an authenticated read-only server-side adapter, a documented source, and a storage/update path. Never put API credentials in browser files or a public repository. The current import path is manual and does not imply that this scheduled connection exists.
