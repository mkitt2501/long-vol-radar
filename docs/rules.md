# Frozen rule catalog and data contract

Long Vol Radar evaluates research conditions, not orders or a probability of profitable trading. Green means that supplied observations meet a declared predicate. It does not erase negative evidence, demonstrate cheap options, or validate a combination of strategies.

The initial catalog uses eight saved research specifications. Related strike, entry-time, percentile, and exit variants are retained in research history rather than displayed as additional confirmation lights. These thresholds are frozen for this version; none were optimized for the dashboard.

## What the engine verifies

The deterministic engine checks supplied summary values, units/ranges, input types, explicit session/expiry flags, observation timestamps, information windows, measurement completeness, and predicate boundaries. It does not fetch market data, recreate missing historical quotes, audit a whole raw-data calculation, verify the truth of a supplier's coverage attestations, or simulate brokerage execution.

Fields such as `weeklyCoverageValid` describe an upstream data adapter's attestation. Manual entry is useful for exploring a rule and cannot independently validate a backtest. A production adapter must implement the raw-data calculations and preserve their input audit trail.

## State semantics

- **Qualified / green:** supplied, sufficiently complete observations pass the frozen criteria.
- **Not qualified / red:** known observations fail a criterion, or the explicitly supplied session/expiry is ineligible.
- **Waiting / yellow:** this snapshot is before the rule's information cutoff.
- **Unavailable / gray:** an input is missing, malformed, future, stale, from the wrong session, or has inadequate source coverage/history.
- **Expired / gray:** the research window has ended for this snapshot.

State and evidence are separate. `watch`, `fragile`, `weakened`, and `untested` describe the historical evidence; none means statistically validated.

## Counting overlapping conditions

Only qualifying `vol` cards contribute to the volatility headline. Weekly mismatch, overnight turbulence, and futures burst share the **Gold realized volatility** family and contribute at most one driver. Opening IV contributes the **Opening option pricing** family. This grouping is a conservative product convention based on shared inputs/rationale, not a measured correlation matrix or claim of statistical independence.

Directional cards, macro calendar context, and experimental quote patterns have separate counts. There is no subjective weighting, calibrated confidence score, or “strong buy” output. Whether overlap improves future results is an untested hypothesis requiring frozen forward observations.

## Rule 1 — Weekly hidden volatility, version 2 ratio

Source: `weekly_hidden_volatility_spec.md` and `weekly_hidden_volatility.py`.

Use five completed GLD close-to-close periods and six fresh scheduled-session closes. Calculate XAU volatility as the square root of the sum of squared fresh quarter-hour log returns across the same elapsed periods; calculate GLD volatility as the square root of the sum of five squared daily log returns. Both must be positive. Include scheduled closure/weekend jumps without inventing zero returns.

The ratio is XAU RV / GLD close-to-close volatility. Rank it as `count(prior ratio <= current ratio) / 60` against the previous 60 valid ratios, excluding the current value. A rank **>=0.75** qualifies. Source coverage requires five consecutive valid periods, >=98% expected quarter-hour endpoints, no consecutive missing endpoints, and fresh anchors. Do not extend a missing period to an older valid day.

The context is known from the preceding completed close and becomes visible at 09:30. The saved option study selects at 10:00 and uses a 10:01 ask proxy; a displayed context later in the day does not establish a new entry.

Evidence: the ratio cohort had less negative comparisons in parts of the sample, but the saved version-3 5×/expiration outcome lost **18.67%** pooled gross premium. The study did not establish a positive aggregate option edge. Rolling windows and strike/exit variants are dependent.

## Rule 2 — Hidden overnight turbulence, version 3 RV

Source: `overnight_turbulence_spec.md` and `overnight_turbulence.py`.

The XAU proxy window runs from the prior evening to 09:30 New York. Require a first fresh evening anchor in 18:01–18:16, a fresh 09:30 endpoint, at least 800 fresh minute observations, and all 62 quarter-hour endpoints from 18:15 through 09:30. RV is `sqrt(sum of 61 squared log returns)`. Rank it against the preceding 60 complete nights, excluding the current night.

Both conditions must hold:

- Overnight RV rank **>=0.75**.
- `abs(final/start - 1) / ((high-low)/start) <=0.25`.

A nonpositive start/range or incomplete window is unavailable, not a zero ratio. This is a frozen morning condition after 09:30. It is related to the weekly gold-volatility driver.

Evidence: an exploratory put subset was positive under some assumptions; calls were negative. The positive subset had small samples, missing exit quotes, and substantial winner/year dependence. Larger underlying excursions are not proof that option prices fail to reflect those risks.

## Rule 3 — GC volatility burst, burst-only comparison

Source: `futures_wing_lag_spec.md` and `futures_wing_lag.py`.

Require 36 contiguous fresh GC closes to produce 35 log returns. Reset on a missing minute or a mapped-contract change. The preceding-30-return mean square must be positive.

- `sqrt(mean(last 5 returns squared) / mean(prior 30 returns squared)) >=2`.
- `sqrt(sum(last 5 returns squared)) >=0.001` (10 basis points).

Original scans occur every five minutes from 10:00 to 14:30. One minute later, recompute the burst and require the selected same-day option and GLD spot to have fresh valid quotes, with the option still OTM. The engine requires a source attestation of this recheck and observes the recheck metric on a 10:01, 10:06, …, 14:31 endpoint. Acceleration, five-minute RV, close count, window validity, and recheck validity must all describe the same whole-minute endpoint. Individually fresh quantities from different windows cannot qualify. Current observations expire after five minutes.

This card deliberately represents the **burst-only** comparison. It does not silently add the peer-wing-lag condition, whose saved primary cohort lost its premium.

Evidence: burst-only calls earned +8.66% gross on spent premium and +1.72% after assumed costs, with only four target hits. Puts were negative. The comparison is exploratory, not a demonstrated latency/fill opportunity or robust combined signal.

## Rule 4 — Low opening ATM IV, lowest-ten-percent comparison

Source: `gld_low_opening_iv.py` and `gld_low_opening_iv_results.md`.

From 09:31 to 10:00, choose the nearest common call/put strike within 0.5% of ATM. Use fresh positive unlocked bid/ask midpoints and valid European Black–Scholes IV solutions with `r=q=0` and expiration at 16:00. Average the paired IVs equally, then average over valid paired minutes. Require at least 24 of 30 minutes and at least six in each ten-minute block.

Compare the average with the **linearly interpolated tenth percentile** of the preceding 60 valid expiry-session opening averages. Invalid IV sessions are skipped, as in the source; these 60 observations need not be consecutive trading sessions. The average **<= that threshold** qualifies. This is not a `rank <0.1` substitution. The supplied block counts must reconcile to the supplied total. Missing history, nonpositive IV, or incomplete measurement is unavailable.

The opening context is frozen after 10:00. Later display does not imply a fresh executable offer at the morning price.

Evidence: cheap opening IV did not demonstrate profitable long-vol selection. Accepted-exit-only positive results were materially affected by incomplete/invalid exits. The lower-half variant is related research, not a second driver.

## Rule 5 — Three adjacent XAU 10am returns

Source: `xau_three_day_050_exit_1300.py` and its results report.

Use fresh positive XAU midpoint quotes at 10:00 on the current and three immediately preceding expected US trading sessions. No missing-date bridging. Compute the three adjacent returns:

- All three **strictly >0**: call-side context.
- All three **strictly <0**: put-side context.
- Zero or mixed signs: not qualified.

The frozen study enters only on full Monday/Wednesday/Friday sessions with actual same-day options. A fresh positive unlocked contract must be selected nearest the $0.50 ask target within ±3% of spot; ties use spread then strike proximity. These selection and anchor attestations must come from the upstream adapter. The engine checks the source-specific weekday separately from the supplied actual-expiry flag.

This is a directional long-option condition, not a direction-neutral strangle. The saved +4.91% combined ask/bid result remains exploratory. The 09:35 and different premium-target variants are not independent votes.

## Rule 6 — Macro PRE/core calendar context

Source: `gld_macro_aftereffects.py` and its results report.

Require at least one relevant US event with scheduled minute `0 < minute <570` (strictly before 09:30) and no core event with `570 <=minute <960` (09:30 through before 16:00). The source's exact PRE/core event-family classifier and complete as-of calendar must be attested. A generic “important event” checkbox is not an equivalent classifier.

A calendar observed before the cutoff may describe scheduled events later that day; that is not a future price observation. Do not require future complete-day market outcomes to determine this context. The card does not require a 0DTE listing and never contributes to volatility-driver totals.

The saved realized-volatility difference is descriptive. No option profitability was tested for this filter.

## Rule 7 — GLD downside first touch, O01 descriptive rule

Sources: `RESEARCH_OBSERVATIONS.md` O01 and `gld_prevclose_available_results.md`.

Use raw GLD prices and the immediately preceding expected scheduled-session close. Require `abs(open/previousClose -1) <=0.005`. The first fresh observed GLD price **<=previousClose*0.995** triggers once per side per session.

The future race between −1% and zero is an **outcome**, never a signal prerequisite. A source should record the first-touch timestamp and disclose missing minutes rather than infer unseen touches. The dashboard's Boolean is an attestation that the event has been observed as of the snapshot cutoff.

This is put-side directional context. Descriptive resolved-event statistics do not establish P&L, and tested option translations were negative or coverage-sensitive. The unconditioned morning-window baseline and alternate thresholds are research comparisons, not additional lights or votes.

## Rule 8 — Two consecutive two-cent quotes, pending experiment

Source: `gld_two_penny_minutes.py`.

Freeze listed same-day strikes within ±5% of the 09:30 opening GLD price at 09:31. The same candidate contract must have two consecutive fresh, non-fill-forward minute closing quotes at bid $0.01 / ask $0.02 (source floating-point tolerance 1e−8). Bid/ask timestamps must align within each endpoint, endpoints must be whole-minute closes (seconds 00), and consecutive endpoints must be exactly one minute apart. Require fresh GLD spot and valid source candidate selection, nearest current spot with ties call first then lower strike. No OTM filter is added.

The first signal must occur by 14:58; the earliest possible consecutive regular-session condition is 09:32. There is only one daily attempt, including a failed entry recheck.

Green represents the detected quote condition, **before** execution eligibility. The original experiment rechecks the same contract exactly one minute later, requiring a positive unlocked quote, ask still $0.02, and positive reported ask size. It does not fall back to another contract after failure. The 15:00 exit is an outcome, not a trigger.

No recovered result summary is claimed. Fifty-contract sizing is not proven by displayed size, which may be smaller. The card is experimental and excluded from the volatility headline.

## Timestamp and snapshot contract

The interface exports schema version 1:

```json
{
  "schemaVersion": 1,
  "date": "2026-06-22",
  "asOf": "2026-06-22T10:01:00-04:00",
  "mode": "manual",
  "source": "Your named adapter or observation source",
  "session": { "isTradingDay": true, "isFullSession": true, "has0dte": true },
  "observations": {
    "weeklyRatioRank": {
      "value": 0.82,
      "observedAt": "2026-06-19T16:00:00-04:00",
      "source": "Prior-close research calculation"
    }
  }
}
```

The numeric values above illustrate format, not market readings. The app bundles invented demo inputs to demonstrate behavior; they are not backtest output or current signals.

- `asOf` must use the correct New York `-04:00` or `-05:00` offset and match `date` in New York.
- Every present observation includes its value, explicit-offset timestamp, and source. Observation timestamps may use UTC or another explicit offset; comparison uses instants and New York session dates.
- Omitted metrics or `value:null` mean missing. Strings, `NaN`, infinity, out-of-range fractions, and fractional counts are not coerced.
- No observation may be later than the snapshot cutoff. Imported metadata cannot relax these restrictions.
- **Historical** metrics may predate the session and must strictly precede the cutoff. They represent declared prior-data baselines; a timestamp alone cannot prove an upstream calculation excluded current/future raw data.
- **Frozen** completed-window metrics must belong to the snapshot session and cannot be recorded before their declared completion time. They may remain as context after five minutes, within the card's research window.
- **Current** metrics must belong to the session and be no more than five minutes old. Five minutes exactly is permitted; five minutes plus one second is unavailable.
- An exchange-calendar/data adapter supplies trading-day, full-session, and actual-expiry flags. The engine does not guess holidays or 0DTE availability from weekdays. A source-specific weekday restriction, where present, remains a separate explicit predicate.
- No observation source is certified by the app. A production connector needs venue/calendar provenance, contract identifiers, bar intervals, warmup coverage, raw-data calculation tests, and observable failure reasons.

Exports preserve the input observations and evaluation version so a study can be reproduced. Public reports should distinguish historical market-quote observations from theoretical prices, intrinsic-value diagnostics, and synthetic scenarios.

## Research excluded from the initial headline

The prior conditional-tail model overestimated selected expiration payoffs; the strict neighboring-strike cheapness experiment produced one losing purchase; the burst-plus-wing-lag cohort lost its premium. These failed or weakened studies remain useful research memory, but are not silently rebranded as validated opposite signals. Lower-half IV, alternate weekly strikes, extra scan times, and hindsight-conditioned winner windows are related comparisons, not independent confirmations.

## Evaluation scope

`node --test tests/engine.test.mjs` checks deterministic replay, boundary predicates, missing-vs-negative evidence, future/stale/wrong-session input rejection, DST/calendar alignment, consecutive quote chronology, coverage requirements, strict directional signs, explicit expiry availability, and family counting. It tests this snapshot engine, not raw data vendors, brokerage fills, profitability, or the historical notebooks' entire research pipeline.
