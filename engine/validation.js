export function detectOverfitting(exploration, validation) {
  return (exploration.evPositiveCorrected && !validation.evPositiveCorrected)
    || (exploration.meanNetPerPath > 0 && validation.meanNetPerPath <= 0)
    || (exploration.baselinePositiveCorrected && !validation.baselinePositiveCorrected);
}

export function classifyStrategy({ theoreticalEv, assumptionsVerified, validation, maximumRuinProbability, overfitDetected, isBaseline }) {
  const riskExceeded = validation.ruinProbability > maximumRuinProbability;
  if (theoreticalEv < -1e-12) {
    return { status: 'REJECTED', reason: 'Espérance théorique négative sous les probabilités saisies.', riskExceeded };
  }
  if (theoreticalEv <= 1e-12) {
    return { status: 'REJECTED', reason: 'Aucun avantage théorique positif n’est établi sous les probabilités saisies.', riskExceeded };
  }
  if (riskExceeded) {
    return { status: 'REJECTED', reason: 'Risque de ruine simulé supérieur au plafond choisi.', riskExceeded };
  }
  if (assumptionsVerified
      && validation.evPositiveCorrected
      && validation.baselinePositiveCorrected
      && !overfitDetected
      && !isBaseline) {
    return {
      status: 'VALIDATED UNDER ASSUMPTIONS',
      reason: 'Avantage reproduit sur une séquence indépendante, après correction de Holm, et supérieur à la référence dans le modèle déclaré.',
      riskExceeded
    };
  }
  const reason = overfitDetected
    ? 'Écart exploration/validation : le signal peut provenir de la sélection chanceuse.'
    : !assumptionsVerified
      ? 'Les hypothèses de jeu ne sont pas confirmées avec une source et une méthode documentées.'
      : 'Preuves statistiques indépendantes ou supériorité sur la référence insuffisantes.';
  return { status: 'UNDER TEST', reason, riskExceeded };
}

