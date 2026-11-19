(() => {
  'use strict';

  const TARGETS = [1.2, 1.5, 2, 3, 5, 10];
  const HISTORY_LIMIT = 100;
  const STORAGE_KEY = 'onewin-ai-lab-phase1-v1';
  const money = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
  const percent = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

  const defaults = {
    game: { name: 'Aviator', provider: '', rtp: null, probabilities: {}, source: '', notes: '' },
    history: [],
    lastResults: {}
  };
  const state = loadState();
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return structuredClone(defaults);
      return {
        game: { ...defaults.game, ...(saved.game || {}), probabilities: { ...(saved.game?.probabilities || {}) } },
        history: Array.isArray(saved.history) ? saved.history.slice(0, HISTORY_LIMIT) : [],
        lastResults: saved.lastResults && typeof saved.lastResults === 'object' ? saved.lastResults : {}
      };
    } catch {
      return structuredClone(defaults);
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      toast('Stockage local indisponible ou saturé. Exportez vos données.');
      return false;
    }
  }

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2800);
  }

  function num(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value, digits = 2) {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
  }

  function formatTarget(target) {
    return `${formatNumber(target, 2)}×`;
  }

  function getProbability(target) {
    const value = state.game.probabilities[String(target)];
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  }

  function evFor(target) {
    const q = getProbability(target);
    return q === null ? null : q * target - 1;
  }

  function targetIsMonotonic() {
    let previous = null;
    for (const target of TARGETS) {
      const q = getProbability(target);
      if (q === null) continue;
      if (previous !== null && q > previous + 1e-10) return false;
      previous = q;
    }
    return true;
  }

  function renderAll() {
    $('#todayLabel').textContent = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date());
    renderGame();
    renderStrategies();
    renderHistory();
    updateSimulationControls();
  }

  function renderGame() {
    const known = TARGETS.filter((t) => getProbability(t) !== null).length;
    const sourceProvided = Boolean(state.game.source && state.game.notes.trim());
    const hasRtp = Number.isFinite(state.game.rtp);
    $('#displayRtp').textContent = hasRtp ? `${formatNumber(state.game.rtp, 2)} %` : 'Inconnu';
    $('#displayProb').textContent = `${known} / 6 cibles`;
    $('#displaySource').textContent = state.game.source ? 'Référencée' : 'Non renseignée';
    $('#displayNotes').textContent = state.game.notes.trim() || 'Les données de jeu doivent être confirmées pour la version étudiée.';
    $('#metricGame').textContent = state.game.provider || 'Aviator';
    $('#dataStatus').textContent = known === 6 && sourceProvided ? 'DOCUMENTÉ' : known ? 'PARTIEL' : 'INCOMPLET';
    $('#gameTag').textContent = known === 6 && sourceProvided ? 'DOCUMENTÉ' : 'À DOCUMENTER';
    $('#gameTag').className = `tag ${known === 6 && sourceProvided ? 'tag-green' : 'tag-amber'}`;
    $('#metricStrategies').textContent = String(TARGETS.length);
    const anyKnown = TARGETS.some((t) => getProbability(t) !== null);
    const knownEvs = TARGETS.map(evFor).filter(Number.isFinite);
    $('#metricBest').textContent = knownEvs.length ? `${formatNumber(Math.max(...knownEvs) * 100, 2)} %` : '—';
    $('#checkSource').className = `check ${sourceProvided ? 'done' : 'pending'}`;
    $('#checkSource').textContent = sourceProvided ? '✓' : '·';
    $('#labelSource').textContent = sourceProvided ? 'DOCUMENTÉE' : 'À FAIRE';
    $('#checkProb').className = `check ${known ? 'done' : 'pending'}`;
    $('#checkProb').textContent = known ? '✓' : '·';
    $('#labelProb').textContent = known ? `${known} / 6` : 'À FAIRE';
    const hasRejected = knownEvs.length > 0 && knownEvs.every((ev) => ev < -1e-12);
    const validation = $('#validationStatus');
    const summary = $('#validationSummary');
    if (hasRejected) {
      validation.textContent = 'REJETÉE SOUS LES HYPOTHÈSES SAISIES';
      summary.textContent = 'Toutes les cibles renseignées ont une espérance théorique négative.';
    } else if (knownEvs.some((ev) => ev > 1e-12)) {
      validation.textContent = 'EN COURS DE TEST';
      summary.textContent = 'Espérance positive conditionnelle à vérifier indépendamment.';
    } else if (anyKnown) {
      validation.textContent = 'EN COURS DE TEST';
      summary.textContent = 'Données partielles ; aucune validation indépendante.';
    } else {
      validation.textContent = 'EN COURS DE TEST';
      summary.textContent = 'Données insuffisantes pour évaluer une espérance.';
    }
  }

  function renderStrategies() {
    const known = TARGETS.some((t) => getProbability(t) !== null);
    $('#chartEmpty').classList.toggle('hidden', known);
    const rows = TARGETS.map((target) => {
      const ev = evFor(target);
      const result = state.lastResults[String(target)];
      const cls = ev === null ? '' : ev < 0 ? 'negative' : ev > 0 ? 'positive' : '';
      const value = ev === null ? '—' : `${ev > 0 ? '+' : ''}${formatNumber(ev * 100, 2)}%`;
      return `<div class="strategy-chip"><span>${formatTarget(target)}</span><b class="${cls}">${value}</b></div>`;
    }).join('');
    $('#strategyDetails').innerHTML = rows;
    drawChart();
  }

  function drawChart() {
    const canvas = $('#strategyChart');
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);
    const values = TARGETS.map(evFor);
    if (!values.some(Number.isFinite)) return;
    const knownValues = values.filter(Number.isFinite).map((v) => v * 100);
    const min = Math.min(-5, ...knownValues);
    const max = Math.max(5, ...knownValues);
    const pad = { l: 33, r: 13, t: 14, b: 17 };
    const chartW = width - pad.l - pad.r;
    const chartH = height - pad.t - pad.b;
    const y = (v) => pad.t + ((max - v) / (max - min)) * chartH;
    const zeroY = y(0);
    ctx.strokeStyle = '#354039';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(width - pad.r, zeroY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#738078'; ctx.font = '9px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(`${formatNumber(max, 0)}%`, pad.l - 6, pad.t + 3);
    ctx.fillText('0%', pad.l - 6, zeroY + 3);
    ctx.fillText(`${formatNumber(min, 0)}%`, pad.l - 6, height - pad.b + 3);
    const n = TARGETS.length;
    TARGETS.forEach((target, i) => {
      const ev = values[i];
      if (ev === null) return;
      const x = pad.l + (i / (n - 1)) * chartW;
      const py = y(ev * 100);
      const color = ev < 0 ? '#ff8d82' : '#b8f34a';
      ctx.strokeStyle = ev < 0 ? '#663936' : '#43552d';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, zeroY); ctx.lineTo(x, py); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, py, 4, 0, Math.PI * 2); ctx.fill();
    });
    const complete = values.every(Number.isFinite);
    if (complete) {
      ctx.strokeStyle = '#b8f34a'; ctx.lineWidth = 1.5; ctx.beginPath();
      values.forEach((v, i) => { const x = pad.l + (i / (n - 1)) * chartW; const py = y(v * 100); i ? ctx.lineTo(x, py) : ctx.moveTo(x, py); }); ctx.stroke();
    }
  }

  function updateSimulationControls() {
    const target = Number($('#targetSelect').value);
    const probability = getProbability(target);
    const monotonic = targetIsMonotonic();
    const isValid = probability !== null && monotonic;
    $('#runButton').disabled = !isValid || simulationRunning;
    $('#probabilityRequired').classList.toggle('hidden', isValid);
    if (!monotonic) {
      $('#probabilityRequired').classList.remove('hidden');
      $('#probabilityRequired strong').textContent = 'Probabilités incohérentes';
      $('#probabilityRequired p').textContent = 'Une cible plus élevée ne peut pas avoir une probabilité supérieure à une cible plus basse. Vérifiez les données saisies.';
    } else {
      $('#probabilityRequired strong').textContent = 'Probabilité de réussite requise';
      $('#probabilityRequired p').textContent = `Pour simuler ${formatTarget(target)}, renseignez la probabilité documentée dans « Jeu & données », avec sa source.`;
    }
    const rounds = Number($('#roundsSelect').value) || 10000;
    const paths = Math.min(250, Math.max(1, Number($('#pathsInput').value) || 1));
    $('#simEstimate').textContent = `${money.format(rounds * paths)} tirages · calcul local`;
    const staking = $('#stakingSelect').value;
    $('#fractionLabel').classList.toggle('hidden', staking !== 'percent');
    $('#capLabel').classList.toggle('hidden', staking !== 'martingale');
  }

  function openGameDialog() {
    $('#providerInput').value = state.game.provider || '';
    $('#rtpInput').value = state.game.rtp ?? '';
    $('#sourceInput').value = state.game.source || '';
    $('#notesInput').value = state.game.notes || '';
    $$('.prob-input').forEach((input) => {
      const value = state.game.probabilities[input.dataset.target];
      input.value = Number.isFinite(value) ? String(value * 100) : '';
    });
    $('#gameDialog').showModal();
  }

  function saveGame(event) {
    event.preventDefault();
    const rtpValue = num($('#rtpInput').value);
    if (rtpValue !== null && (rtpValue <= 0 || rtpValue > 100)) return toast('Le RTP doit être compris entre 0 et 100 %.');
    const probabilities = {};
    for (const input of $$('.prob-input')) {
      const value = num(input.value);
      if (value !== null) {
        if (value < 0 || value > 100) return toast('Chaque probabilité doit être entre 0 et 100 %.');
        probabilities[input.dataset.target] = value / 100;
      }
    }
    state.game = {
      name: 'Aviator',
      provider: $('#providerInput').value.trim(),
      rtp: rtpValue,
      probabilities,
      source: $('#sourceInput').value.trim(),
      notes: $('#notesInput').value.trim()
    };
    if (!targetIsMonotonic()) return toast('Vérifiez les probabilités : elles doivent décroître ou rester égales quand la cible augmente.');
    persist();
    $('#gameDialog').close();
    renderAll();
    toast('Données enregistrées sur cet appareil.');
  }

  function hashSeed(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0 || 0x6d2b79f5;
  }

  function seededRandom(seedText) {
    let seed = hashSeed(seedText);
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function wilson(successes, count) {
    if (!count) return [0, 1];
    const z = 1.959963984540054;
    const p = successes / count;
    const den = 1 + (z * z) / count;
    const center = (p + (z * z) / (2 * count)) / den;
    const half = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * count)) / count) / den;
    return [Math.max(0, center - half), Math.min(1, center + half)];
  }

  function sampleMeanCi(values) {
    if (values.length < 2) return [values[0] ?? 0, values[0] ?? 0];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
    const half = 1.959963984540054 * Math.sqrt(variance / values.length);
    return [mean - half, mean + half];
  }

  let simulationRunning = false;
  async function runSimulation() {
    if (simulationRunning) return;
    const target = Number($('#targetSelect').value);
    const q = getProbability(target);
    if (q === null || !targetIsMonotonic()) return;
    const rounds = Number($('#roundsSelect').value);
    const paths = Math.min(250, Math.max(1, Math.floor(Number($('#pathsInput').value))));
    const initialStake = num($('#stakeInput').value);
    const initialBankroll = num($('#bankrollInput').value);
    const seedText = $('#seedInput').value.trim();
    const staking = $('#stakingSelect').value;
    const fraction = (num($('#fractionInput').value) || 2) / 100;
    const cap = num($('#capInput').value) || initialStake * 16;
    if (!rounds || !paths || !initialStake || initialStake <= 0 || !initialBankroll || initialBankroll <= 0 || !seedText) return toast('Vérifiez les paramètres de simulation.');
    if (initialBankroll < initialStake) return toast('Le capital initial doit couvrir au moins une mise initiale.');
    if (staking === 'percent' && (fraction <= 0 || fraction >= 1)) return toast('La part du capital doit être entre 1 % et 99 %.');
    if (staking === 'martingale' && cap < initialStake) return toast('La mise maximale doit couvrir la mise initiale.');

    simulationRunning = true;
    updateSimulationControls();
    $('#runButton').innerHTML = '<span>◌</span> Simulation en cours…';
    $('#progressTrack').classList.remove('hidden');
    $('#progressBar').style.width = '0%';
    const random = seededRandom(seedText);
    const sessionNets = [];
    const sessionDrawdowns = [];
    let wins = 0;
    let losses = 0;
    let totalPlayed = 0;
    let ruined = 0;
    let maxDrawdown = 0;
    const yieldEvery = 5;

    for (let path = 0; path < paths; path++) {
      let bankroll = initialBankroll;
      let peak = bankroll;
      let drawdown = 0;
      let nextStake = initialStake;
      let pathWins = 0;
      let pathLosses = 0;
      let busted = false;
      for (let round = 0; round < rounds; round++) {
        let stake;
        if (staking === 'flat') stake = initialStake;
        else if (staking === 'percent') stake = bankroll * fraction;
        else stake = Math.min(nextStake, cap);
        if (stake < initialStake || bankroll + 1e-12 < stake) {
          busted = true;
          break;
        }
        totalPlayed++;
        if (random() < q) {
          wins++;
          pathWins++;
          bankroll += stake * (target - 1);
          nextStake = initialStake;
        } else {
          losses++;
          pathLosses++;
          bankroll -= stake;
          if (staking === 'martingale') nextStake = Math.min(stake * 2, cap);
        }
        if (bankroll > peak) peak = bankroll;
        const currentDrawdown = peak > 0 ? (peak - bankroll) / peak : 1;
        drawdown = Math.max(drawdown, currentDrawdown);
      }
      if (busted) ruined++;
      sessionNets.push(bankroll - initialBankroll);
      sessionDrawdowns.push(drawdown);
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      if ((path + 1) % yieldEvery === 0 || path === paths - 1) {
        $('#progressBar').style.width = `${((path + 1) / paths) * 100}%`;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const totalNet = sessionNets.reduce((sum, value) => sum + value, 0);
    const averageNet = totalNet / paths;
    const [netLow, netHigh] = sampleMeanCi(sessionNets);
    const [ruinLow, ruinHigh] = wilson(ruined, paths);
    const [winLow, winHigh] = wilson(wins, totalPlayed);
    const sortedDrawdowns = [...sessionDrawdowns].sort((a, b) => a - b);
    const medianDrawdown = sortedDrawdowns[Math.floor(sortedDrawdowns.length / 2)] || 0;
    const theoreticalEv = q * target - 1;
    const result = {
      id: `${Date.now()}-${hashSeed(seedText)}`,
      timestamp: new Date().toISOString(),
      target, q, roundsPerPath: rounds, paths, totalPlayed, wins, losses, ruined,
      totalNet, averageNet, netLow, netHigh, ruinLow, ruinHigh, winLow, winHigh,
      medianDrawdown, maxDrawdown, theoreticalEv, seed: seedText, staking,
      initialStake, initialBankroll, fraction, cap
    };
    state.history.unshift(result);
    state.history = state.history.slice(0, HISTORY_LIMIT);
    state.lastResults[String(target)] = result;
    persist();
    renderResults(result);
    renderAll();
    $('#progressTrack').classList.add('hidden');
    simulationRunning = false;
    updateSimulationControls();
    $('#runButton').innerHTML = '<span>▶</span> Lancer la simulation';
    $('#resultsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`${money.format(totalPlayed)} tirages simulés. Graine enregistrée.`);
  }

  function ciText(low, high, digits = 2) {
    return `IC 95 % : ${formatNumber(low, digits)} à ${formatNumber(high, digits)}`;
  }

  function renderResults(result) {
    $('#resultsPanel').classList.remove('hidden');
    $('#resultMeta').textContent = `${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(result.timestamp))} · graine ${result.seed}`;
    $('#resultWins').textContent = money.format(result.wins);
    $('#resultWinRate').textContent = `${percent.format((result.wins / result.totalPlayed) * 100)} % des parties jouées · ${ciText(result.winLow * 100, result.winHigh * 100)} %`;
    $('#resultLosses').textContent = money.format(result.losses);
    $('#resultPlayable').textContent = `${money.format(result.totalPlayed)} parties jouées / ${money.format(result.roundsPerPath * result.paths)} prévues`;
    $('#resultNet').textContent = `${result.averageNet >= 0 ? '+' : ''}${formatNumber(result.averageNet, 3)} u`;
    $('#resultNet').className = result.averageNet < 0 ? 'negative' : 'positive';
    $('#resultNetCi').textContent = ciText(result.netLow, result.netHigh, 3) + ' unités / trajectoire';
    $('#resultDrawdown').textContent = `${percent.format(result.medianDrawdown * 100)} %`;
    $('#resultDrawdownSmall').textContent = `Maximum observé : ${percent.format(result.maxDrawdown * 100)} %`;
    $('#resultRuin').textContent = `${percent.format((result.ruined / result.paths) * 100)} %`;
    $('#resultRuinCi').textContent = `${ciText(result.ruinLow * 100, result.ruinHigh * 100)} sur ${money.format(result.paths)} trajectoires`;
    $('#resultTheory').textContent = `${result.theoreticalEv >= 0 ? '+' : ''}${formatNumber(result.theoreticalEv * 100, 3)} %`;
    $('#resultTheory').className = result.theoreticalEv < 0 ? 'negative' : 'positive';
    $('#resultTheoryCi').textContent = `${formatTarget(result.target)} · q=${percent.format(result.q * 100)} % saisie`;
    const assumption = state.game.source ? `Source renseignée : ${state.game.source}` : 'Probabilité saisie comme hypothèse sans source vérifiée.';
    $('#resultDisclaimer').textContent = `Simulation conditionnelle, sans mise réelle. ${assumption} L’IC du résultat net mesure la variation entre trajectoires simulées ; il ne valide pas la probabilité saisie ni un avantage réel.`;
  }

  function renderHistory() {
    $('#metricRuns').textContent = String(state.history.length);
    const body = $('#historyBody');
    if (!state.history.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="7">Aucun scénario exécuté.</td></tr>';
      return;
    }
    body.innerHTML = state.history.map((item) => {
      const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.timestamp));
      const ev = item.averageNet;
      return `<tr><td>${date}</td><td>${formatTarget(item.target)}</td><td>${percent.format(item.q * 100)} %</td><td>${money.format(item.paths)} × ${money.format(item.roundsPerPath)}</td><td class="${ev < 0 ? 'negative' : 'positive'}">${ev >= 0 ? '+' : ''}${formatNumber(ev, 3)} u</td><td>${percent.format((item.ruined / item.paths) * 100)} %</td><td class="history-seed">${escapeHtml(item.seed)}</td></tr>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function exportData() {
    const exportObject = { schemaVersion: 1, exportedAt: new Date().toISOString(), ...state };
    const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `1win-ai-lab-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast('Export JSON téléchargé.');
  }

  function clearHistory() {
    state.history = [];
    state.lastResults = {};
    persist();
    renderAll();
    $('#confirmDialog').close();
    $('#resultsPanel').classList.add('hidden');
    toast('Historique effacé.');
  }

  $('#editGameButton').addEventListener('click', openGameDialog);
  $('#editProbabilityButton').addEventListener('click', openGameDialog);
  $('#gameForm').addEventListener('submit', saveGame);
  $('#targetSelect').addEventListener('change', updateSimulationControls);
  $('#roundsSelect').addEventListener('change', updateSimulationControls);
  $('#pathsInput').addEventListener('input', updateSimulationControls);
  $('#stakingSelect').addEventListener('change', updateSimulationControls);
  $('#runButton').addEventListener('click', runSimulation);
  $('#exportButton').addEventListener('click', exportData);
  $('#refreshStrategies').addEventListener('click', () => { renderStrategies(); toast('Comparaison actualisée.'); });
  $('#clearHistoryButton').addEventListener('click', () => $('#confirmDialog').showModal());
  $('#confirmClearButton').addEventListener('click', (event) => { event.preventDefault(); clearHistory(); });
  $('#pathsInput').addEventListener('change', () => {
    const value = Math.min(250, Math.max(1, Math.floor(Number($('#pathsInput').value) || 1)));
    $('#pathsInput').value = String(value);
    updateSimulationControls();
  });
  window.addEventListener('resize', drawChart);
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) location.reload();
  });

  renderAll();
})();

