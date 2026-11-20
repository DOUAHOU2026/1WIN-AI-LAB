import { createAviatorModel } from '../engine/games.js';
import { runStrategySearch } from '../engine/discovery.js';

const model = createAviatorModel({
  reachProbabilities: { '1.2': 1, '1.5': 1, '2': 1, '3': 1, '5': 1, '10': 1 },
  source: 'Synthetic performance fixture only',
  notes: 'Not Aviator data; used only to measure candidate discovery.'
});
const before = process.memoryUsage();
const start = performance.now();
const report = await runStrategySearch(model, {
  rounds: 10000,
  paths: 5,
  stake: 1,
  bankroll: 200,
  stopLossUnits: 25,
  takeProfitUnits: 1000000,
  maxLossStreak: 100,
  progressionCap: 8,
  maximumRuinProbability: 1,
  maxCandidates: 48,
  shortlistSize: 8,
  screeningRounds: 1000,
  screeningPaths: 2,
  methods: ['flat'],
  grid: { stakes: [1, 2, 3], bankrolls: [100, 200], stopLossUnits: [25], takeProfitUnits: [1000000], rounds: [10000], maxLossStreaks: [100], progressionCaps: [8], proportionalFractions: [2] },
  seed: 'benchmark-synthetic-only'
});
const end = performance.now();
const after = process.memoryUsage();
const elapsedSeconds = (end - start) / 1000;
console.log(JSON.stringify({
  benchmark: 'Synthetic fixture; not Aviator outcome analysis',
  compatibleCombinations: report.counts.generated,
  sampledCandidates: report.counts.sampled,
  screenedCandidates: report.counts.screened,
  finalists: report.counts.shortlisted,
  roundsPerSecond: Math.round(report.counts.simulatedRounds / elapsedSeconds),
  plannedWork: report.performance.plannedWork,
  simulatedRounds: report.counts.simulatedRounds,
  wallMilliseconds: Math.round(end - start),
  heapDeltaBytes: after.heapUsed - before.heapUsed,
  rssDeltaBytes: after.rss - before.rss
}, null, 2));
