import { METRICS, STRATEGIES } from './catalog.mjs';

export const ENGINE_VERSION = '0.1.0';
const metricById = new Map(METRICS.map(m => [m.id, m]));
const modes = new Set(['demo', 'manual', 'imported', 'quantconnect']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  timeZoneName: 'longOffset'
});
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function validIso(value) {
  if (typeof value !== 'string' || !isoPattern.test(value) || !validDate(value.slice(0, 10))) return false;
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (!value.endsWith('Z')) {
    const offset = value.slice(-6);
    if (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}
function nyParts(value) {
  const p = Object.fromEntries(nyFormatter.formatToParts(new Date(value)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute),
    time: `${p.hour}:${p.minute}`, offset: p.timeZoneName.replace('GMT', '') };
}

/** Structural validation only. Null is explicit missing input; it is never zero. */
export function validateSnapshot(snapshot) {
  const errors = [];
  if (!record(snapshot)) return { valid: false, errors: ['Snapshot must be an object.'] };
  if (snapshot.schemaVersion !== 1) errors.push('schemaVersion must be the number 1.');
  if (!validDate(snapshot.date)) errors.push('date must be a real YYYY-MM-DD calendar date.');
  if (!validIso(snapshot.asOf)) errors.push('asOf must be an ISO timestamp with seconds and an explicit Eastern offset.');
  else {
    const asOf = nyParts(snapshot.asOf);
    if (!/-(?:04|05):00$/.test(snapshot.asOf) || snapshot.asOf.slice(-6) !== asOf.offset)
      errors.push('asOf must use the correct -04:00 or -05:00 New York offset for that instant.');
    if (validDate(snapshot.date) && asOf.date !== snapshot.date) errors.push('date must match the New York session date of asOf.');
  }
  if (!modes.has(snapshot.mode)) errors.push('mode must be demo, manual, imported, or quantconnect.');
  if (!nonempty(snapshot.source)) errors.push('source must identify the supplied data source.');
  if (!record(snapshot.session)) errors.push('session must explicitly identify trading-day, full-session, and 0DTE availability.');
  else for (const key of ['isTradingDay', 'isFullSession', 'has0dte']) {
    if (typeof snapshot.session[key] !== 'boolean') errors.push(`session.${key} must be a boolean; expiry and calendars are not inferred.`);
  }
  if (!record(snapshot.observations)) errors.push('observations must be an object keyed by metric ID.');
  else for (const [id, observation] of Object.entries(snapshot.observations)) {
    const metric = metricById.get(id);
    if (!metric) { errors.push(`Unknown metric: ${id}.`); continue; }
    if (!record(observation)) { errors.push(`${id} must contain value, observedAt, and source.`); continue; }
    if (observation.value !== null) {
      if (metric.type === 'number' && (typeof observation.value !== 'number' || !Number.isFinite(observation.value)))
        errors.push(`${id}.value must be a finite number or null; strings are not coerced.`);
      else if (metric.type === 'boolean' && typeof observation.value !== 'boolean')
        errors.push(`${id}.value must be a boolean or null.`);
      else if (metric.type === 'number') {
        if (metric.integer && !Number.isInteger(observation.value)) errors.push(`${id}.value must be an integer count.`);
        if (metric.min !== undefined && observation.value < metric.min) errors.push(`${id}.value is below the allowed minimum ${metric.min}.`);
        if (metric.max !== undefined && observation.value > metric.max) errors.push(`${id}.value is above the allowed maximum ${metric.max}.`);
      }
    }
    if (!validIso(observation.observedAt)) errors.push(`${id}.observedAt must be an ISO timestamp with an explicit offset.`);
    if (!nonempty(observation.source)) errors.push(`${id}.source must identify the observation source.`);
  }
  return { valid: errors.length === 0, errors };
}

function unavailableMetric(metric, observation, snapshot) {
  if (!observation || observation.value === null) return 'missing';
  const stamp = Date.parse(observation.observedAt);
  const cutoff = Date.parse(snapshot.asOf);
  if (stamp > cutoff) return 'later than the snapshot cutoff';
  if (metric.historical) return stamp >= cutoff ? 'historical baseline must precede the cutoff' : null;
  const observed = nyParts(observation.observedAt);
  if (observed.date !== snapshot.date) return 'different session date';
  if (metric.metadata.availableAt && observed.minute < minutes(metric.metadata.availableAt))
    return `recorded before the required ${metric.metadata.availableAt} completed window`;
  if (!metric.frozen && cutoff - stamp > 5 * 60_000) return 'older than five minutes';
  return null;
}

// Incomplete measurement coverage is not evidence that a hypothesis failed.
const coverageFlags = new Set(['weeklyCoverageValid', 'overnightAnchorsValid', 'futuresWindowValid',
  'openingIvSourceValid', 'xauSessionsValid', 'xauOptionSelectionValid', 'macroCalendarComplete',
  'downsidePathValid', 'pennyQuotesValid']);
const coverageMinimums = new Map([
  ['weeklyHistoryCount', 60], ['overnightHistoryCount', 60], ['overnightFreshMinutes', 800],
  ['overnightQuarterCloses', 62], ['futuresCloseCount', 36], ['openingIvHistoryCount', 60],
  ['openingIvValidMinutes', 24], ['openingIvBlock1', 6], ['openingIvBlock2', 6], ['openingIvBlock3', 6]
]);

function ruleChecks(strategy, values, snapshot) {
  const checks = [];
  const check = (label, actual, expected, passed) => checks.push({ label, actual, expected, passed });
  const truth = (id, expected = true) => check(metricById.get(id).label, values[id], expected ? 'Yes' : 'No', values[id] === expected);
  const atLeast = (id, threshold) => check(metricById.get(id).label, values[id], `≥ ${threshold}`, values[id] >= threshold);
  const exact = (id, target) => check(metricById.get(id).label, values[id], `Exactly ${target}`, values[id] === target);
  let direction = strategy.direction;
  switch (strategy.id) {
    case 'weekly-mismatch':
      atLeast('weeklyRatioRank', 0.75); exact('weeklyHistoryCount', 60); truth('weeklyCoverageValid'); break;
    case 'overnight-turbulence':
      atLeast('overnightRvRank', 0.75);
      check('Absolute overnight net / range', values.overnightNetRangeRatio, '≤ 0.25', values.overnightNetRangeRatio <= 0.25);
      exact('overnightHistoryCount', 60); atLeast('overnightFreshMinutes', 800);
      exact('overnightQuarterCloses', 62); truth('overnightAnchorsValid'); break;
    case 'futures-burst': {
      atLeast('futuresAcceleration', 2); atLeast('futuresRv5', 0.001);
      atLeast('futuresCloseCount', 36); truth('futuresWindowValid'); truth('futuresRecheckValid');
      const recheckIds = ['futuresAcceleration', 'futuresRv5', 'futuresCloseCount', 'futuresWindowValid', 'futuresRecheckValid'];
      const recheckStamps = recheckIds.map(id => Date.parse(snapshot.observations[id].observedAt));
      check('Coherent GC recheck window', recheckStamps.map(stamp => new Date(stamp).toISOString()).join(', '),
        'All GC quantities and validity attestations from the same whole-minute recheck endpoint',
        recheckStamps.every(stamp => stamp === recheckStamps[0] && stamp % 60_000 === 0));
      const observedMinute = nyParts(snapshot.observations.futuresAcceleration.observedAt).minute;
      check('Scheduled one-minute recheck time', nyParts(snapshot.observations.futuresAcceleration.observedAt).time,
        '10:01–14:31, one minute after a five-minute scan', observedMinute >= 601 && observedMinute <= 871 && observedMinute % 5 === 1
          && Date.parse(snapshot.observations.futuresAcceleration.observedAt) % 60_000 === 0);
      break;
    }
    case 'opening-iv':
      check('Opening IV versus prior interpolated tenth percentile', values.openingIv, `≤ ${values.openingIvP10}`, values.openingIv <= values.openingIvP10);
      exact('openingIvHistoryCount', 60); atLeast('openingIvValidMinutes', 24);
      for (const id of ['openingIvBlock1', 'openingIvBlock2', 'openingIvBlock3']) atLeast(id, 6);
      check('Block counts reconcile to paired-minute total', values.openingIvBlock1 + values.openingIvBlock2 + values.openingIvBlock3,
        `Exactly ${values.openingIvValidMinutes}`, values.openingIvBlock1 + values.openingIvBlock2 + values.openingIvBlock3 === values.openingIvValidMinutes);
      check('Positive paired IV and positive history threshold', values.openingIv, 'Both IV values > 0', values.openingIv > 0 && values.openingIvP10 > 0);
      truth('openingIvSourceValid'); break;
    case 'xau-three-day': {
      const ids = ['xauReturn1', 'xauReturn2', 'xauReturn3'];
      const calls = ids.every(id => values[id] > 0);
      const puts = ids.every(id => values[id] < 0);
      direction = calls ? 'calls' : puts ? 'puts' : 'adaptive';
      const desiredPositive = calls || (!puts && values.xauReturn1 > 0);
      for (const id of ids) check(metricById.get(id).label, values[id], desiredPositive ? '> 0 (calls)' : '< 0 (puts)', desiredPositive ? values[id] > 0 : values[id] < 0);
      truth('xauSessionsValid'); truth('xauOptionSelectionValid');
      const weekday = new Date(`${snapshot.date}T12:00:00Z`).getUTCDay();
      check('Frozen study entry weekday', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday],
        'Monday, Wednesday, or Friday', [1, 3, 5].includes(weekday));
      break;
    }
    case 'macro-preopen':
      atLeast('macroPreopenEvents', 1); exact('macroCoreIntradayEvents', 0); truth('macroCalendarComplete'); break;
    case 'downside-touch':
      check('Absolute opening gap', Math.abs(values.gldOpeningGap), '≤ 0.005 (0.5%)', Math.abs(values.gldOpeningGap) <= 0.005);
      truth('downsideFirstTouch'); truth('downsidePathValid'); break;
    case 'two-cent-quotes': {
      // Exact source tolerances are for floating-point representation, not price bands.
      for (const id of ['pennyPreviousBid', 'pennyBid'])
        check(metricById.get(id).label, values[id], '$0.01 ± 1e−8', Math.abs(values[id] - 0.01) <= 1e-8);
      for (const id of ['pennyPreviousAsk', 'pennyAsk'])
        check(metricById.get(id).label, values[id], '$0.02 ± 1e−8', Math.abs(values[id] - 0.02) <= 1e-8);
      truth('pennyQuotesValid'); truth('pennyUniverseValid'); truth('pennyFirstAttemptAvailable');
      direction = values.pennyCandidateIsCall ? 'calls' : 'puts';
      const prevBid = Date.parse(snapshot.observations.pennyPreviousBid.observedAt);
      const prevAsk = Date.parse(snapshot.observations.pennyPreviousAsk.observedAt);
      const bid = Date.parse(snapshot.observations.pennyBid.observedAt);
      const ask = Date.parse(snapshot.observations.pennyAsk.observedAt);
      check('Same-minute quote sides and consecutive endpoints', (bid - prevBid) / 60_000, 'Same sides; exactly one minute apart; seconds 00',
        prevBid === prevAsk && bid === ask && bid - prevBid === 60_000 && bid % 60_000 === 0 && prevBid % 60_000 === 0);
      break;
    }
    default: throw new Error(`Missing frozen rule for ${strategy.id}`);
  }
  return { checks, direction };
}

function summarize(signals) {
  const qualified = signals.filter(s => s.state === 'qualified');
  const vol = qualified.filter(s => s.category === 'vol');
  const families = new Map(vol.map(s => [s.family, s.familyLabel]));
  return { qualifiedChecks: qualified.length, volChecks: vol.length,
    driverCount: families.size, driverLabels: [...families.values()],
    directionalChecks: qualified.filter(s => s.category === 'directional').length,
    contextChecks: qualified.filter(s => s.category === 'context').length,
    experimentalChecks: qualified.filter(s => s.category === 'experimental').length,
    waiting: signals.filter(s => s.state === 'waiting').length,
    unavailable: signals.filter(s => s.state === 'unavailable').length,
    expired: signals.filter(s => s.state === 'expired').length };
}

/** Evaluates declared summary inputs; never fetches prices or sends orders. */
export function evaluateSnapshot(snapshot) {
  const validation = validateSnapshot(snapshot);
  const issues = [...validation.errors];
  if (!validation.valid) {
    const signals = STRATEGIES.map(strategy => ({ ...strategy, state: 'unavailable',
      reason: 'Snapshot is malformed. Correct the validation errors before evaluating.',
      checks: [], missing: [...strategy.required], direction: strategy.direction }));
    return { signals, summary: summarize(signals), issues };
  }
  const minute = nyParts(snapshot.asOf).minute;
  const signals = STRATEGIES.map(strategy => {
    const base = { ...strategy, checks: [], missing: [], direction: strategy.direction };
    if (!snapshot.session.isTradingDay) return { ...base, state: 'not-qualified', reason: 'Supplied calendar marks this as a non-trading day.' };
    if (!snapshot.session.isFullSession) return { ...base, state: 'not-qualified', reason: 'The frozen study requires a full US session.' };
    if (strategy.requires0dte !== false && !snapshot.session.has0dte)
      return { ...base, state: 'not-qualified', reason: 'No actual same-day option expiry is available in the supplied session.' };
    if (minute < minutes(strategy.readyAt)) return { ...base, state: 'waiting', reason: `Waiting for the ${strategy.readyAt} ET information cutoff.` };
    if (minute > minutes(strategy.expiresAt)) return { ...base, state: 'expired', reason: `This research window ended at ${strategy.expiresAt} ET.` };
    const values = {};
    const failures = [];
    for (const id of strategy.required) {
      const observation = snapshot.observations[id];
      let problem = unavailableMetric(metricById.get(id), observation, snapshot);
      if (!problem && coverageFlags.has(id) && observation.value === false) problem = 'source coverage/validity is not complete';
      if (!problem && coverageMinimums.has(id) && observation.value < coverageMinimums.get(id))
        problem = `insufficient coverage; requires at least ${coverageMinimums.get(id)}`;
      if (!problem && ['openingIv', 'openingIvP10'].includes(id) && observation.value <= 0) problem = 'positive IV is unavailable';
      if (problem) {
        base.missing.push(id);
        failures.push(`${metricById.get(id).label}: ${problem}`);
      } else values[id] = observation.value;
    }
    if (failures.length) {
      issues.push(...failures.map(reason => `${strategy.id}: ${reason}`));
      return { ...base, state: 'unavailable', reason: failures[0] + (failures.length > 1 ? `; ${failures.length - 1} additional unavailable input(s).` : '.') };
    }
    const evaluated = ruleChecks(strategy, values, snapshot);
    const failed = evaluated.checks.filter(check => !check.passed);
    const futuresChronology = strategy.id === 'futures-burst' && failed.find(check => check.label === 'Coherent GC recheck window');
    if (futuresChronology) {
      issues.push(`${strategy.id}: GC summary quantities are not from the same whole-minute recheck endpoint.`);
      return { ...base, ...evaluated, state: 'unavailable', reason: 'GC summary inputs must describe the same whole-minute recheck window; mixed fresh timestamps cannot qualify.' };
    }
    const quoteChronology = strategy.id === 'two-cent-quotes' && failed.find(check => check.label === 'Same-minute quote sides and consecutive endpoints');
    if (quoteChronology) {
      issues.push(`${strategy.id}: quote timestamps are not aligned consecutive minute endpoints.`);
      return { ...base, ...evaluated, state: 'unavailable', reason: 'Quote chronology is invalid: the same contract needs aligned bid/ask sides exactly one minute apart.' };
    }
    return { ...base, ...evaluated, state: failed.length ? 'not-qualified' : 'qualified',
      reason: failed.length ? `${failed[0].label} does not meet the frozen criterion${failed.length > 1 ? `; ${failed.length - 1} other criterion/criteria fail` : ''}.`
        : strategy.category === 'experimental' ? 'Experimental condition detected; execution recheck and outcome evidence remain unresolved.'
          : strategy.category === 'context' ? 'The calendar context qualifies; it is excluded from the volatility-driver count.'
            : 'Reported inputs meet the frozen criteria. This is a research condition, not a proven trading edge.' };
  });
  return { signals, summary: summarize(signals), issues: [...new Set(issues)] };
}
