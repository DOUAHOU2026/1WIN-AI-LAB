import { theoreticalCrashDistribution, validateDistribution, validateProbability } from './probability.js';

export const AVIATOR_TARGETS = Object.freeze([1.2, 1.5, 2, 3, 5, 10]);
export const INSUFFICIENT_DATA_LABEL = 'DONNÉES INSUFFISANTES POUR UNE ANALYSE FIABLE';
export const MODEL_LABEL = 'MODÈLE THÉORIQUE — NON VÉRIFIÉ SUR LA VERSION 1WIN';

export const GAME_CATALOG = Object.freeze([
  { id: 'aviator', name: 'Aviator', family: 'Crash', implemented: true },
  { id: 'mines', name: 'Mines', family: 'Grille', implemented: false },
  { id: 'dice', name: 'Dice', family: 'Lancer', implemented: false },
  { id: 'plinko', name: 'Plinko', family: 'Chute', implemented: false },
  { id: 'crash-generic', name: 'Crash générique', family: 'Crash', implemented: false }
]);

/**
 * Configurable Aviator-style binary cash-out model.
 * Reach probabilities are supplied explicitly; RTP is metadata and is never used to infer them.
 */
export function createAviatorModel(config = {}) {
  const probabilities = {};
  for (const target of AVIATOR_TARGETS) {
    const value = config.reachProbabilities?.[String(target)];
    if (value !== undefined && value !== null && value !== '') {
      probabilities[String(target)] = validateProbability(Number(value), `reach probability at ${target}x`);
    }
  }
  let previous = null;
  for (const target of AVIATOR_TARGETS) {
    const value = probabilities[String(target)];
    if (value === undefined) continue;
    if (previous !== null && value > previous + 1e-12) {
      throw new RangeError('Reach probability cannot increase when the cash-out target increases.');
    }
    previous = value;
  }
  const theoreticalRtp = config.theoreticalRtp === '' || config.theoreticalRtp == null ? null : Number(config.theoreticalRtp);
  if (theoreticalRtp !== null && (!Number.isFinite(theoreticalRtp) || theoreticalRtp < 0 || theoreticalRtp > 100)) {
    throw new RangeError('Theoretical RTP must be between 0 and 100 percent.');
  }
  const source = String(config.source || '').trim();
  const notes = String(config.notes || '').trim();
  const model = {
    id: 'aviator',
    name: 'Aviator (modèle crash configurable)',
    family: 'Crash',
    modelVersion: '1.0.0',
    classification: 'THEORETICAL',
    provider: String(config.provider || '').trim(),
    version: String(config.version || '').trim(),
    theoreticalRtp,
    reachProbabilities: Object.freeze(probabilities),
    source,
    notes,
    assumptionsVerified: Boolean(config.assumptionsVerified && source && notes),
    statusLabel: MODEL_LABEL,
    knownTargets: Object.freeze(AVIATOR_TARGETS.filter((target) => probabilities[String(target)] !== undefined)),
    getReachProbability(target) {
      const probability = probabilities[String(Number(target))];
      if (probability === undefined) throw new Error(`No documented reach probability was supplied for ${target}x.`);
      return probability;
    },
    outcomeDistribution(target) {
      return theoreticalCrashDistribution(Number(target), this.getReachProbability(target));
    },
    describeRules(target) {
      return {
        target: Number(target),
        reachProbability: this.getReachProbability(target),
        winGrossMultiplier: Number(target),
        winNetPerUnit: Number(target) - 1,
        lossNetPerUnit: -1,
        probabilitySource: source || 'UNSPECIFIED USER INPUT',
        classification: this.classification
      };
    }
  };
  return Object.freeze(model);
}

export function createDiscreteGameModel(config) {
  if (!config?.id || !config?.name || !Array.isArray(config.outcomes)) throw new TypeError('A discrete game requires id, name, and outcomes.');
  const outcomes = validateDistribution(config.outcomes.map((outcome) => ({
    ...outcome,
    netPerUnit: Number(outcome.netPerUnit),
    probability: Number(outcome.probability)
  })));
  return Object.freeze({
    id: String(config.id),
    name: String(config.name),
    family: String(config.family || 'Custom'),
    modelVersion: String(config.modelVersion || '1.0.0'),
    classification: 'THEORETICAL',
    source: String(config.source || ''),
    notes: String(config.notes || ''),
    assumptionsVerified: Boolean(config.assumptionsVerified && config.source && config.notes),
    knownTargets: Object.freeze([]),
    outcomeDistribution: () => outcomes
  });
}

export function getGameCatalog() {
  return GAME_CATALOG.map((game) => ({ ...game, status: game.implemented ? 'CONFIGURABLE MODEL' : INSUFFICIENT_DATA_LABEL }));
}

