import { createAviatorModel } from '../engine/games.js';
import { runDiscovery } from '../engine/simulator.js';

const model = createAviatorModel({
  reachProbabilities: { '1.2': 0.82, '1.5': 0.66, '2': 0.48, '3': 0.32, '5': 0.19, '10': 0.095 },
  source: 'Synthetic performance fixture only',
  notes: 'Not Aviator data; used only to measure the engine.'
});
const before = process.memoryUsage();
const start = performance.now();
const report = await runDiscovery(model, {
  rounds: 100000,
  paths: 2,
  stake: 1,
  bankroll: 1000000,
  stopLossUnits: 500000,
  takeProfitUnits: 500000,
  maxLossStreak: 100000,
  progressionCap: 8,
  seed: 'benchmark-synthetic-only'
});
const end = performance.now();
const after = process.memoryUsage();
const elapsedSeconds = (end - start) / 1000;
console.log(JSON.stringify({
  benchmark: 'Synthetic fixture; not Aviator outcome analysis',
  candidates: report.counts.candidateStrategies,
  roundsPerPath: report.counts.roundsPerPath,
  pathsPerStrategy: report.counts.pathsPerStrategy,
  phases: report.counts.phases,
  simulatedRounds: report.performance.simulatedRounds,
  wallMilliseconds: Math.round(end - start),
  roundsPerSecond: Math.round(report.performance.simulatedRounds / elapsedSeconds),
  heapDeltaBytes: after.heapUsed - before.heapUsed,
  rssDeltaBytes: after.rss - before.rss
}, null, 2));

