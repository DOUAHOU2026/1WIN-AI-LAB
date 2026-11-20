import { createSeededRng, deriveSeed } from './seeded-rng.js';
import { holmBonferroni, oneSidedDifferencePValue } from './probability.js';
import { validateStrategySettings } from './strategies.js';
import { simulateStrategy } from './simulator.js';
import { classifyStrategy, detectOverfitting } from './validation.js';

export const DISCOVERY_ALGORITHM_VERSION = '2.0.0';
export const MAX_DISCOVERY_CANDIDATES = 250;
export const MAX_DISCOVERY_WORK = 25_000_000;

const DEFAULT_GRID = Object.freeze({
  stakes: [1], bankrolls: [1000], stopLossUnits: [25], takeProfitUnits: [25],
  rounds: [10000], maxLossStreaks: [12], progressionCaps: [8], proportionalFractions: [2]
});

export function parseGridValues(value, { min = 0, max = Infinity, integer = false, label = 'Valeur' } = {}) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/[;,\s]+/).filter(Boolean);
  if (!parts.length || parts.length > 3) throw new RangeError(`${label}: entre 1 et 3 valeurs sont requises.`);
  const values = parts.map((part) => Number(part));
  if (values.some((number) => !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number)))) {
    throw new RangeError(`${label}: valeur invalide (limite ${min} à ${max}${integer ? ', entier' : ''}).`);
  }
  return [...new Set(values)];
}

export async function bootstrapMeanInterval(values, seed, resamples = 500, signal) {
  if (!Array.isArray(values) || values.length < 2) return null;
  if (!Number.isInteger(resamples) || resamples < 100 || resamples > 5000) throw new RangeError('Le bootstrap accepte 100 à 5 000 rééchantillonnages.');
  const rng = createSeededRng(deriveSeed(seed, 'bootstrap', 'mean'));
  const means = new Array(resamples);
  for (let sample = 0; sample < resamples; sample += 1) {
    if (signal?.aborted) throw abortError();
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) sum += values[Math.floor(rng() * values.length)];
    means[sample] = sum / values.length;
    if ((sample + 1) % 25 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  means.sort((a, b) => a - b);
  return Object.freeze({ lower: means[Math.floor((resamples - 1) * 0.025)], upper: means[Math.floor((resamples - 1) * 0.975)], resamples, seed: deriveSeed(seed, 'bootstrap', 'mean') });
}

export function normalizeDiscoverySettings(raw = {}) {
  const base = validateStrategySettings(raw);
  const maxCandidates = Number(raw.maxCandidates ?? 48);
  const shortlistSize = Number(raw.shortlistSize ?? 8);
  const screeningRounds = Number(raw.screeningRounds ?? Math.max(1000, Math.min(10000, base.rounds)));
  const screeningPaths = Number(raw.screeningPaths ?? Math.min(4, base.paths));
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > MAX_DISCOVERY_CANDIDATES) throw new RangeError(`Le plafond de candidats doit être un entier entre 1 et ${MAX_DISCOVERY_CANDIDATES}.`);
  if (!Number.isInteger(shortlistSize) || shortlistSize < 1 || shortlistSize > maxCandidates) throw new RangeError('La présélection doit être comprise entre 1 et le plafond de candidats.');
  if (![1000, 10000, 100000].includes(screeningRounds)) throw new RangeError('Le filtrage initial accepte 1 000, 10 000 ou 100 000 manches.');
  if (!Number.isInteger(screeningPaths) || screeningPaths < 2 || screeningPaths > 20) throw new RangeError('Le filtrage initial accepte 2 à 20 trajectoires.');
  const gridRaw = raw.grid || {};
  const grid = {
    stakes: parseGridValues(gridRaw.stakes ?? DEFAULT_GRID.stakes, { min: 0.01, max: 1e9, label: 'Mises virtuelles' }),
    bankrolls: parseGridValues(gridRaw.bankrolls ?? DEFAULT_GRID.bankrolls, { min: 0.01, max: 1e12, label: 'Capitaux virtuels' }),
    stopLossUnits: parseGridValues(gridRaw.stopLossUnits ?? DEFAULT_GRID.stopLossUnits, { min: 0.01, max: 1e6, label: 'Stop-loss' }),
    takeProfitUnits: parseGridValues(gridRaw.takeProfitUnits ?? DEFAULT_GRID.takeProfitUnits, { min: 0.01, max: 1e6, label: 'Limites de gains' }),
    rounds: parseGridValues(gridRaw.rounds ?? [base.rounds], { min: 1000, max: 100000, integer: true, label: 'Durées de session' }).filter((n) => [1000, 10000, 100000].includes(n)),
    maxLossStreaks: parseGridValues(gridRaw.maxLossStreaks ?? [base.maxLossStreak], { min: 1, max: 10000, integer: true, label: 'Séries de pertes' }),
    progressionCaps: parseGridValues(gridRaw.progressionCaps ?? [base.progressionCap], { min: 1, max: 1000, label: 'Plafonds de progression' }),
    proportionalFractions: parseGridValues(gridRaw.proportionalFractions ?? [base.proportionalFraction * 100], { min: 0.01, max: 50, label: 'Mises proportionnelles (%)' })
  };
  if (!grid.rounds.length) throw new RangeError('Les durées doivent être 1 000, 10 000 ou 100 000 manches.');
  const methods = raw.methods ?? ['flat', 'proportional', 'martingale', 'recovery'];
  if (!Array.isArray(methods) || !methods.length || methods.some((method) => !['flat', 'proportional', 'martingale', 'recovery'].includes(method))) throw new RangeError('Méthodes incompatibles dans la grille de recherche.');
  const targets = raw.targets ?? null;
  return Object.freeze({ ...base, maxCandidates, shortlistSize, screeningRounds, screeningPaths, grid: Object.freeze(grid), methods: Object.freeze([...new Set(methods)]), targets: targets ? Object.freeze([...new Set(targets.map(Number))]) : null });
}

export function generateSearchCandidates(gameModel, rawSettings = {}) {
  const settings = normalizeDiscoverySettings(rawSettings);
  const targets = settings.targets || gameModel.knownTargets || [];
  if (!targets.length) return { settings, candidates: [], compatibleCombinations: 0, skippedCombinations: 0 };
  if (targets.some((target) => !gameModel.knownTargets.includes(target))) throw new RangeError('La grille demande une cible sans probabilité connue pour ce modèle.');
  const riskProfiles = [{ id: 'strict', factor: 1, label: 'Limites strictes' }, { id: 'wide', factor: 2, label: 'Limites élargies ×2' }];
  const rng = createSeededRng(deriveSeed(settings.seed, 'candidate-reservoir', 'v2'));
  const selected = [];
  let compatibleCombinations = 0;
  let skippedCombinations = 0;
  let seen = new Set();
  for (const target of targets) for (const method of settings.methods) for (const profile of riskProfiles) {
    const dimensions = [settings.grid.stakes, settings.grid.bankrolls, settings.grid.stopLossUnits, settings.grid.takeProfitUnits, settings.grid.rounds, settings.grid.maxLossStreaks, settings.grid.progressionCaps, method === 'proportional' ? settings.grid.proportionalFractions : [settings.proportionalFraction * 100]];
    const visit = (depth, values) => {
      if (depth < dimensions.length) { for (const value of dimensions[depth]) visit(depth + 1, [...values, value]); return; }
      const [stake, bankroll, stopLossUnits, takeProfitUnits, rounds, maxLossStreak, progressionCap, proportionPercent] = values;
      if (bankroll < stake || (method === 'proportional' && (proportionPercent / 100 > 0.5 || bankroll * proportionPercent / 100 < stake))) { skippedCombinations += 1; return; }
      compatibleCombinations += 1;
      const params = { target, method, profile: profile.id, stake, bankroll, stopLossUnits, takeProfitUnits, rounds, maxLossStreak, progressionCap, proportionPercent };
      const key = JSON.stringify(params);
      const id = `s2-${hashString(key)}-${String(target).replace('.', 'p')}-${method}-${profile.id}-${values.map((number) => String(number).replace('.', 'p')).join('-')}`;
      if (seen.has(id)) return;
      seen.add(id);
      const candidate = Object.freeze({
        id, name: `${target}× · ${method} · ${profile.label}`,
        target, staking: method, stakingLabel: methodLabel(method), riskProfile: profile.id, riskProfileLabel: profile.label, profileFactor: profile.factor,
        stake, bankroll, proportionalFraction: proportionPercent / 100, progressionCap: progressionCap * profile.factor,
        stopLossUnits: stopLossUnits * profile.factor, takeProfitUnits: takeProfitUnits * profile.factor,
        maxLossStreak: Math.ceil(maxLossStreak * profile.factor), rounds, paths: settings.paths
      });
      if (selected.length < settings.maxCandidates) selected.push(candidate);
      else {
        const slot = Math.floor(rng() * compatibleCombinations);
        if (slot < settings.maxCandidates) selected[slot] = candidate;
      }
    };
    visit(0, []);
  }
  return { settings, candidates: selected, compatibleCombinations, skippedCombinations };
}

function methodLabel(method) { return ({ flat: 'Mise fixe', proportional: 'Part du solde', martingale: 'Martingale plafonnée', recovery: 'Récupération plafonnée' })[method]; }
function hashString(text) { let hash = 2166136261; for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); }

export async function runStrategySearch(gameModel, rawSettings = {}, options = {}) {
  const start = now();
  const startMemory = processMemory();
  const generated = generateSearchCandidates(gameModel, rawSettings);
  const { settings, candidates } = generated;
  if (!candidates.length) throw new Error('Aucune probabilité de jeu connue : recherche bloquée avant simulation.');
  const screeningWork = candidates.reduce((sum, candidate) => sum + Math.min(candidate.rounds, settings.screeningRounds) * settings.screeningPaths, 0);
  const worstFinalWork = candidates.map((candidate) => candidate.rounds).sort((a, b) => b - a).slice(0, settings.shortlistSize).reduce((sum, rounds) => sum + rounds * settings.paths * 2, 0);
  const plannedWork = screeningWork + worstFinalWork + Math.min(settings.shortlistSize, candidates.length) * settings.paths * 500;
  if (plannedWork > (options.maxWork ?? MAX_DISCOVERY_WORK)) throw new RangeError(`Recherche trop volumineuse (${plannedWork.toLocaleString('fr-FR')} tirages prévus). Réduisez les candidats, durées ou trajectoires; limite ${MAX_DISCOVERY_WORK.toLocaleString('fr-FR')}.`);
  const cancelled = () => { if (options.signal?.aborted) throw abortError(); };
  const totals = { generated: generated.compatibleCombinations, sampled: candidates.length, screened: 0, rejected: 0, shortlisted: 0, tested: 0 };
  let steps = candidates.length;
  let completed = 0;
  const progressPayload = (stage, candidate, detail = {}) => ({ stage, completed, total: steps, generated: totals.generated, screened: totals.screened, rejected: totals.rejected, shortlisted: totals.shortlisted, tested: totals.tested, candidateId: candidate?.id ?? '', strategyName: candidate?.name ?? '', ...detail });
  const notify = (stage, candidate, detail = {}) => options.onProgress?.(progressPayload(stage, candidate, detail));
  const simulate = (game, candidate, phase, stage) => simulateStrategy(game, candidate, {
    seed: settings.seed, phase, signal: options.signal, yieldEveryPaths: 8,
    onProgress: async ({ path, paths }) => {
      cancelled();
      await options.onProgress?.(progressPayload(stage, candidate, { path, paths, candidateFraction: path / paths }));
    }
  });
  const screening = [];
  notify('GENERATION', null, { generated: totals.generated, screened: 0, rejected: 0, shortlisted: 0, tested: 0 });
  for (const candidate of candidates) {
    cancelled();
    const quick = { ...candidate, rounds: Math.min(candidate.rounds, settings.screeningRounds), paths: settings.screeningPaths };
    const result = await simulate(gameModel, quick, 'screening', 'SCREENING');
    screening.push({ candidate, result }); totals.screened += 1; completed += 1; notify('SCREENING', candidate);
  }
  const screened = screening.map(({ candidate, result }) => ({ candidate, result, ev: result.theoreticalEvPerStakeUnit }))
    .sort((a, b) => (b.ev - a.ev) || (b.result.meanReturnPerStakeUnit - a.result.meanReturnPerStakeUnit));
  const eligible = screened.filter((item) => item.ev > 1e-12 && item.result.ruinProbability <= settings.maximumRuinProbability);
  totals.rejected = screened.length - eligible.length;
  const rejectedStrategies = screened.filter((item) => !eligible.includes(item)).map((item) => ({
    candidate: item.candidate,
    screening: compactResult(item.result),
    status: 'REJECTED',
    statusReason: item.ev <= 1e-12 ? 'Espérance théorique non positive sous les probabilités saisies.' : 'Risque de ruine simulé supérieur au plafond choisi.'
  }));
  const finalists = eligible.slice(0, settings.shortlistSize);
  totals.shortlisted = finalists.length;
  const unadvancedStrategies = eligible.slice(settings.shortlistSize).map((item) => ({
    candidate: item.candidate,
    screening: compactResult(item.result),
    status: 'UNDER TEST',
    statusReason: 'Non retenue dans la taille de présélection configurée; les tests approfondis n’ont pas été exécutés.'
  }));
  steps = candidates.length + finalists.length * 2;
  notify('ELIMINATION', null, { completed, total: steps, generated: totals.generated, screened: totals.screened, rejected: totals.rejected, shortlisted: totals.shortlisted, tested: 0 });
  notify('COMPARISON', null, { completed, total: steps, generated: totals.generated, screened: totals.screened, rejected: totals.rejected, shortlisted: totals.shortlisted, tested: 0 });
  const deepResults = [];
  for (const item of finalists) {
    cancelled();
    const result = await simulate(gameModel, { ...item.candidate, paths: settings.paths }, 'exploration', 'DEEP_TEST');
    deepResults.push({ ...item, exploration: result }); totals.tested += 1; completed += 1; notify('DEEP_TEST', item.candidate);
  }
  const held = [];
  for (const item of deepResults) {
    cancelled();
    const result = await simulate(gameModel, { ...item.candidate, paths: settings.paths }, 'validation_independante', 'INDEPENDENT_VALIDATION');
    held.push({ ...item, validation: result }); completed += 1; notify('INDEPENDENT_VALIDATION', item.candidate);
  }
  const baseline = held.find((item) => item.candidate.staking === 'flat' && item.candidate.riskProfile === 'strict' && item.candidate.target === 1.5)?.validation || held[0]?.validation;
  const adjusted = adjustFinalResults(held, baseline, settings.alpha);
  const ranked = [];
  for (const item of adjusted) {
    cancelled();
    const overfit = detectOverfitting(item.exploration, item.validation);
    const classification = classifyStrategy({ theoreticalEv: item.validation.theoreticalEvPerStakeUnit, assumptionsVerified: gameModel.assumptionsVerified, validation: item.validation, maximumRuinProbability: settings.maximumRuinProbability, overfitDetected: overfit, isBaseline: item.validation.candidateId === baseline?.candidateId });
    const q = gameModel.getReachProbability(item.candidate.target);
    const sensitivity = { reachProbabilityDelta: 0.01, lowerProbabilityEv: Math.max(0, q - 0.01) * item.candidate.target - 1, upperProbabilityEv: Math.min(1, q + 0.01) * item.candidate.target - 1 };
    sensitivity.positiveAcrossRange = sensitivity.lowerProbabilityEv > 0;
    const bootstrapCi95 = await bootstrapMeanInterval(item.validation.sessionReturnRates, deriveSeed(settings.seed, 'bootstrap', item.candidate.id), 500, options.signal);
    const status = classification.status === 'VALIDATED UNDER ASSUMPTIONS' && !sensitivity.positiveAcrossRange ? 'UNDER TEST' : classification.status;
    const statusReason = status !== classification.status ? 'Le signal positif disparaît avec une variation de probabilité de ±1 point; robustesse insuffisante.' : classification.reason;
    ranked.push({ ...item, overfit, sensitivity, bootstrapCi95, status, statusReason, rankScore: rankScore(item, bootstrapCi95) });
  }
  ranked.sort((a, b) => b.rankScore - a.rankScore || b.validation.meanReturnPerStakeUnit - a.validation.meanReturnPerStakeUnit);
  const memory = processMemory();
  const end = now();
  notify('RANKING', null, { completed: steps, total: steps, generated: totals.generated, screened: totals.screened, rejected: totals.rejected, shortlisted: totals.shortlisted, tested: totals.tested });
  const detailed = ranked.map((item) => ({ candidate: item.candidate, screening: compactResult(screened.find((x) => x.candidate.id === item.candidate.id)?.result), exploration: compactResult(item.exploration), validation: compactResult(item.validation), bootstrapCi95: item.bootstrapCi95, sensitivity: item.sensitivity, overfitDetected: item.overfit, status: item.status, statusReason: item.statusReason, rankScore: item.rankScore, isBaseline: item.validation.candidateId === baseline?.candidateId }));
  const validatedCount = detailed.filter((item) => item.status === 'VALIDATED UNDER ASSUMPTIONS').length;
  const report = {
    algorithmVersion: DISCOVERY_ALGORITHM_VERSION,
    searchId: `search-${hashString(`${settings.seed}|${start}|${candidates.map((c) => c.id).join(',')}`)}`,
    generatedAt: new Date().toISOString(),
    game: { id: gameModel.id, name: gameModel.name, modelVersion: gameModel.modelVersion, classification: gameModel.classification },
    assumptions: { provider: gameModel.provider || '', version: gameModel.version || '', theoreticalRtp: gameModel.theoreticalRtp ?? null, reachProbabilities: gameModel.reachProbabilities || null, source: gameModel.source || '', notes: gameModel.notes || '', verifiedByUser: Boolean(gameModel.assumptionsVerified) },
    settings: { ...settings, grid: settings.grid },
    counts: { generated: totals.generated, sampled: totals.sampled, screened: totals.screened, rejected: totals.rejected, shortlisted: totals.shortlisted, notAdvanced: unadvancedStrategies.length, deeplyTested: totals.tested, validatedIndependently: held.length, stages: ['GENERATION', 'SCREENING', 'ELIMINATION', 'COMPARISON', 'DEEP_TEST', 'INDEPENDENT_VALIDATION', 'RANKING'], simulatedRounds: screening.reduce((sum, item) => sum + item.result.totalRounds, 0) + held.reduce((sum, item) => sum + item.exploration.totalRounds + item.validation.totalRounds, 0) },
    performance: { durationMilliseconds: end - start, heapUsedBytes: memory.heapUsedBytes, rssBytes: memory.rssBytes, heapDeltaBytes: startMemory.heapUsedBytes !== null && memory.heapUsedBytes !== null ? memory.heapUsedBytes - startMemory.heapUsedBytes : null, plannedWork },
    strategies: detailed,
    rejectedStrategies,
    unadvancedStrategies,
    observedRealResults: [],
    summary: validatedCount ? `${validatedCount} candidat(s) ont franchi les tests statistiques sous les hypothèses saisies; résultats entièrement virtuels.` : 'Aucun avantage statistique démontré. Les résultats restent virtuels et conditionnels au modèle saisi.',
    limitations: ['Le filtrage et la validation sont simulés à partir du même modèle probabiliste, avec des graines distinctes.', 'Aucune donnée réelle observée, aucune connexion à un opérateur et aucune prédiction des prochains résultats.', 'Les candidats présélectionnés sont un échantillon déterministe de la grille si celle-ci dépasse le plafond configuré.', 'Le classement combine l’espérance théorique, le rendement simulé, le risque de ruine et la stabilité des résultats; il ne promet aucun gain.']
  };
  return Object.freeze(report);
}

function adjustFinalResults(items, baseline, alpha) {
  if (!items.length) return [];
  const pZero = holmBonferroni(items.map((item) => ({ id: item.candidate.id, pValue: item.validation.oneSidedPValueVsZero })), alpha);
  const pBase = holmBonferroni(items.map((item) => ({ id: item.candidate.id, pValue: item.validation.candidateId === baseline?.candidateId ? 1 : oneSidedDifferencePValue(item.validation.sessionReturnRates, baseline.sessionReturnRates) })), alpha);
  const zeroMap = new Map(pZero.map((x) => [x.id, x])); const baseMap = new Map(pBase.map((x) => [x.id, x]));
  return items.map((item) => ({ ...item, validation: { ...item.validation, evAdjustedPValue: zeroMap.get(item.candidate.id).adjustedPValue, evPositiveCorrected: zeroMap.get(item.candidate.id).reject, baselineAdjustedPValue: baseMap.get(item.candidate.id).adjustedPValue, baselinePositiveCorrected: baseMap.get(item.candidate.id).reject } }));
}

function rankScore(item, bootstrapCi95) {
  const v = item.validation;
  const lowerBound = bootstrapCi95?.lower ?? v.meanReturnCi95?.lower ?? -1;
  const robustness = Math.max(0, 1 - Math.abs(item.exploration.meanReturnPerStakeUnit - v.meanReturnPerStakeUnit));
  const riskPenalty = Math.min(1, v.ruinProbability) + v.worstMaxDrawdownRate * 0.25;
  return (v.theoreticalEvPerStakeUnit * 2) + lowerBound + (v.meanReturnPerStakeUnit * 0.5) + (robustness * 0.05) - riskPenalty;
}

function compactResult(result) {
  const { sessionNets, sessionReturnRates, ...summary } = result;
  return summary;
}
function processMemory() { const usage = globalThis.process?.memoryUsage?.(); const browserHeap = globalThis.performance?.memory?.usedJSHeapSize; return { heapUsedBytes: usage?.heapUsed ?? browserHeap ?? null, rssBytes: usage?.rss ?? null }; }
function now() { return globalThis.performance?.now?.() ?? Date.now(); }
function abortError() { const error = new Error('Recherche arrêtée par l’utilisateur.'); error.name = 'AbortError'; return error; }
