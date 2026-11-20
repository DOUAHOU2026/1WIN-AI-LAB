export const STAKING_METHODS = Object.freeze([
  { id: 'flat', label: 'Mise fixe' },
  { id: 'proportional', label: 'Pourcentage du capital' },
  { id: 'martingale', label: 'Martingale plafonnée' },
  { id: 'recovery', label: 'Récupération plafonnée' }
]);

const RISK_PROFILES = Object.freeze([
  { id: 'strict', label: 'Limites strictes', factor: 1 },
  { id: 'wide', label: 'Limites élargies ×2', factor: 2 }
]);

export function validateStrategySettings(settings = {}) {
  const stake = Number(settings.stake ?? 1);
  const bankroll = Number(settings.bankroll ?? 100);
  const rounds = Number(settings.rounds ?? 10000);
  const paths = Number(settings.paths ?? 20);
  const stopLossUnits = Number(settings.stopLossUnits ?? 25);
  const takeProfitUnits = Number(settings.takeProfitUnits ?? 25);
  const maxLossStreak = Number(settings.maxLossStreak ?? 12);
  const progressionCap = Number(settings.progressionCap ?? 8);
  const proportionalFraction = settings.proportionalFractionIsRatio
    ? Number(settings.proportionalFraction)
    : Number(settings.proportionalFraction ?? 2) / 100;
  const alpha = Number(settings.alpha ?? 0.05);
  const maximumRuinProbability = Number(settings.maximumRuinProbability ?? 0.5);
  const seed = String(settings.seed ?? '1WIN-AI-LAB-PHASE1').trim();

  if (!(stake > 0) || !(bankroll >= stake)) throw new RangeError('Virtual bankroll must cover a positive base stake.');
  if (![1000, 10000, 100000].includes(rounds)) throw new RangeError('Round count must be 1,000, 10,000, or 100,000.');
  if (!Number.isInteger(paths) || paths < 2 || paths > 100) throw new RangeError('Independent trajectories must be an integer from 2 to 100.');
  if (!(stopLossUnits > 0) || !(takeProfitUnits > 0)) throw new RangeError('Virtual stop-loss and take-profit limits must be positive.');
  if (!Number.isInteger(maxLossStreak) || maxLossStreak < 1) throw new RangeError('Maximum loss streak must be a positive integer.');
  if (!(progressionCap >= 1 && progressionCap <= 1000)) throw new RangeError('Progression cap must be from 1x to 1,000x the base stake.');
  if (!(proportionalFraction > 0 && proportionalFraction <= 0.5)) throw new RangeError('Proportional stake must be greater than 0% and at most 50%.');
  if (!(alpha > 0 && alpha < 0.5)) throw new RangeError('Alpha must be between 0 and 0.5.');
  if (!(maximumRuinProbability >= 0 && maximumRuinProbability <= 1)) throw new RangeError('Maximum ruin probability must be between 0% and 100%.');
  if (!seed) throw new RangeError('A non-empty random seed is required.');

  return Object.freeze({ stake, bankroll, rounds, paths, stopLossUnits, takeProfitUnits, maxLossStreak, progressionCap, proportionalFraction, proportionalFractionIsRatio: true, alpha, maximumRuinProbability, seed });
}

export function buildStrategyCandidates(gameModel, rawSettings = {}) {
  const settings = validateStrategySettings(rawSettings);
  const targets = gameModel.knownTargets || [];
  const candidates = [];
  for (const target of targets) {
    for (const method of STAKING_METHODS) {
      for (const profile of RISK_PROFILES) {
        const factor = profile.factor;
        const id = `${String(target).replace('.', 'p')}-${method.id}-${profile.id}`;
        candidates.push(Object.freeze({
          id,
          name: `${target}× · ${method.label} · ${profile.label}`,
          target,
          staking: method.id,
          stakingLabel: method.label,
          riskProfile: profile.id,
          riskProfileLabel: profile.label,
          profileFactor: factor,
          stake: settings.stake,
          bankroll: settings.bankroll,
          proportionalFraction: settings.proportionalFraction,
          progressionCap: settings.progressionCap * factor,
          stopLossUnits: settings.stopLossUnits * factor,
          takeProfitUnits: settings.takeProfitUnits * factor,
          maxLossStreak: Math.ceil(settings.maxLossStreak * factor),
          rounds: settings.rounds,
          paths: settings.paths
        }));
      }
    }
  }
  return candidates;
}

export function theoreticalStrategyEv(gameModel, candidate) {
  const outcomes = gameModel.outcomeDistribution(candidate.target);
  return outcomes.reduce((sum, outcome) => sum + outcome.probability * outcome.netPerUnit, 0);
}

export function calculateStake(candidate, state) {
  const { bankroll, baseStake, previousStake, consecutiveLosses, accumulatedLoss } = state;
  const cap = baseStake * candidate.progressionCap;
  if (candidate.staking === 'flat') return baseStake;
  if (candidate.staking === 'proportional') return bankroll * candidate.proportionalFraction;
  if (candidate.staking === 'martingale') return consecutiveLosses > 0 ? Math.min(cap, previousStake * 2) : baseStake;
  if (candidate.staking === 'recovery') {
    if (consecutiveLosses === 0) return baseStake;
    const recoveryStake = (accumulatedLoss + baseStake) / (candidate.target - 1);
    return Math.min(cap, recoveryStake);
  }
  throw new RangeError(`Unsupported staking method: ${candidate.staking}`);
}

