import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, STRATEGIES } from '../catalog.mjs';
import { evaluateSnapshot, validateSnapshot } from '../engine.mjs';

function fixture(asOf = '2026-06-22T10:01:00-04:00') {
  const date = asOf.slice(0, 10);
  const observations = Object.fromEntries(METRICS.map(metric => {
    let observedAt = asOf;
    if (metric.historical) observedAt = '2026-06-19T16:00:00-04:00';
    else if (metric.metadata.availableAt) observedAt = `${date}T${metric.metadata.availableAt}:00-04:00`;
    if (metric.id === 'pennyPreviousBid' || metric.id === 'pennyPreviousAsk') observedAt = `${date}T10:00:00-04:00`;
    return [metric.id, { value: metric.defaultValue, observedAt, source: 'Invented test input' }];
  }));
  return { schemaVersion: 1, date, asOf, mode: 'demo', source: 'Invented test fixture',
    session: { isTradingDay: true, isFullSession: true, has0dte: true }, observations };
}
const signal = (snapshot, id) => evaluateSnapshot(snapshot).signals.find(s => s.id === id);
const set = (snapshot, id, value) => { snapshot.observations[id].value = value; return snapshot; };

test('demo fixture is valid, deterministic, and does not mutate inputs', () => {
  const snapshot = fixture();
  const before = JSON.stringify(snapshot);
  assert.deepEqual(validateSnapshot(snapshot), { valid: true, errors: [] });
  assert.deepEqual(evaluateSnapshot(snapshot), evaluateSnapshot(snapshot));
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(evaluateSnapshot(snapshot).signals.length, STRATEGIES.length);
});

test('related gold rules count once; direction, context, and experiment are separate', () => {
  const result = evaluateSnapshot(fixture());
  assert.equal(result.summary.volChecks, 4);
  assert.equal(result.summary.driverCount, 2);
  assert.deepEqual(result.summary.driverLabels, ['Gold realized volatility', 'Opening option pricing']);
  assert.equal(result.summary.directionalChecks, 1);
  assert.equal(result.summary.contextChecks, 1);
  assert.equal(result.summary.experimentalChecks, 1);
  assert.equal(result.summary.qualifiedChecks, 7);
  assert.equal(result.signals.find(s => s.id === 'opening-iv').evidence, 'weakened');
});

test('weekly rank boundary is inclusive and lower rank is not a signal', () => {
  const snapshot = fixture();
  set(snapshot, 'weeklyRatioRank', 0.75);
  assert.equal(signal(snapshot, 'weekly-mismatch').state, 'qualified');
  set(snapshot, 'weeklyRatioRank', 0.749999);
  assert.equal(signal(snapshot, 'weekly-mismatch').state, 'not-qualified');
});

test('overnight rank and cancellation boundary retain the frozen conjunction', () => {
  const snapshot = fixture();
  set(snapshot, 'overnightRvRank', 0.75); set(snapshot, 'overnightNetRangeRatio', 0.25);
  assert.equal(signal(snapshot, 'overnight-turbulence').state, 'qualified');
  set(snapshot, 'overnightNetRangeRatio', 0.250001);
  assert.equal(signal(snapshot, 'overnight-turbulence').state, 'not-qualified');
  set(snapshot, 'overnightNetRangeRatio', 0.1); set(snapshot, 'overnightRvRank', 0.74);
  assert.equal(signal(snapshot, 'overnight-turbulence').state, 'not-qualified');
});

test('opening-IV predicate compares the supplied interpolated percentile inclusively', () => {
  const snapshot = fixture();
  set(snapshot, 'openingIv', 0.25); set(snapshot, 'openingIvP10', 0.25);
  assert.equal(signal(snapshot, 'opening-iv').state, 'qualified');
  set(snapshot, 'openingIv', 0.250001);
  assert.equal(signal(snapshot, 'opening-iv').state, 'not-qualified');
});

test('incomplete opening blocks and inconsistent total do not pass', () => {
  const snapshot = fixture();
  set(snapshot, 'openingIvBlock1', 5);
  assert.equal(signal(snapshot, 'opening-iv').state, 'unavailable');
  set(snapshot, 'openingIvBlock1', 8);
  assert.equal(signal(snapshot, 'opening-iv').state, 'not-qualified');
  assert.match(signal(snapshot, 'opening-iv').reason, /reconcile/);
});

test('futures thresholds are inclusive, with an invalid denominator unavailable', () => {
  const snapshot = fixture();
  set(snapshot, 'futuresAcceleration', 2); set(snapshot, 'futuresRv5', 0.001);
  assert.equal(signal(snapshot, 'futures-burst').state, 'qualified');
  set(snapshot, 'futuresAcceleration', 1.999999);
  assert.equal(signal(snapshot, 'futures-burst').state, 'not-qualified');
  set(snapshot, 'futuresWindowValid', false);
  assert.equal(signal(snapshot, 'futures-burst').state, 'unavailable');
});

test('burst evaluation is waiting before the first surviving recheck', () => {
  assert.equal(signal(fixture('2026-06-22T10:00:00-04:00'), 'futures-burst').state, 'waiting');
  const snapshot = fixture('2026-06-22T10:03:00-04:00');
  assert.equal(signal(snapshot, 'futures-burst').state, 'not-qualified');
  assert.match(signal(snapshot, 'futures-burst').reason, /recheck time/);
});

test('burst window includes the 14:31 recheck and expires after it', () => {
  assert.equal(signal(fixture('2026-06-22T14:31:00-04:00'), 'futures-burst').state, 'qualified');
  assert.equal(signal(fixture('2026-06-22T14:32:00-04:00'), 'futures-burst').state, 'expired');
});

test('individually fresh GC quantities from different windows cannot form a burst', () => {
  const snapshot = fixture();
  snapshot.observations.futuresRv5.observedAt = '2026-06-22T10:00:00-04:00';
  assert.equal(validateSnapshot(snapshot).valid, true);
  assert.equal(signal(snapshot, 'futures-burst').state, 'unavailable');
  assert.match(signal(snapshot, 'futures-burst').reason, /same whole-minute recheck window/);
  assert.equal(evaluateSnapshot(snapshot).summary.volChecks, 3);
  snapshot.observations.futuresRv5.observedAt = snapshot.asOf;
  assert.equal(signal(snapshot, 'futures-burst').state, 'qualified');
  snapshot.asOf = '2026-06-22T10:01:15-04:00';
  for (const id of ['futuresAcceleration', 'futuresRv5', 'futuresCloseCount', 'futuresWindowValid', 'futuresRecheckValid'])
    snapshot.observations[id].observedAt = snapshot.asOf;
  assert.equal(signal(snapshot, 'futures-burst').state, 'unavailable');
});

test('three-day momentum preserves strict signs and adaptive direction', () => {
  const snapshot = fixture();
  for (const id of ['xauReturn1', 'xauReturn2', 'xauReturn3']) set(snapshot, id, 0.00001);
  assert.equal(signal(snapshot, 'xau-three-day').state, 'qualified');
  assert.equal(signal(snapshot, 'xau-three-day').direction, 'calls');
  for (const id of ['xauReturn1', 'xauReturn2', 'xauReturn3']) set(snapshot, id, -0.00001);
  assert.equal(signal(snapshot, 'xau-three-day').state, 'qualified');
  assert.equal(signal(snapshot, 'xau-three-day').direction, 'puts');
  set(snapshot, 'xauReturn3', 0);
  assert.equal(signal(snapshot, 'xau-three-day').state, 'not-qualified');
  set(snapshot, 'xauReturn3', 0.002);
  assert.equal(signal(snapshot, 'xau-three-day').state, 'not-qualified');
});

test('source-specific M/W/F gate is separate from actual expiry availability', () => {
  const snapshot = fixture('2026-06-23T10:01:00-04:00'); // Tuesday
  assert.equal(signal(snapshot, 'xau-three-day').state, 'not-qualified');
  assert.equal(signal(snapshot, 'weekly-mismatch').state, 'qualified');
  snapshot.session.has0dte = false;
  assert.equal(signal(snapshot, 'weekly-mismatch').state, 'not-qualified');
  assert.equal(signal(snapshot, 'macro-preopen').state, 'qualified');
});

test('downside first-touch does not infer future continuation', () => {
  const snapshot = fixture();
  set(snapshot, 'gldOpeningGap', -0.005); set(snapshot, 'downsideFirstTouch', true);
  assert.equal(signal(snapshot, 'downside-touch').state, 'qualified');
  set(snapshot, 'gldOpeningGap', -0.005001);
  assert.equal(signal(snapshot, 'downside-touch').state, 'not-qualified');
  set(snapshot, 'gldOpeningGap', 0); set(snapshot, 'downsideFirstTouch', false);
  assert.equal(signal(snapshot, 'downside-touch').state, 'not-qualified');
  assert.deepEqual(signal(snapshot, 'downside-touch').missing, []);
});

test('macro PRE/core is descriptive context and rejects known intraday events', () => {
  const snapshot = fixture();
  set(snapshot, 'macroCoreIntradayEvents', 1);
  assert.equal(signal(snapshot, 'macro-preopen').state, 'not-qualified');
  set(snapshot, 'macroCoreIntradayEvents', 0); set(snapshot, 'macroPreopenEvents', 0);
  assert.equal(signal(snapshot, 'macro-preopen').state, 'not-qualified');
  set(snapshot, 'macroPreopenEvents', 1); set(snapshot, 'macroCalendarComplete', false);
  assert.equal(signal(snapshot, 'macro-preopen').state, 'unavailable');
});

test('two-cent rule needs the same consecutive quote endpoints and exact penny prices', () => {
  const snapshot = fixture();
  assert.equal(signal(snapshot, 'two-cent-quotes').state, 'qualified');
  set(snapshot, 'pennyCandidateIsCall', false);
  assert.equal(signal(snapshot, 'two-cent-quotes').direction, 'puts');
  set(snapshot, 'pennyAsk', 0.021);
  assert.equal(signal(snapshot, 'two-cent-quotes').state, 'not-qualified');
  set(snapshot, 'pennyAsk', 0.02);
  snapshot.observations.pennyPreviousBid.observedAt = '2026-06-22T09:59:00-04:00';
  snapshot.observations.pennyPreviousAsk.observedAt = '2026-06-22T09:59:00-04:00';
  assert.equal(signal(snapshot, 'two-cent-quotes').state, 'unavailable');
});

test('quote-side timestamp misalignment is unavailable rather than a false negative', () => {
  const snapshot = fixture();
  snapshot.observations.pennyPreviousAsk.observedAt = '2026-06-22T09:59:59-04:00';
  assert.equal(signal(snapshot, 'two-cent-quotes').state, 'unavailable');
});

test('consecutive quotes must be minute endpoints, not offset intraminute timestamps', () => {
  const snapshot = fixture();
  for (const id of ['pennyPreviousBid', 'pennyPreviousAsk']) snapshot.observations[id].observedAt = '2026-06-22T10:00:25-04:00';
  for (const id of ['pennyBid', 'pennyAsk']) snapshot.observations[id].observedAt = '2026-06-22T10:01:25-04:00';
  snapshot.asOf = '2026-06-22T10:01:25-04:00';
  assert.equal(signal(snapshot, 'two-cent-quotes').state, 'unavailable');
});

test('the two-cent rule does not recycle an already-used daily attempt', () => {
  const snapshot = fixture(); set(snapshot, 'pennyFirstAttemptAvailable', false);
  assert.equal(signal(snapshot, 'two-cent-quotes').state, 'not-qualified');
  assert.equal(signal(fixture('2026-06-22T14:59:00-04:00'), 'two-cent-quotes').state, 'expired');
});

test('a missing value or explicit null is gray and is never coerced to zero', () => {
  const snapshot = fixture();
  delete snapshot.observations.weeklyRatioRank;
  assert.equal(validateSnapshot(snapshot).valid, true);
  assert.equal(signal(snapshot, 'weekly-mismatch').state, 'unavailable');
  snapshot.observations.weeklyRatioRank = { value: null, observedAt: snapshot.asOf, source: 'Empty template input' };
  assert.equal(validateSnapshot(snapshot).valid, true);
  assert.equal(signal(snapshot, 'weekly-mismatch').state, 'unavailable');
  assert.equal(signal(snapshot, 'opening-iv').state, 'qualified');
});

test('numeric strings, boolean strings, NaN, and infinity are malformed', () => {
  for (const value of ['0.82', NaN, Infinity]) {
    const snapshot = fixture(); set(snapshot, 'weeklyRatioRank', value);
    assert.equal(validateSnapshot(snapshot).valid, false);
    assert.ok(evaluateSnapshot(snapshot).signals.every(s => s.state === 'unavailable'));
  }
  const snapshot = fixture(); set(snapshot, 'weeklyCoverageValid', 'true');
  assert.equal(validateSnapshot(snapshot).valid, false);
});

test('out-of-range fractions, fractional counts, and impossible dates fail validation', () => {
  const snapshot = fixture(); set(snapshot, 'weeklyRatioRank', 1.1);
  assert.equal(validateSnapshot(snapshot).valid, false);
  set(snapshot, 'weeklyRatioRank', 0.82); set(snapshot, 'weeklyHistoryCount', 59.5);
  assert.equal(validateSnapshot(snapshot).valid, false);
  snapshot.date = '2026-02-30';
  assert.equal(validateSnapshot(snapshot).valid, false);
});

test('future observations gray only the affected card and cannot leak later information', () => {
  const snapshot = fixture();
  snapshot.observations.overnightRvRank.observedAt = '2026-06-22T10:02:00-04:00';
  assert.equal(validateSnapshot(snapshot).valid, true);
  assert.equal(signal(snapshot, 'overnight-turbulence').state, 'unavailable');
  assert.match(signal(snapshot, 'overnight-turbulence').reason, /later than/);
  assert.equal(signal(snapshot, 'opening-iv').state, 'qualified');
});

test('historical baselines may be old but must precede the cutoff', () => {
  const snapshot = fixture();
  snapshot.observations.weeklyRatioRank.observedAt = '2024-01-03T16:00:00-05:00';
  assert.equal(signal(snapshot, 'weekly-mismatch').state, 'qualified');
  snapshot.observations.weeklyRatioRank.observedAt = snapshot.asOf;
  assert.equal(signal(snapshot, 'weekly-mismatch').state, 'unavailable');
});

test('current data freshness uses exact elapsed time with a five-minute inclusive boundary', () => {
  const snapshot = fixture('2026-06-22T10:06:00-04:00');
  for (const id of ['futuresAcceleration', 'futuresRv5', 'futuresCloseCount', 'futuresWindowValid', 'futuresRecheckValid'])
    snapshot.observations[id].observedAt = '2026-06-22T10:01:00-04:00';
  assert.equal(signal(snapshot, 'futures-burst').state, 'qualified');
  snapshot.asOf = '2026-06-22T10:06:01-04:00';
  assert.equal(signal(snapshot, 'futures-burst').state, 'unavailable');
  assert.match(signal(snapshot, 'futures-burst').reason, /older than/);
});

test('completed session windows may be frozen but not from a different session', () => {
  const snapshot = fixture('2026-06-22T13:00:00-04:00');
  assert.equal(signal(snapshot, 'overnight-turbulence').state, 'qualified');
  assert.equal(signal(snapshot, 'opening-iv').state, 'qualified');
  snapshot.observations.openingIv.observedAt = '2026-06-19T10:00:00-04:00';
  assert.equal(signal(snapshot, 'opening-iv').state, 'unavailable');
});

test('opening summary cannot be available before its completed 10am window', () => {
  const snapshot = fixture(); snapshot.observations.openingIv.observedAt = '2026-06-22T09:59:00-04:00';
  assert.equal(signal(snapshot, 'opening-iv').state, 'unavailable');
  assert.equal(signal(fixture('2026-06-22T09:59:00-04:00'), 'opening-iv').state, 'waiting');
});

test('insufficient warmup and missing coverage do not become negative evidence', () => {
  const snapshot = fixture(); set(snapshot, 'weeklyHistoryCount', 59);
  assert.equal(signal(snapshot, 'weekly-mismatch').state, 'unavailable');
  set(snapshot, 'weeklyHistoryCount', 60); set(snapshot, 'weeklyCoverageValid', false);
  assert.equal(signal(snapshot, 'weekly-mismatch').state, 'unavailable');
  set(snapshot, 'overnightFreshMinutes', 799);
  assert.equal(signal(snapshot, 'overnight-turbulence').state, 'unavailable');
});

test('explicit calendars and session flags are required; they are not guessed from weekdays', () => {
  const snapshot = fixture(); delete snapshot.session.has0dte;
  assert.equal(validateSnapshot(snapshot).valid, false);
  const suppliedSaturday = fixture('2026-06-20T10:01:00-04:00');
  assert.equal(signal(suppliedSaturday, 'weekly-mismatch').state, 'qualified'); // Adapter is authoritative; engine is not an exchange-calendar service.
  suppliedSaturday.session.isTradingDay = false;
  assert.ok(evaluateSnapshot(suppliedSaturday).signals.every(s => s.state === 'not-qualified'));
});

test('full-session rules reject supplied half-days and closed windows expire', () => {
  const snapshot = fixture(); snapshot.session.isFullSession = false;
  assert.ok(evaluateSnapshot(snapshot).signals.every(s => s.state === 'not-qualified'));
  assert.ok(evaluateSnapshot(fixture('2026-06-22T16:01:00-04:00')).signals.every(s => s.state === 'expired'));
});

test('asOf must match the session and the actual New York DST offset', () => {
  const snapshot = fixture(); snapshot.date = '2026-06-21';
  assert.equal(validateSnapshot(snapshot).valid, false);
  snapshot.date = '2026-06-22'; snapshot.asOf = '2026-06-22T10:01:00-05:00';
  assert.equal(validateSnapshot(snapshot).valid, false);
  snapshot.asOf = '2026-06-22T14:01:00Z';
  assert.equal(validateSnapshot(snapshot).valid, false);
  const winter = fixture('2026-01-05T10:01:00-05:00');
  assert.equal(validateSnapshot(winter).valid, true);
});

test('imported metadata cannot exempt a current observation from freshness checks', () => {
  const snapshot = fixture();
  snapshot.observations.futuresAcceleration.observedAt = '2026-06-19T16:00:00-04:00';
  snapshot.observations.futuresAcceleration.metadata = { historical: true, frozen: true };
  assert.equal(signal(snapshot, 'futures-burst').state, 'unavailable');
});

test('unknown input metrics are not silently accepted as frozen rules', () => {
  const snapshot = fixture(); snapshot.observations.futureProfit = { value: 100, observedAt: snapshot.asOf, source: 'Unknown' };
  assert.equal(validateSnapshot(snapshot).valid, false);
  assert.ok(validateSnapshot(snapshot).errors.some(error => /Unknown metric/.test(error)));
});
