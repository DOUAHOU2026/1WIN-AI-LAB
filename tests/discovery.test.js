import test from 'node:test';
import assert from 'node:assert/strict';
import { createAviatorModel } from '../engine/games.js';
import { bootstrapMeanInterval, generateSearchCandidates, normalizeDiscoverySettings, parseGridValues, runStrategySearch } from '../engine/discovery.js';
import { reportAsCsv, reportAsJson } from '../engine/reports.js';

const model = createAviatorModel({
  reachProbabilities: { '1.2': 0.9 },
  source: 'synthetic test fixture',
  notes: 'Artificial probability for deterministic engine tests.',
  assumptionsVerified: true
});
const searchSettings = {
  rounds: 1000, paths: 3, stake: 1, bankroll: 100,
  stopLossUnits: 20, takeProfitUnits: 20, maxLossStreak: 30,
  progressionCap: 4, proportionalFraction: 0.02, proportionalFractionIsRatio: true,
  maximumRuinProbability: 1, seed: 'phase2-test-seed',
  maxCandidates: 8, shortlistSize: 2, screeningRounds: 1000, screeningPaths: 2,
  methods: ['flat', 'martingale'], targets: [1.2],
  grid: { stakes: [1, 2], bankrolls: [1, 100], stopLossUnits: [10], takeProfitUnits: [10], rounds: [1000], maxLossStreaks: [5], progressionCaps: [2], proportionalFractions: [2] }
};

test('grid parsing is bounded and rejects malformed values', () => {
  assert.deepEqual(parseGridValues('1; 2, 2', { min: 1, max: 3 }), [1, 2]);
  assert.throws(() => parseGridValues('1,2,3,4', { min: 1 }), /1 et 3 valeurs/);
  assert.throws(() => parseGridValues('NaN', { min: 1 }), /valeur invalide/);
  assert.throws(() => normalizeDiscoverySettings({ ...searchSettings, maxCandidates: 251 }), /plafond de candidats/);
});

test('candidate generator samples deterministically, assigns unique IDs, and prunes incompatible bankrolls', () => {
  const a = generateSearchCandidates(model, searchSettings);
  const b = generateSearchCandidates(model, searchSettings);
  assert.equal(a.candidates.length, 8);
  assert.ok(a.compatibleCombinations > a.candidates.length);
  assert.ok(a.skippedCombinations > 0);
  assert.equal(new Set(a.candidates.map((item) => item.id)).size, a.candidates.length);
  assert.deepEqual(a.candidates.map((item) => item.id), b.candidates.map((item) => item.id));
  assert.ok(a.candidates.every((item) => item.bankroll >= item.stake));
});

test('bootstrap confidence interval is deterministic and contains the sample mean in a stable fixture', async () => {
  const values = Array.from({ length: 40 }, (_, index) => index / 100);
  const a = await bootstrapMeanInterval(values, 'boot-seed', 500);
  const b = await bootstrapMeanInterval(values, 'boot-seed', 500);
  assert.deepEqual(a, b);
  assert.ok(a.lower < 0.195 && a.upper > 0.195);
  assert.equal(a.resamples, 500);
  await assert.rejects(() => bootstrapMeanInterval(values, 'boot-seed', 20), /100 à 5 000/);
});

test('staged search reports generated, screened, rejected, finalist and real-result counts', async () => {
  const events = [];
  const report = await runStrategySearch(model, searchSettings, { onProgress: (event) => events.push(event) });
  assert.equal(report.algorithmVersion, '2.0.0');
  assert.equal(report.counts.generated, 12);
  assert.equal(report.counts.sampled, 8);
  assert.equal(report.counts.screened, 8);
  assert.equal(report.counts.rejected, 0);
  assert.equal(report.counts.shortlisted, 2);
  assert.equal(report.counts.notAdvanced, 6);
  assert.equal(report.counts.deeplyTested, 2);
  assert.equal(report.counts.validatedIndependently, 2);
  assert.deepEqual(report.observedRealResults, []);
  assert.ok(report.strategies.every((item) => item.exploration.derivedSeed !== item.validation.derivedSeed));
  assert.ok(report.strategies.every((item) => item.bootstrapCi95?.resamples === 500));
  assert.ok(events.some((item) => item.stage === 'ELIMINATION'));
  assert.ok(events.some((item) => Number.isFinite(item.path)));
  assert.equal(events.at(-1).completed, events.at(-1).total);
  assert.ok(report.performance.durationMilliseconds >= 0);
  assert.ok(report.performance.plannedWork <= 25_000_000);
  assert.ok(report.strategies.every((item) => ['REJECTED', 'UNDER TEST', 'VALIDATED UNDER ASSUMPTIONS'].includes(item.status)));
  assert.ok(report.strategies.every((item) => typeof item.sensitivity.positiveAcrossRange === 'boolean'));
  assert.ok(report.strategies.every((item, index, all) => index === 0 || all[index - 1].rankScore >= item.rankScore));
});

test('same search parameters and seed reproduce selected IDs and simulated results', async () => {
  const first = await runStrategySearch(model, searchSettings);
  const second = await runStrategySearch(model, searchSettings);
  assert.deepEqual(first.strategies.map((item) => item.candidate.id), second.strategies.map((item) => item.candidate.id));
  assert.deepEqual(first.strategies.map((item) => item.validation.meanNetPerPath), second.strategies.map((item) => item.validation.meanNetPerPath));
  assert.deepEqual(first.rejectedStrategies.map((item) => item.candidate.id), second.rejectedStrategies.map((item) => item.candidate.id));
});

test('work cap rejects excessive combinations before starting any simulation', async () => {
  await assert.rejects(() => runStrategySearch(model, searchSettings, { maxWork: 1 }), /Recherche trop volumineuse/);
});

test('search cancellation is honored between candidates and returns no partial report', async () => {
  const controller = new AbortController();
  await assert.rejects(() => runStrategySearch(model, searchSettings, {
    signal: controller.signal,
    onProgress(event) { if (event.stage === 'SCREENING') controller.abort(); }
  }), (error) => error.name === 'AbortError');
});

test('negative theoretical expectation cannot pass screening after a lucky sample', async () => {
  const negativeModel = createAviatorModel({ reachProbabilities: { '1.2': 0.5 }, source: 'test', notes: 'test' });
  const report = await runStrategySearch(negativeModel, { ...searchSettings, maxCandidates: 8, shortlistSize: 8, grid: { ...searchSettings.grid, bankrolls: [100] } });
  assert.equal(report.counts.shortlisted, 0);
  assert.equal(report.counts.rejected, report.counts.screened);
  assert.deepEqual(report.strategies, []);
  assert.match(report.summary, /Aucun avantage statistique démontré/);
  const csv = reportAsCsv(report);
  assert.ok(csv.includes('screening_only'));
  assert.ok(csv.includes('REJECTED'));
  assert.ok(!csv.includes('undefined'));
  assert.equal(JSON.parse(reportAsJson(report)).observedRealResults.length, 0);
});
