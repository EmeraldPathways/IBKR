import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateEdge,
  estimateCosts,
  freshQuote,
  normalizeNoProbability,
  riskChecks,
  roundToTick,
  scoreMarketQuality,
  scoringMetrics,
  fractionalKelly,
  rankOpportunity,
  executionQuality,
  walkForwardBrier,
  calibrationDiagnostics,
  stressTestPortfolio,
  edgeDecay,
  resolutionIntegrity,
  purgedWalkForwardBrier,
  abstentionDiagnostics,
  forecastEdgeMap,
  simulateLimitFill,
  correlationWarnings,
} from "../lib/trading-logic.mjs";

test("YES and NO probabilities normalize to one", () => {
  assert.equal(normalizeNoProbability(0.62), 0.38);
  assert.throws(() => normalizeNoProbability(1.1), /between 0 and 1/);
});

test("edge calculation subtracts fee, slippage and uncertainty", () => {
  const result = calculateEdge({
    estimatedProbability: 0.72,
    quote: 0.61,
    side: "YES",
    fee: 0.006,
    slippage: 0.004,
    uncertaintyPenalty: 0.002,
  });
  assert.ok(Math.abs(result.grossEdge - 0.11) < 1e-12);
  assert.ok(Math.abs(result.netEdge - 0.098) < 1e-12);
  assert.equal(calculateEdge({ estimatedProbability: 0.72, quote: 0.25, side: "NO" }).sideProbability, 0.28);
});

test("cost estimate is bounded and confidence-sensitive", () => {
  const lowConfidence = estimateCosts({ quote: 0.80, confidence: 0.50 });
  const highConfidence = estimateCosts({ quote: 0.80, confidence: 0.90 });
  assert.equal(lowConfidence.fee, 0.006);
  assert.equal(lowConfidence.slippage, 0.012);
  assert.ok(lowConfidence.uncertaintyPenalty > highConfidence.uncertaintyPenalty);
});

test("prices round to the contract tick size", () => {
  assert.equal(roundToTick(0.553, 0.01), 0.55);
  assert.equal(roundToTick(0.557, 0.01), 0.56);
  assert.equal(roundToTick(2.49, 1), 2);
});

test("risk checks enforce exposure, loss, floor, order and concurrency limits", () => {
  const config = {
    maxPositionPerContractUsd: 50,
    maxTotalExposureUsd: 250,
    maxOrderSizeUsd: 20,
    maxDailyLossUsd: 30,
    minAccountFloorPercent: 20,
    maxConcurrentOrders: 3,
  };
  const passing = riskChecks({
    quantity: 10,
    price: 0.55,
    currentExposure: 0,
    totalExposure: 0,
    dailyPnl: 0,
    startingCapital: 1000,
    openOrders: 0,
    config,
  });
  assert.equal(passing.pass, true);
  assert.equal(passing.notional, 5.5);

  const halted = riskChecks({
    quantity: 40,
    price: 0.55,
    currentExposure: 45,
    totalExposure: 245,
    dailyPnl: -30,
    startingCapital: 1000,
    openOrders: 3,
    config,
  });
  assert.equal(halted.pass, false);
  assert.equal(halted.checks.find((check) => check.key === "position_cap").pass, false);
  assert.equal(halted.checks.find((check) => check.key === "daily_loss").pass, false);
  assert.equal(halted.checks.find((check) => check.key === "concurrency").pass, false);
});

test("stale quotes fail closed", () => {
  const now = Date.parse("2026-09-05T12:00:00.000Z");
  assert.equal(freshQuote("2026-09-05T11:59:30.000Z", 90, now), true);
  assert.equal(freshQuote("2026-09-05T11:57:00.000Z", 90, now), false);
  assert.equal(freshQuote("not-a-date", 90, now), false);
});

test("market quality score penalizes stale, unclear and illiquid markets", () => {
  const strong = scoreMarketQuality({ spread: 0.01, availableSize: 100, quoteAgeSeconds: 10, resolutionClarity: 1, evidenceFreshness: 1, sourceReliability: 1, permissionEligible: true, slippage: 0.002 });
  const weak = scoreMarketQuality({ spread: 0.1, availableSize: 0, quoteAgeSeconds: 600, resolutionClarity: 0, evidenceFreshness: 0, sourceReliability: 0, permissionEligible: false, slippage: 0.03 });
  assert.ok(strong.score > weak.score);
  assert.ok(strong.score >= 80);
});

test("scoring metrics report calibration and proper losses", () => {
  const metrics = scoringMetrics([
    { probability: 0.8, outcome: 1 },
    { probability: 0.2, outcome: 0 },
    { probability: 0.7, outcome: 0 },
    { probability: 0.4, outcome: 1 },
  ]);
  assert.equal(metrics.sampleSize, 4);
  assert.ok(metrics.brierScore > 0 && metrics.brierScore < 1);
  assert.ok(metrics.logLoss > 0);
  assert.equal(metrics.calibration.length, 4);
});

test("position sizing is conservative and capped", () => {
  assert.ok(fractionalKelly({ probability: 0.7, price: 0.5, fraction: 0.25, maxFraction: 0.02 }) <= 0.02);
  assert.equal(fractionalKelly({ probability: 0.4, price: 0.5, fraction: 0.25, maxFraction: 0.02 }), 0);
});

test("opportunity ranking penalizes weak execution conditions", () => {
  const strong = rankOpportunity({ netEdge: 0.1, confidence: 0.8, marketQuality: 90, resolutionReady: true, quoteFresh: true });
  const weak = rankOpportunity({ netEdge: 0.01, confidence: 0.4, marketQuality: 20, resolutionReady: false, quoteFresh: false });
  assert.ok(strong > weak);
});

test("execution analytics measure movement and fill rate", () => {
  const result = executionQuality({ decisionQuote: 0.5, submissionQuote: 0.52, fillPrice: 0.53, requestedQuantity: 10, filledQuantity: 6 });
  assert.ok(Math.abs(result.decisionToSubmissionMove - 0.02) < 1e-12);
  assert.ok(Math.abs(result.slippage - 0.01) < 1e-12);
  assert.equal(result.fillRate, 0.6);
});

test("walk-forward analytics are out of sample", () => {
  const result = walkForwardBrier({ minimumTraining: 2, forecasts: [
    { probability: 0.5, outcome: 1, observedAt: "2026-01-01" },
    { probability: 0.5, outcome: 0, observedAt: "2026-01-02" },
    { probability: 0.8, outcome: 1, observedAt: "2026-01-03" },
  ] });
  assert.equal(result.sampleSize, 1);
  assert.equal(result.folds[0].trainingBaseRate, 0.5);
});

test("professional diagnostics measure calibration, stress and edge direction", () => {
  const calibration = calibrationDiagnostics([{ probability: 0.8, outcome: 1 }, { probability: 0.2, outcome: 0 }, { probability: 0.7, outcome: 0 }]);
  assert.equal(calibration.sampleSize, 3);
  assert.ok(calibration.expectedCalibrationError > 0);
  const stress = stressTestPortfolio({ exposures: [{ exposure: 100 }, { exposure: 50 }], capital: 200, shocks: [-0.5] });
  assert.equal(stress[0].estimatedLoss, 75);
  assert.equal(stress[0].capitalAfterShock, 125);
  assert.equal(edgeDecay([{ edge: 0.1, observedAt: "2026-01-01" }, { edge: 0.06, observedAt: "2026-01-02" }]).trend, "decaying");
});

test("resolution integrity fails closed when settlement evidence is incomplete", () => {
  const ready = resolutionIntegrity({ resolutionCriteria: "Official release published by the named authority.", resolutionSourceUrl: "https://official.example/rules", expiration: "2099-01-01T00:00:00Z", ambiguityScore: 0.1 });
  const unclear = resolutionIntegrity({ resolutionCriteria: "", resolutionSourceUrl: "", expiration: "not-a-date", ambiguityScore: 1 });
  assert.equal(ready.decision, "tradable");
  assert.equal(unclear.decision, "unclear");
});

test("purged and embargoed walk-forward stays time ordered", () => {
  const result = purgedWalkForwardBrier({ minimumTraining: 2, purgeDays: 1, embargoDays: 2, forecasts: [
    { probability: 0.5, outcome: 1, observedAt: "2026-01-01" },
    { probability: 0.5, outcome: 0, observedAt: "2026-01-03" },
    { probability: 0.8, outcome: 1, observedAt: "2026-01-05" },
  ] });
  assert.equal(result.sampleSize, 1);
  assert.equal(result.embargoDays, 2);
  assert.ok(result.folds[0].trainingBaseRate >= 0 && result.folds[0].trainingBaseRate <= 1);
});

test("abstention, edge maps and realistic limit fills are explicit", () => {
  assert.equal(abstentionDiagnostics({ forecasts: [{ probability: 0.7, confidence: 0.4 }, { probability: 0.7, confidence: 0.8 }], minimumConfidence: 0.6 }).abstained, 1);
  assert.equal(forecastEdgeMap([{ segment: "macro", edge: 0.1, confidence: 0.8 }])[0].segment, "macro");
  const fill = simulateLimitFill({ quantity: 10, ask: 0.5, askSize: 4, limitPrice: 0.5 });
  assert.equal(fill.status, "partially_filled");
  assert.equal(fill.remaining, 6);
  assert.equal(correlationWarnings([{ contractId: "a", exposure: 80 }, { contractId: "b", exposure: 80 }], [{ sourceId: "a", targetId: "b", cap: 100 }]).length, 1);
});
