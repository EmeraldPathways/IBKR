export function clampProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error("probability must be between 0 and 1");
  }
  return number;
}

export function normalizeNoProbability(yesProbability) {
  return 1 - clampProbability(yesProbability);
}

export function roundToTick(value, tickSize = 0.01) {
  if (!Number.isFinite(value) || !Number.isFinite(tickSize) || tickSize <= 0) {
    throw new Error("value and tickSize must be finite; tickSize must be positive");
  }
  const rounded = Math.round((value + Number.EPSILON) / tickSize) * tickSize;
  return Number(rounded.toFixed(8));
}

export function calculateEdge({ estimatedProbability, quote, side, fee = 0, slippage = 0, uncertaintyPenalty = 0 }) {
  const probability = clampProbability(estimatedProbability);
  const normalizedSide = String(side).toUpperCase();
  const price = Number(quote);
  if (!Number.isFinite(price) || price < 0 || price > 1) {
    throw new Error("event contract quote must be between 0 and 1");
  }
  const sideProbability = normalizedSide === "NO" ? 1 - probability : probability;
  const grossEdge = sideProbability - price;
  const netEdge = grossEdge - Number(fee || 0) - Number(slippage || 0) - Number(uncertaintyPenalty || 0);
  return { grossEdge, netEdge, sideProbability };
}

export function estimateCosts({ quote, maxSlippagePercent = 0.015, confidence = 0.6 }) {
  const numericQuote = Math.max(0, Number(quote) || 0);
  const slippage = Math.min(numericQuote * maxSlippagePercent, 0.02);
  const fee = 0.006;
  const uncertaintyPenalty = Math.max(0, 1 - Number(confidence || 0)) * 0.02;
  return { fee, slippage, uncertaintyPenalty };
}

export function riskChecks({ quantity, price, currentExposure, totalExposure, dailyPnl, startingCapital, openOrders, config, killSwitch = false }) {
  const notional = Number(quantity) * Number(price);
  const checks = [
    { key: "kill_switch", label: "Kill switch inactive", pass: !killSwitch },
    { key: "position_cap", label: "Per-contract cap", pass: currentExposure + notional <= config.maxPositionPerContractUsd },
    { key: "aggregate_cap", label: "Aggregate exposure cap", pass: totalExposure + notional <= config.maxTotalExposureUsd },
    { key: "order_cap", label: "Maximum order size", pass: notional <= config.maxOrderSizeUsd },
    { key: "daily_loss", label: "Daily loss limit", pass: dailyPnl > -config.maxDailyLossUsd },
    { key: "account_floor", label: "Account floor", pass: startingCapital > 0 && startingCapital - notional >= startingCapital * (config.minAccountFloorPercent / 100) },
    { key: "concurrency", label: "Concurrent order limit", pass: openOrders < config.maxConcurrentOrders },
  ];
  return { pass: checks.every((check) => check.pass), checks, notional };
}

export function freshQuote(observedAt, maxAgeSeconds = 90, now = Date.now()) {
  const timestamp = Date.parse(observedAt);
  return Number.isFinite(timestamp) && now - timestamp <= maxAgeSeconds * 1000;
}

export function scoreMarketQuality({ spread, availableSize = 0, quoteAgeSeconds = Infinity, resolutionClarity = 0, evidenceFreshness = 0, sourceReliability = 0, permissionEligible = false, slippage = 0 }) {
  const spreadScore = Math.max(0, 1 - Math.min(1, Number(spread || 1) / 0.1));
  const sizeScore = Math.min(1, Math.max(0, Number(availableSize || 0) / 100));
  const freshnessScore = Number.isFinite(quoteAgeSeconds) ? Math.max(0, 1 - Math.min(1, quoteAgeSeconds / 300)) : 0;
  const slippageScore = Math.max(0, 1 - Math.min(1, Number(slippage || 0) / 0.03));
  const permissionScore = permissionEligible ? 1 : 0;
  const score = 100 * (0.18 * spreadScore + 0.12 * sizeScore + 0.18 * freshnessScore + 0.2 * Number(resolutionClarity || 0) + 0.12 * Number(evidenceFreshness || 0) + 0.1 * Number(sourceReliability || 0) + 0.05 * permissionScore + 0.05 * slippageScore);
  return { score: Number(score.toFixed(1)), components: { spread: spreadScore, size: sizeScore, freshness: freshnessScore, resolution: Number(resolutionClarity || 0), evidence: Number(evidenceFreshness || 0), source: Number(sourceReliability || 0), permission: permissionScore, slippage: slippageScore } };
}

export function scoringMetrics(predictions) {
  const rows = Array.isArray(predictions) ? predictions.filter((row) => Number.isFinite(Number(row.probability)) && (Number(row.outcome) === 0 || Number(row.outcome) === 1)) : [];
  if (!rows.length) return { sampleSize: 0, brierScore: null, logLoss: null, accuracy: null, calibration: [] };
  let brier = 0;
  let logLoss = 0;
  let correct = 0;
  const buckets = new Map();
  for (const row of rows) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, Number(row.probability)));
    const y = Number(row.outcome);
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    if ((p >= 0.5 ? 1 : 0) === y) correct += 1;
    const band = Math.min(0.9, Math.floor(p * 10) / 10);
    const bucket = buckets.get(band) ?? { band, count: 0, predicted: 0, observed: 0 };
    bucket.count += 1; bucket.predicted += p; bucket.observed += y; buckets.set(band, bucket);
  }
  return { sampleSize: rows.length, brierScore: brier / rows.length, logLoss: logLoss / rows.length, accuracy: correct / rows.length, calibration: [...buckets.values()].map((row) => ({ ...row, predicted: row.predicted / row.count, observed: row.observed / row.count })) };
}

// Conservative decision tools: these never override hard risk limits.
export function fractionalKelly({ probability, price, fraction = 0.25, maxFraction = 0.02 }) {
  const p = clampProbability(probability);
  const q = 1 - p;
  const entry = Math.max(0.000001, Math.min(0.999999, Number(price)));
  const odds = (1 - entry) / entry;
  const raw = ((p * odds - q) / odds) * Number(fraction);
  return Math.max(0, Math.min(Number(maxFraction), Number.isFinite(raw) ? raw : 0));
}

export function rankOpportunity({ netEdge = 0, confidence = 0, marketQuality = 0, resolutionReady = false, quoteFresh = false, liquidity = 0, correlatedExposure = 0 }) {
  const score = 100 * (0.27 * Math.max(0, Math.min(1, Number(netEdge) / 0.2)) + 0.18 * Number(confidence) + 0.18 * Number(marketQuality) / 100 + 0.12 * (resolutionReady ? 1 : 0) + 0.1 * (quoteFresh ? 1 : 0) + 0.07 * Math.max(0, 1 - Math.min(1, Number(correlatedExposure) / 250)) + 0.08 * Math.min(1, Math.max(0, Number(liquidity) / 100)));
  return Number(Math.max(0, Math.min(100, score)).toFixed(1));
}

export function executionQuality({ decisionQuote, submissionQuote, fillPrice, referencePrice = submissionQuote, filledQuantity = 0, requestedQuantity = 0 }) {
  const decision = Number(decisionQuote), submitted = Number(submissionQuote), fill = Number(fillPrice);
  const slippage = Number.isFinite(fill) && Number.isFinite(referencePrice) ? fill - referencePrice : null;
  return { decisionToSubmissionMove: Number.isFinite(decision) && Number.isFinite(submitted) ? submitted - decision : null, slippage, fillRate: requestedQuantity > 0 ? Math.min(1, filledQuantity / requestedQuantity) : null, measurable: Number.isFinite(slippage) };
}

export function correlatedExposure({ exposures = [], group }) {
  return exposures.filter((item) => item && item.group === group).reduce((sum, item) => sum + Number(item.exposure || 0), 0);
}

export function walkForwardBrier({ forecasts = [], minimumTraining = 5 }) {
  const rows = forecasts.filter((row) => Number.isFinite(Number(row.probability)) && (Number(row.outcome) === 0 || Number(row.outcome) === 1)).sort((a, b) => Date.parse(a.observedAt || 0) - Date.parse(b.observedAt || 0));
  const folds = [];
  for (let index = minimumTraining; index < rows.length; index += 1) {
    const training = rows.slice(0, index);
    const baseline = training.reduce((sum, row) => sum + Number(row.outcome), 0) / training.length;
    const actual = rows[index];
    folds.push({ observedAt: actual.observedAt, probability: Number(actual.probability), outcome: Number(actual.outcome), trainingBaseRate: baseline, brier: (Number(actual.probability) - Number(actual.outcome)) ** 2 });
  }
  return { sampleSize: folds.length, brierScore: folds.length ? folds.reduce((sum, row) => sum + row.brier, 0) / folds.length : null, folds: folds.slice(-50) };
}

// Professional diagnostics: these are descriptive controls, not trading signals.
export function calibrationDiagnostics(predictions, bins = 10) {
  const rows = Array.isArray(predictions) ? predictions.filter((row) => Number.isFinite(Number(row.probability)) && (Number(row.outcome) === 0 || Number(row.outcome) === 1)) : [];
  const buckets = Array.from({ length: bins }, (_, index) => ({ bucket: index, lower: index / bins, upper: (index + 1) / bins, count: 0, predicted: 0, observed: 0 }));
  for (const row of rows) {
    const probability = Math.min(0.999999, Math.max(0, Number(row.probability)));
    const bucket = buckets[Math.min(bins - 1, Math.floor(probability * bins))];
    bucket.count += 1; bucket.predicted += probability; bucket.observed += Number(row.outcome);
  }
  const populated = buckets.filter((bucket) => bucket.count > 0).map((bucket) => ({ ...bucket, predicted: bucket.predicted / bucket.count, observed: bucket.observed / bucket.count, gap: bucket.predicted / bucket.count - bucket.observed / bucket.count }));
  const ece = rows.length ? populated.reduce((sum, bucket) => sum + Math.abs(bucket.gap) * bucket.count / rows.length, 0) : null;
  return { sampleSize: rows.length, expectedCalibrationError: ece, buckets: populated };
}

export function stressTestPortfolio({ exposures = [], shocks = [-0.25, -0.5, -1], capital = 0 }) {
  const rows = Array.isArray(exposures) ? exposures : [];
  return shocks.map((shock) => {
    const loss = rows.reduce((sum, row) => sum + Math.max(0, Number(row.exposure || 0)) * Math.abs(Number(shock)), 0);
    return { shock: Number(shock), estimatedLoss: Number(loss.toFixed(2)), capitalAfterShock: Number((Number(capital || 0) - loss).toFixed(2)), breachesFloor: Number(capital || 0) - loss < 0 };
  });
}

export function edgeDecay(observations = []) {
  const rows = (Array.isArray(observations) ? observations : []).filter((row) => Number.isFinite(Number(row.edge)) && row.observedAt).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  if (rows.length < 2) return { sampleSize: rows.length, first: rows[0]?.edge ?? null, latest: rows.at(-1)?.edge ?? null, change: null, trend: "insufficient_data" };
  const first = Number(rows[0].edge); const latest = Number(rows.at(-1).edge); const change = latest - first;
  return { sampleSize: rows.length, first, latest, change, trend: change < -0.01 ? "decaying" : change > 0.01 ? "improving" : "stable" };
}

// The professional layer is deliberately deterministic and auditable. These helpers
// never place orders; they make assumptions explicit so the Site can persist them.
export function resolutionIntegrity(contract = {}) {
  const criteria = String(contract.resolutionCriteria ?? contract.resolution_criteria ?? "").trim();
  const source = String(contract.resolutionSourceUrl ?? contract.resolution_source_url ?? "").trim();
  const expiry = Date.parse(String(contract.expiration ?? ""));
  const ambiguity = Math.max(0, Math.min(1, Number(contract.ambiguityScore ?? contract.ambiguity_score ?? 1)));
  const checks = {
    officialSource: /^https:\/\//i.test(source),
    settlementRule: criteria.length >= 20,
    expiry: Number.isFinite(expiry),
    lowAmbiguity: ambiguity <= 0.35,
    open: !Number.isFinite(expiry) || expiry > Date.now(),
  };
  const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  return { score: Number(score.toFixed(2)), decision: score === 1 ? "tradable" : score >= 0.6 ? "research_only" : "unclear", checks };
}

export function purgedWalkForwardBrier({ forecasts = [], minimumTraining = 5, purgeDays = 0, embargoDays = 0 } = {}) {
  const rows = forecasts.filter((r) => Number.isFinite(Number(r.probability)) && (Number(r.outcome) === 0 || Number(r.outcome) === 1) && Number.isFinite(Date.parse(r.observedAt))).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const folds = [];
  for (let i = minimumTraining; i < rows.length; i += 1) {
    const testAt = Date.parse(rows[i].observedAt);
    const training = rows.slice(0, i).filter((r) => testAt - Date.parse(r.observedAt) >= purgeDays * 86400000);
    const baseline = training.length ? training.reduce((s, r) => s + Number(r.outcome), 0) / training.length : null;
    if (baseline === null) continue;
    const embargoUntil = testAt + embargoDays * 86400000;
    folds.push({ observedAt: rows[i].observedAt, probability: Number(rows[i].probability), outcome: Number(rows[i].outcome), trainingBaseRate: baseline, embargoUntil: new Date(embargoUntil).toISOString(), brier: (Number(rows[i].probability) - Number(rows[i].outcome)) ** 2 });
  }
  return { sampleSize: folds.length, purgeDays, embargoDays, brierScore: folds.length ? folds.reduce((s, r) => s + r.brier, 0) / folds.length : null, folds: folds.slice(-50) };
}

export function abstentionDiagnostics({ forecasts = [], minimumConfidence = 0.6 } = {}) {
  const rows = forecasts.filter((r) => Number.isFinite(Number(r.probability)) && Number.isFinite(Number(r.confidence)));
  const abstained = rows.filter((r) => Number(r.confidence) < minimumConfidence);
  const actionable = rows.filter((r) => Number(r.confidence) >= minimumConfidence);
  return { sampleSize: rows.length, minimumConfidence, abstained: abstained.length, actionable: actionable.length, abstentionRate: rows.length ? abstained.length / rows.length : null };
}

export function forecastEdgeMap(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.segment ?? row.provider ?? row.eventType ?? "all");
    const current = groups.get(key) ?? { segment: key, count: 0, meanEdge: 0, meanConfidence: 0, resolved: 0, brier: 0 };
    const edge = Number(row.edge ?? row.netEdge ?? 0); const confidence = Number(row.confidence ?? 0);
    current.count += 1; current.meanEdge += edge; current.meanConfidence += confidence;
    if (Number(row.outcome) === 0 || Number(row.outcome) === 1) { current.resolved += 1; current.brier += (Number(row.probability ?? 0.5) - Number(row.outcome)) ** 2; }
    groups.set(key, current);
  }
  return [...groups.values()].map((r) => ({ ...r, meanEdge: r.count ? r.meanEdge / r.count : 0, meanConfidence: r.count ? r.meanConfidence / r.count : 0, brierScore: r.resolved ? r.brier / r.resolved : null }));
}

export function simulateLimitFill({ quantity, ask, askSize = 0, limitPrice, slippage = 0, queueFactor = 1 } = {}) {
  const requested = Math.max(0, Number(quantity) || 0); const available = Math.max(0, Number(askSize) || 0);
  const executable = Number.isFinite(Number(ask)) && Number(ask) <= Number(limitPrice) ? Math.min(requested, available * Math.max(0, Math.min(1, Number(queueFactor)))) : 0;
  const filled = Number(executable.toFixed(8));
  return { requested, filled, remaining: Number((requested - filled).toFixed(8)), fillRate: requested ? filled / requested : 0, price: filled ? Number((Number(ask) + Number(slippage || 0)).toFixed(8)) : null, status: filled === 0 ? "unfilled" : filled < requested ? "partially_filled" : "filled" };
}

export function correlationWarnings(exposures = [], edges = []) {
  const warnings = [];
  for (const edge of edges) {
    const left = exposures.find((x) => x.contractId === edge.sourceId); const right = exposures.find((x) => x.contractId === edge.targetId);
    if (left && right && Number(left.exposure) + Number(right.exposure) > Number(edge.cap ?? Infinity)) warnings.push({ ...edge, combinedExposure: Number(left.exposure) + Number(right.exposure), warning: "correlated exposure cap exceeded" });
  }
  return warnings;
}

export function benchmarkHash({ previousHash = "GENESIS", payload = "" } = {}) {
  // Stable, portable digest input for the Site's async Web Crypto implementation.
  return `${previousHash}:${String(payload).length}:${String(payload).slice(0, 96)}`;
}

export function demoProbabilityForMarket(marketGroup) {
  const probabilities = {
    "ff-target-rate": 0.68,
    "us-cpi-print": 0.51,
    "gold-settlement": 0.43,
  };
  return probabilities[marketGroup] ?? 0.5;
}
