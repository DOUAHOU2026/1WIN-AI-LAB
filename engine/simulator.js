import { createSeededRng, deriveSeed } from './seeded-rng.js';
import { holmBonferroni, meanConfidenceInterval, oneSidedDifferencePValue, oneSidedMeanPValue, wilsonInterval } from './probability.js';
import { buildStrategyCandidates, theoreticalStrategyEv, validateStrategySettings } from './strategies.js';
import { classifyStrategy, detectOverfitting } from './validation.js';

export async function simulateStrategy(gameModel, candidate, options = {}) {
  const masterSeed = String(options.seed ?? '1WIN-AI-LAB-PHASE1');
  const phase = String(options.phase ?? 'simulation');
  const seed = deriveSeed(masterSeed, phase, candidate.id);
  const reachProbability = gameModel.getReachProbability(candidate.target);
  const sessionNets = [];
  const sessionReturnRates = [];
  const sessionDrawdownRates = [];
  const sessionMaxLossStreaks = [];
  let totalWins = 0;
  let totalLosses = 0;
  let totalStaked = 0;
  let totalNet = 0;
  let ruinedPaths = 0;
  let stoppedByLimitPaths = 0;
  let maxDrawdownAmount = 0;
  const yieldEveryPaths = options.yieldEveryPaths ?? 8;

  for (let path = 0; path < candidate.paths; path += 1) {
    const random = createSeededRng(deriveSeed(seed, path));
    let bankroll = candidate.bankroll;
    let peakBankroll = bankroll;
    let pathNet = 0;
    let pathStaked = 0;
    let pathMaxDrawdown = 0;
    let currentLossStreak = 0;
    let maxLossStreak = 0;
    let previousStake = candidate.stake;
    let accumulatedLoss = 0;
    let didRuin = false;
    let stoppedByLimit = false;

    for (let round = 0; round < candidate.rounds; round += 1) {
      if (options.signal && (round & 16383) === 0) {
        if (options.signal.aborted) {
          const error = new Error('Recherche arrêtée par l’utilisateur.');
          error.name = 'AbortError';
          throw error;
        }
        if (round > 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (pathNet <= -candidate.stopLossUnits * candidate.stake || pathNet >= candidate.takeProfitUnits * candidate.stake || currentLossStreak >= candidate.maxLossStreak) {
        stoppedByLimit = true;
        break;
      }
      const stake = calculateStake(candidate, {
        bankroll,
        baseStake: candidate.stake,
        previousStake,
        consecutiveLosses: currentLossStreak,
        accumulatedLoss
      });
      if (!Number.isFinite(stake) || stake < candidate.stake || stake > bankroll) {
        didRuin = true;
        break;
      }
      totalStaked += stake;
      pathStaked += stake;
      if (random() < reachProbability) {
        const profit = stake * (candidate.target - 1);
        bankroll += profit;
        pathNet += profit;
        totalWins += 1;
        currentLossStreak = 0;
        accumulatedLoss = 0;
        previousStake = candidate.stake;
      } else {
        bankroll -= stake;
        pathNet -= stake;
        totalLosses += 1;
        currentLossStreak += 1;
        accumulatedLoss += stake;
        maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
        previousStake = stake;
      }
      peakBankroll = Math.max(peakBankroll, bankroll);
      pathMaxDrawdown = Math.max(pathMaxDrawdown, peakBankroll - bankroll);
      if (bankroll < candidate.stake - 1e-12) {
        didRuin = true;
        break;
      }
    }
    if (didRuin) ruinedPaths += 1;
    if (stoppedByLimit) stoppedByLimitPaths += 1;
    maxDrawdownAmount = Math.max(maxDrawdownAmount, pathMaxDrawdown);
    sessionNets.push(pathNet);
    sessionReturnRates.push(pathStaked ? pathNet / pathStaked : 0);
    sessionDrawdownRates.push(peakBankroll > 0 ? pathMaxDrawdown / peakBankroll : 1);
    sessionMaxLossStreaks.push(maxLossStreak);
    totalNet += pathNet;

    if (options.onProgress && ((path + 1) % yieldEveryPaths === 0 || path + 1 === candidate.paths)) {
      await options.onProgress({ path: path + 1, paths: candidate.paths, candidateId: candidate.id, phase });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const totalRounds = totalWins + totalLosses;
  const meanNet = totalNet / candidate.paths;
  const meanCi = meanConfidenceInterval(sessionNets);
  const returnCi = meanConfidenceInterval(sessionReturnRates);
  const ruinCi = wilsonInterval(ruinedPaths, candidate.paths);
  const winCi = wilsonInterval(totalWins, totalRounds);
  const theoreticalEvPerUnit = theoreticalStrategyEv(gameModel, candidate);
  const sortedDrawdowns = [...sessionDrawdownRates].sort((a, b) => a - b);
  const sortedLossStreaks = [...sessionMaxLossStreaks].sort((a, b) => a - b);
  const median = (values) => values.length ? values[Math.floor((values.length - 1) / 2)] : 0;

  return Object.freeze({
    candidateId: candidate.id,
    target: candidate.target,
    staking: candidate.staking,
    riskProfile: candidate.riskProfile,
    phase,
    masterSeed,
    derivedSeed: seed,
    roundsPerPath: candidate.rounds,
    paths: candidate.paths,
    totalRounds,
    wins: totalWins,
    losses: totalLosses,
    winRate: totalRounds ? totalWins / totalRounds : null,
    winRateCi95: winCi,
    totalStaked,
    totalNet,
    meanNetPerPath: meanNet,
    meanNetCi95: meanCi,
    meanNetPerStakeUnit: totalStaked ? totalNet / totalStaked : null,
    meanReturnPerStakeUnit: returnCi?.mean ?? null,
    meanReturnCi95: returnCi,
    theoreticalEvPerStakeUnit: theoreticalEvPerUnit,
    theoreticalLossPercent: Math.max(0, -theoreticalEvPerUnit) * 100,
    maxDrawdownAmount,
    medianMaxDrawdownRate: median(sortedDrawdowns),
    worstMaxDrawdownRate: Math.max(0, ...sessionDrawdownRates),
    ruinPaths: ruinedPaths,
    ruinProbability: ruinedPaths / candidate.paths,
    ruinCi95: ruinCi,
    stoppedByLimitPaths,
    medianMaxLossStreak: median(sortedLossStreaks),
    maxLossStreak: Math.max(0, ...sessionMaxLossStreaks),
    oneSidedPValueVsZero: oneSidedMeanPValue(sessionReturnRates),
    sessionNets,
    sessionReturnRates
  });
}

function calculateStake(candidate, state) {
  // Imported lazily by static binding below to keep the simulation hot loop small.
  const { bankroll, baseStake, previousStake, consecutiveLosses, accumulatedLoss } = state;
  const cap = baseStake * candidate.progressionCap;
  switch (candidate.staking) {
    case 'flat': return baseStake;
    case 'proportional': return bankroll * candidate.proportionalFraction;
    case 'martingale': return consecutiveLosses > 0 ? Math.min(cap, previousStake * 2) : baseStake;
    case 'recovery': return consecutiveLosses > 0 ? Math.min(cap, (accumulatedLoss + baseStake) / (candidate.target - 1)) : baseStake;
    default: throw new RangeError(`Unknown staking method: ${candidate.staking}`);
  }
}

export async function runDiscovery(gameModel, rawSettings = {}, options = {}) {
  const startedAt = performanceNow();
  const settings = validateStrategySettings(rawSettings);
  const candidates = buildStrategyCandidates(gameModel, settings);
  if (!candidates.length) throw new Error('Aucune probabilité de cash-out documentée : simulation impossible.');
  const baseline = candidates.find((candidate) => candidate.target === 1.5 && candidate.staking === 'flat' && candidate.riskProfile === 'strict')
    || candidates.find((candidate) => candidate.staking === 'flat' && candidate.riskProfile === 'strict')
    || candidates[0];
  const phases = ['exploration', 'validation_independante'];
  const phaseResults = { exploration: [], validation_independante: [] };
  const totalSteps = candidates.length * phases.length;
  let step = 0;

  for (const phase of phases) {
    for (const candidate of candidates) {
      const result = await simulateStrategy(gameModel, candidate, {
        seed: settings.seed,
        phase,
        onProgress: options.onProgress ? async (progress) => options.onProgress({ ...progress, overallStep: step, totalSteps, strategyName: candidate.name }) : undefined
      });
      phaseResults[phase].push(result);
      step += 1;
      if (options.onProgress) {
        await options.onProgress({ phase, overallStep: step, totalSteps, strategyName: candidate.name });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  const adjustedExploration = applyAdjustments(phaseResults.exploration, baseline.id, settings.alpha);
  const adjustedValidation = applyAdjustments(phaseResults.validation_independante, baseline.id, settings.alpha);
  const explorationById = Object.fromEntries(adjustedExploration.map((result) => [result.candidateId, result]));
  const validationById = Object.fromEntries(adjustedValidation.map((result) => [result.candidateId, result]));
  const combined = candidates.map((candidate) => {
    const exploration = explorationById[candidate.id];
    const validation = validationById[candidate.id];
    const overfitDetected = detectOverfitting(exploration, validation);
    const classification = classifyStrategy({
      theoreticalEv: validation.theoreticalEvPerStakeUnit,
      assumptionsVerified: gameModel.assumptionsVerified,
      validation,
      maximumRuinProbability: settings.maximumRuinProbability,
      overfitDetected,
      isBaseline: candidate.id === baseline.id
    });
    return Object.freeze({
      candidate,
      exploration,
      validation,
      overfitDetected,
      status: classification.status,
      statusReason: classification.reason,
      isBaseline: candidate.id === baseline.id
    });
  }).sort((a, b) => b.validation.meanNetPerPath - a.validation.meanNetPerPath);

  const endedAt = performanceNow();
  const report = {
    reportVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    game: { id: gameModel.id, name: gameModel.name, modelVersion: gameModel.modelVersion, classification: gameModel.classification, statusLabel: gameModel.statusLabel || null },
    assumptions: { provider: gameModel.provider || '', version: gameModel.version || '', theoreticalRtp: gameModel.theoreticalRtp ?? null, reachProbabilities: gameModel.reachProbabilities || null, source: gameModel.source || '', notes: gameModel.notes || '', verifiedByUser: Boolean(gameModel.assumptionsVerified) },
    settings,
    baselineStrategyId: baseline.id,
    strategies: combined,
    counts: { candidateStrategies: candidates.length, roundsPerPath: settings.rounds, pathsPerStrategy: settings.paths, phases: phases.length },
    performance: { durationMilliseconds: endedAt - startedAt, simulatedRounds: combined.reduce((sum, result) => sum + result.exploration.totalRounds + result.validation.totalRounds, 0) },
    limitations: [
      'Aviator reach probabilities and RTP are not inferred or prefilled.',
      'Independent validation streams are model simulations, not independent real-world game observations.',
      'Any positive status is conditional on the explicitly configured model and user-verified assumptions.',
      'Historical outcomes are not used to predict future independent rounds.'
    ]
  };
  return Object.freeze(report);
}

function applyAdjustments(results, baselineId, alpha) {
  const baseline = results.find((result) => result.candidateId === baselineId);
  const evAdjustment = holmBonferroni(results.map((result) => ({ id: result.candidateId, pValue: result.oneSidedPValueVsZero })), alpha);
  const baselineAdjustment = holmBonferroni(results.map((result) => ({
    id: result.candidateId,
    pValue: result.candidateId === baselineId ? 1 : oneSidedDifferencePValue(result.sessionReturnRates, baseline.sessionReturnRates)
  })), alpha);
  const evById = new Map(evAdjustment.map((entry) => [entry.id, entry]));
  const baselineById = new Map(baselineAdjustment.map((entry) => [entry.id, entry]));
  return results.map((result) => {
    const ev = evById.get(result.candidateId);
    const relative = baselineById.get(result.candidateId);
    return Object.freeze({
      ...result,
      evAdjustedPValue: ev.adjustedPValue,
      evPositiveCorrected: ev.reject,
      baselineAdjustedPValue: relative.adjustedPValue,
      baselinePositiveCorrected: relative.reject
    });
  });
}

function performanceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}
