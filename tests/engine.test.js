import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distributionVariance, expectedValue, holmBonferroni, meanConfidenceInterval,
  theoreticalCrashDistribution, wilsonInterval
} from '../engine/probability.js';
import { createAviatorModel, getGameCatalog } from '../engine/games.js';
import { createSeededRng } from '../engine/seeded-rng.js';
import { buildStrategyCandidates, validateStrategySettings } from '../engine/strategies.js';
import { runDiscovery, simulateStrategy } from '../engine/simulator.js';
import { classifyStrategy, detectOverfitting } from '../engine/validation.js';
import { reportAsCsv, reportAsJson } from '../engine/reports.js';

const quickSettings = { rounds: 1000, paths: 8, stake: 1, bankroll: 10000, stopLossUnits: 20, takeProfitUnits: 20, maxLossStreak: 40, progressionCap: 8, seed: 'unit-test-seed' };

test('crash outcome model computes expected value and variance exactly', () => {
  const distribution = theoreticalCrashDistribution(2, 0.5);
  assert.equal(expectedValue(distribution), 0);
  assert.equal(distributionVariance(distribution), 1);
  assert.throws(() => theoreticalCrashDistribution(1, 0.5), /greater than 1/);
  assert.throws(() => theoreticalCrashDistribution(2, 1.1), /between 0 and 1/);
});

test('Aviator configuration never infers probabilities from RTP', () => {
  const model = createAviatorModel({ theoreticalRtp: 97 });
  assert.equal(model.theoreticalRtp, 97);
  assert.deepEqual(model.knownTargets, []);
  assert.throws(() => model.getReachProbability(2), /No documented reach probability/);
  assert.throws(() => model.outcomeDistribution(2), /No documented reach probability/);
  assert.ok(getGameCatalog().filter((game) => !game.implemented).every((game) => game.status.includes('DONNÉES INSUFFISANTES')));
});

test('Aviator rejects impossible or malformed probability tables', () => {
  assert.throws(() => createAviatorModel({ reachProbabilities: { '1.2': 0.5, '2': 0.7 } }), /cannot increase/);
  assert.throws(() => createAviatorModel({ reachProbabilities: { '2': 1.01 } }), /between 0 and 1/);
  const model = createAviatorModel({ reachProbabilities: { '1.2': 0.7, '2': 0.4 } });
  assert.deepEqual(model.knownTargets, [1.2, 2]);
  assert.deepEqual(model.outcomeDistribution(2).map((item) => item.netPerUnit), [1, -1]);
});

test('seeded random generator reproduces the same stream', () => {
  const first = createSeededRng('repeatable');
  const second = createSeededRng('repeatable');
  const other = createSeededRng('different');
  const a = Array.from({ length: 100 }, first);
  assert.deepEqual(a, Array.from({ length: 100 }, second));
  assert.notDeepEqual(a, Array.from({ length: 100 }, other));
  assert.ok(a.every((value) => value >= 0 && value < 1));
});

test('confidence intervals handle empty, exact, and observed samples', () => {
  assert.equal(wilsonInterval(0, 0), null);
  const interval = wilsonInterval(50, 100);
  assert.ok(interval[0] < 0.5 && interval[1] > 0.5);
  const mean = meanConfidenceInterval([1, 2, 3, 4, 5]);
  assert.equal(mean.mean, 3);
  assert.ok(mean.lower < mean.mean && mean.upper > mean.mean);
});

test('Holm-Bonferroni corrects a family of candidate tests', () => {
  const adjusted = holmBonferroni([{ id: 'a', pValue: 0.01 }, { id: 'b', pValue: 0.04 }, { id: 'c', pValue: 0.03 }]);
  assert.equal(adjusted.find((item) => item.id === 'a').reject, true);
  assert.equal(adjusted.find((item) => item.id === 'b').reject, false);
  assert.equal(adjusted.find((item) => item.id === 'c').reject, false);
  assert.ok(adjusted.every((item) => item.adjustedPValue >= item.pValue));
});

test('strategy space keeps parameters matched and exposes capped methods', () => {
  const model = createAviatorModel({ reachProbabilities: { '1.2': 0.7, '2': 0.4 } });
  const candidates = buildStrategyCandidates(model, quickSettings);
  assert.equal(candidates.length, 16);
  assert.ok(candidates.some((candidate) => candidate.staking === 'martingale'));
  assert.ok(candidates.some((candidate) => candidate.staking === 'recovery'));
  assert.equal(new Set(candidates.map((candidate) => candidate.stake)).size, 1);
  assert.throws(() => validateStrategySettings({ ...quickSettings, rounds: 5000 }), /1,000, 10,000, or 100,000/);
  assert.throws(() => validateStrategySettings({ ...quickSettings, paths: 1 }), /from 2 to 100/);
});

test('simulation reproduces wins, net, risk, and validation seeds', async () => {
  const model = createAviatorModel({ reachProbabilities: { '1.2': 0.7 } });
  const candidate = buildStrategyCandidates(model, quickSettings)[0];
  const a = await simulateStrategy(model, candidate, { seed: 'same', phase: 'exploration' });
  const b = await simulateStrategy(model, candidate, { seed: 'same', phase: 'exploration' });
  const holdout = await simulateStrategy(model, candidate, { seed: 'same', phase: 'validation_independante' });
  assert.equal(a.wins, b.wins);
  assert.equal(a.totalNet, b.totalNet);
  assert.deepEqual(a.sessionNets, b.sessionNets);
  assert.notEqual(a.derivedSeed, holdout.derivedSeed);
  assert.equal(a.totalRounds, a.wins + a.losses);
  assert.equal(a.paths, quickSettings.paths);
  assert.ok(a.ruinProbability >= 0 && a.ruinProbability <= 1);
});

test('virtual stop loss stops paths without inventing extra rounds', async () => {
  const model = createAviatorModel({ reachProbabilities: { '1.2': 0 } });
  const [candidate] = buildStrategyCandidates(model, { ...quickSettings, bankroll: 100, stopLossUnits: 2, takeProfitUnits: 50, maxLossStreak: 50 });
  const result = await simulateStrategy(model, candidate, { seed: 'all-losses', phase: 'risk-test' });
  assert.equal(result.totalRounds, 16);
  assert.equal(result.losses, 16);
  assert.equal(result.stoppedByLimitPaths, 8);
  assert.equal(result.ruinPaths, 0);
});

test('profit validation rejects negative EV and flags exploration-only winners', () => {
  const rejected = classifyStrategy({ theoreticalEv: -0.03, assumptionsVerified: true, validation: { ruinProbability: 0, evPositiveCorrected: true, baselinePositiveCorrected: true }, maximumRuinProbability: 0.1, overfitDetected: false, isBaseline: false });
  assert.equal(rejected.status, 'REJECTED');
  const exploration = { evPositiveCorrected: true, meanNetPerPath: 10, baselinePositiveCorrected: true };
  const validation = { evPositiveCorrected: false, meanNetPerPath: -1, baselinePositiveCorrected: false };
  assert.equal(detectOverfitting(exploration, validation), true);
  assert.equal(classifyStrategy({ theoreticalEv: 0.01, assumptionsVerified: false, validation: { ruinProbability: 0, evPositiveCorrected: true, baselinePositiveCorrected: true }, maximumRuinProbability: 0.1, overfitDetected: false, isBaseline: false }).status, 'UNDER TEST');
});

test('discovery keeps exploration and holdout separate and emits honest JSON/CSV reports', async () => {
  const model = createAviatorModel({ reachProbabilities: { '1.2': 0.5 }, source: 'synthetic unit fixture', notes: 'Test-only configuration.' });
  const report = await runDiscovery(model, { ...quickSettings, rounds: 1000, paths: 5 });
  assert.equal(report.counts.candidateStrategies, 8);
  assert.ok(report.strategies.every((item) => item.exploration.derivedSeed !== item.validation.derivedSeed));
  assert.ok(report.strategies.every((item) => item.status === 'REJECTED'));
  const json = reportAsJson(report);
  assert.equal(JSON.parse(json).game.id, 'aviator');
  const csv = reportAsCsv(report);
  assert.ok(csv.startsWith('game_id,game_name,model_version'));
  assert.ok(csv.includes('validation_independante'));
  assert.ok(report.performance.durationMilliseconds >= 0);
});

