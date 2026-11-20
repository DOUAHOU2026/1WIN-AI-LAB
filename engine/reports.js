const CSV_COLUMNS = [
  'game_id', 'game_name', 'model_version', 'data_classification', 'strategy_id', 'strategy_name',
  'target_x', 'virtual_stake', 'virtual_bankroll', 'stop_loss_units', 'take_profit_units', 'session_rounds', 'paths', 'maximum_loss_streak', 'progression_cap', 'proportional_fraction', 'reach_probability_input', 'theoretical_rtp_metadata', 'probability_source', 'assumptions_verified_by_user',
  'staking', 'risk_profile', 'baseline_strategy', 'status', 'status_reason',
  'theoretical_ev_per_stake_unit', 'screening_only', 'screening_mean_return_per_stake_unit', 'exploration_mean_net_per_path', 'validation_mean_net_per_path',
  'validation_mean_return_per_stake_unit', 'validation_ci95_lower', 'validation_ci95_upper', 'bootstrap_ci95_lower', 'bootstrap_ci95_upper', 'sensitivity_lower_ev', 'sensitivity_upper_ev', 'sensitivity_positive_across_range',
  'rounds_per_path', 'paths_per_phase', 'wins', 'losses', 'win_rate', 'win_ci95_lower', 'win_ci95_upper',
  'total_staked', 'total_net', 'max_drawdown_amount', 'median_drawdown_rate', 'worst_drawdown_rate',
  'ruin_probability', 'ruin_ci95_lower', 'ruin_ci95_upper', 'max_loss_streak', 'ev_adjusted_p',
  'baseline_adjusted_p', 'overfit_detected', 'master_seed', 'screening_seed', 'exploration_seed', 'validation_seed'
];

export function reportAsJson(report) {
  return JSON.stringify(report, null, 2);
}

export function reportAsCsv(report) {
  const items = [...(report.strategies || []), ...(report.rejectedStrategies || []), ...(report.unadvancedStrategies || [])];
  const rows = items.map((item) => {
    const e = item.exploration;
    const v = item.validation;
    const s = item.screening;
    const values = {
      game_id: report.game.id,
      game_name: report.game.name,
      model_version: report.game.modelVersion,
      data_classification: report.game.classification,
      strategy_id: item.candidate.id,
      strategy_name: item.candidate.name,
      target_x: item.candidate.target,
      reach_probability_input: report.assumptions.reachProbabilities?.[String(item.candidate.target)] ?? '',
      theoretical_rtp_metadata: report.assumptions.theoreticalRtp ?? '',
      probability_source: report.assumptions.source,
      assumptions_verified_by_user: report.assumptions.verifiedByUser,
      staking: item.candidate.staking,
      risk_profile: item.candidate.riskProfile,
      virtual_stake: item.candidate.stake,
      virtual_bankroll: item.candidate.bankroll,
      stop_loss_units: item.candidate.stopLossUnits,
      take_profit_units: item.candidate.takeProfitUnits,
      session_rounds: item.candidate.rounds,
      paths: item.candidate.paths,
      maximum_loss_streak: item.candidate.maxLossStreak,
      progression_cap: item.candidate.progressionCap,
      proportional_fraction: item.candidate.proportionalFraction,
      baseline_strategy: item.isBaseline,
      status: item.status,
      status_reason: item.statusReason,
      theoretical_ev_per_stake_unit: v?.theoreticalEvPerStakeUnit ?? s?.theoreticalEvPerStakeUnit ?? '',
      screening_only: !v,
      screening_mean_return_per_stake_unit: s?.meanReturnPerStakeUnit ?? '',
      exploration_mean_net_per_path: e?.meanNetPerPath ?? '',
      validation_mean_net_per_path: v?.meanNetPerPath ?? '',
      validation_mean_return_per_stake_unit: v?.meanReturnPerStakeUnit ?? '',
      validation_ci95_lower: v?.meanReturnCi95?.lower ?? '',
      validation_ci95_upper: v?.meanReturnCi95?.upper ?? '',
      bootstrap_ci95_lower: item.bootstrapCi95?.lower ?? '',
      bootstrap_ci95_upper: item.bootstrapCi95?.upper ?? '',
      sensitivity_lower_ev: item.sensitivity?.lowerProbabilityEv ?? '',
      sensitivity_upper_ev: item.sensitivity?.upperProbabilityEv ?? '',
      sensitivity_positive_across_range: item.sensitivity?.positiveAcrossRange ?? '',
      rounds_per_path: v?.roundsPerPath ?? s?.roundsPerPath ?? item.candidate.rounds,
      paths_per_phase: v?.paths ?? s?.paths ?? item.candidate.paths,
      wins: v?.wins ?? '',
      losses: v?.losses ?? '',
      win_rate: v?.winRate ?? '',
      win_ci95_lower: v?.winRateCi95?.[0] ?? '',
      win_ci95_upper: v?.winRateCi95?.[1] ?? '',
      total_staked: v?.totalStaked ?? '',
      total_net: v?.totalNet ?? '',
      max_drawdown_amount: v?.maxDrawdownAmount ?? s?.maxDrawdownAmount ?? '',
      median_drawdown_rate: v?.medianMaxDrawdownRate ?? s?.medianMaxDrawdownRate ?? '',
      worst_drawdown_rate: v?.worstMaxDrawdownRate ?? s?.worstMaxDrawdownRate ?? '',
      ruin_probability: v?.ruinProbability ?? s?.ruinProbability ?? '',
      ruin_ci95_lower: v?.ruinCi95?.[0] ?? '',
      ruin_ci95_upper: v?.ruinCi95?.[1] ?? '',
      max_loss_streak: v?.maxLossStreak ?? s?.maxLossStreak ?? '',
      ev_adjusted_p: v?.evAdjustedPValue ?? '',
      baseline_adjusted_p: v?.baselineAdjustedPValue ?? '',
      overfit_detected: item.overfitDetected,
      master_seed: report.settings.seed,
      screening_seed: s?.derivedSeed ?? '',
      exploration_seed: e?.derivedSeed ?? '',
      validation_seed: v?.derivedSeed ?? ''
    };
    return CSV_COLUMNS.map((column) => csvCell(values[column])).join(',');
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

export function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'number' ? String(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
