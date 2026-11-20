import { createAviatorModel, AVIATOR_TARGETS, getGameCatalog, MODEL_LABEL } from './engine/games.js';
import { expectedValue } from './engine/probability.js';
import { runDiscovery } from './engine/simulator.js';
import { buildStrategyCandidates, theoreticalStrategyEv, validateStrategySettings } from './engine/strategies.js';
import { downloadTextFile, reportAsCsv, reportAsJson } from './engine/reports.js';

const STORAGE_KEY = 'onewin-ai-lab-phase1-v2';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const percentFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const defaults = {
  model: { provider: '', version: '', theoreticalRtp: null, reachProbabilities: {}, source: '', notes: '', assumptionsVerified: false },
  settings: { rounds: 10000, paths: 10, stake: 1, bankroll: 1000, stopLossUnits: 25, takeProfitUnits: 25, maxLossStreak: 12, progressionCap: 8, proportionalFraction: 2, alpha: 0.05, maximumRuinProbability: 0.5, seed: '1WIN-AI-LAB-001' },
  reports: []
};
const state = loadState();
let selectedReportIndex = 0;
let running = false;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return {
      model: { ...defaults.model, ...(saved?.model || {}), reachProbabilities: { ...(saved?.model?.reachProbabilities || {}) } },
      settings: { ...defaults.settings, ...(saved?.settings || {}) },
      reports: Array.isArray(saved?.reports) ? saved.reports.slice(0, 10) : []
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
    toast('Le stockage local est plein. Exportez vos rapports JSON.');
    return false;
  }
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 3000);
}

function parseNumber(value, fallback = null) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(value) : '—';
}

function fmtTarget(target) { return `${fmt(target, 2)}×`; }
function fmtPct(value, digits = 2) { return Number.isFinite(value) ? `${fmt(value * 100, digits)} %` : '—'; }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function settingsFromForm() {
  return validateStrategySettings({
    rounds: Number($('#roundsSelect').value),
    paths: Number($('#pathsSelect').value),
    stake: parseNumber($('#stakeInput').value),
    bankroll: parseNumber($('#bankrollInput').value),
    stopLossUnits: parseNumber($('#stopLossInput').value),
    takeProfitUnits: parseNumber($('#takeProfitInput').value),
    maxLossStreak: parseNumber($('#lossStreakInput').value),
    progressionCap: parseNumber($('#progressionCapInput').value),
    proportionalFraction: parseNumber($('#proportionInput').value),
    alpha: Number($('#alphaSelect').value),
    maximumRuinProbability: parseNumber($('#ruinLimitInput').value) / 100,
    seed: $('#seedInput').value.trim()
  });
}

function syncSettingsToForm() {
  $('#roundsSelect').value = String(state.settings.rounds);
  $('#pathsSelect').value = String(state.settings.paths);
  $('#stakeInput').value = String(state.settings.stake);
  $('#bankrollInput').value = String(state.settings.bankroll);
  $('#stopLossInput').value = String(state.settings.stopLossUnits);
  $('#takeProfitInput').value = String(state.settings.takeProfitUnits);
  $('#lossStreakInput').value = String(state.settings.maxLossStreak);
  $('#progressionCapInput').value = String(state.settings.progressionCap);
  $('#proportionInput').value = String(state.settings.proportionalFraction);
  $('#alphaSelect').value = String(state.settings.alpha);
  $('#ruinLimitInput').value = String(state.settings.maximumRuinProbability * 100);
  $('#seedInput').value = state.settings.seed;
}

function currentModel() {
  return createAviatorModel(state.model);
}

function currentReport() {
  return state.reports[selectedReportIndex] || null;
}

function renderAll() {
  $('#todayLabel').textContent = 'Aviator configurable';
  renderCatalog();
  renderModel();
  renderRunEstimate();
  renderCurrentReport();
  renderHistory();
}

function renderCatalog() {
  $('#gameCatalog').innerHTML = getGameCatalog().map((game) => `
    <article class="catalog-item ${game.implemented ? 'catalog-active' : 'catalog-disabled'}">
      <div class="catalog-symbol">${game.implemented ? 'A' : '·'}</div>
      <div class="catalog-copy"><strong>${escapeHtml(game.name)}</strong><span>${escapeHtml(game.family)} · ${escapeHtml(game.status)}</span></div>
      <span class="catalog-state ${game.implemented ? 'ready' : ''}">${game.implemented ? 'MODÈLE' : 'EN ATTENTE'}</span>
    </article>`).join('');
}

function renderModel() {
  let model;
  let configError = '';
  try { model = currentModel(); } catch (error) { configError = error.message; }
  const known = model?.knownTargets || [];
  const count = known.length;
  const sourceComplete = Boolean(state.model.source && state.model.notes);
  $('#probabilitySummary').textContent = `${count} / 6 cibles`;
  $('#rtpSummary').textContent = Number.isFinite(model?.theoreticalRtp) ? `${fmt(model.theoreticalRtp)} %` : 'Inconnu';
  $('#sourceSummary').textContent = model?.source ? 'Référencée' : 'Non renseignée';
  $('#providerSummary').textContent = [model?.provider, model?.version].filter(Boolean).join(' · ') || 'Fournisseur / version non confirmés';
  $('#modelNotes').textContent = model?.notes || configError || 'Aucune règle ou probabilité n’a été ajoutée.';
  $('#probabilityStrip').innerHTML = AVIATOR_TARGETS.map((target) => {
    const probability = model?.reachProbabilities[String(target)];
    return `<span class="probability-chip"><b>${fmtTarget(target)}</b><em>${Number.isFinite(probability) ? fmtPct(probability, 3) : 'Inconnue'}</em></span>`;
  }).join('');
  const verified = Boolean(model?.assumptionsVerified);
  $('#assumptionTag').textContent = verified ? 'HYPOTHÈSES DÉCLARÉES' : 'NON VÉRIFIÉ';
  $('#assumptionTag').className = `tag ${verified ? 'tag-green' : 'tag-amber'}`;
  if (!count) {
    $('#modelStatus').textContent = 'DONNÉES INSUFFISANTES POUR UNE ANALYSE FIABLE';
    $('#modelNotice').textContent = configError || 'Le RTP et les probabilités de cash-out Aviator sont inconnus. Le moteur ne les déduit pas et ne les invente pas.';
  } else if (!verified || !sourceComplete) {
    $('#modelStatus').textContent = MODEL_LABEL;
    $('#modelNotice').textContent = `${count} probabilités saisies. Modèle théorique, hypothèses non vérifiées pour la version exacte.`;
  } else {
    $('#modelStatus').textContent = MODEL_LABEL;
    $('#modelNotice').textContent = `${count} probabilités et leur source sont documentées par l’utilisateur. L’application ne vérifie pas la source auprès de l’opérateur.`;
  }
  $('#checkSource').className = `check ${sourceComplete ? 'done' : 'pending'}`;
  $('#checkSource').textContent = sourceComplete ? '✓' : '·';
  $('#labelSource').textContent = sourceComplete ? 'DOCUMENTÉE' : 'À FAIRE';
  $('#checkAssumptions').className = `check ${verified ? 'done' : 'pending'}`;
  $('#checkAssumptions').textContent = verified ? '✓' : '·';
  $('#labelAssumptions').textContent = verified ? 'DÉCLARÉES' : 'NON';
  $('#runButton').disabled = count === 0 || running;
  renderStrategyTable(model, currentReport());
  renderChart(model, currentReport());
}

function renderRunEstimate() {
  let candidateCount = 0;
  let rounds = Number($('#roundsSelect').value) || state.settings.rounds;
  let paths = Number($('#pathsSelect').value) || state.settings.paths;
  try {
    const model = currentModel();
    candidateCount = buildStrategyCandidates(model, settingsFromForm()).length;
  } catch { candidateCount = 0; }
  const estimate = candidateCount * rounds * paths * 2;
  $('#runEstimate').textContent = candidateCount
    ? `${candidateCount} candidats · ${numberFormat.format(rounds)} parties × ${paths} trajectoires · env. ${numberFormat.format(estimate)} tirages sur 2 phases`
    : 'Renseignez une probabilité de cash-out avant de lancer une simulation.';
  $('#candidateCount').textContent = `${candidateCount} CANDIDAT${candidateCount === 1 ? '' : 'S'}`;
  $('#metricStrategies').textContent = String(currentReport()?.counts.candidateStrategies ?? candidateCount);
}

function renderStrategyTable(model, report) {
  const tbody = $('#strategyBody');
  if (!report) {
    const known = model?.knownTargets || [];
    if (!known.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">Les probabilités manquantes empêchent une comparaison fiable.</td></tr>';
      return;
    }
    const candidates = buildStrategyCandidates(model, settingsFromForm());
    tbody.innerHTML = candidates.map((candidate) => {
      const ev = theoreticalStrategyEv(model, candidate);
      return `<tr><td><strong>${escapeHtml(candidate.name)}</strong></td><td class="${ev < 0 ? 'negative' : 'positive'}">${fmtPct(ev)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td><span class="tag tag-neutral">UNDER TEST</span></td></tr>`;
    }).join('');
    return;
  }
  tbody.innerHTML = report.strategies.map((item) => {
    const v = item.validation;
    const ci = v.meanReturnCi95 ? `${fmtPct(v.meanReturnCi95.lower)} à ${fmtPct(v.meanReturnCi95.upper)}` : '—';
    const progressText = `${fmtPct(v.meanReturnPerStakeUnit)} · ${ci}`;
    const pCorrected = Number.isFinite(v.evAdjustedPValue) ? ` · pHolm ${fmt(v.evAdjustedPValue, 4)}` : '';
    return `<tr><td><strong>${escapeHtml(item.candidate.name)}</strong><small>${item.isBaseline ? 'Référence' : escapeHtml(item.candidate.stakingLabel)} · ${escapeHtml(item.candidate.riskProfileLabel)}</small></td><td class="${v.theoreticalEvPerStakeUnit < 0 ? 'negative' : 'positive'}">${fmtPct(v.theoreticalEvPerStakeUnit)}</td><td>${fmtPct(item.exploration.meanReturnPerStakeUnit)}</td><td>${progressText}${pCorrected ? `<small>${pCorrected}</small>` : ''}</td><td>${fmtPct(v.worstMaxDrawdownRate)}<small>Médiane ${fmtPct(v.medianMaxDrawdownRate)}</small></td><td>${fmtPct(v.ruinProbability)}<small>IC ${v.ruinCi95 ? `${fmtPct(v.ruinCi95[0])}–${fmtPct(v.ruinCi95[1])}` : '—'}</small></td><td>${v.maxLossStreak}<small>Médiane ${v.medianMaxLossStreak}</small></td><td><span class="tag ${statusClass(item.status)}">${escapeHtml(item.status)}</span><small class="status-reason">${escapeHtml(item.statusReason)}</small></td></tr>`;
  }).join('');
}

function statusClass(status) {
  if (status === 'REJECTED') return 'tag-red';
  if (status === 'VALIDATED UNDER ASSUMPTIONS') return 'tag-green';
  return 'tag-amber';
}

function renderChart(model, report) {
  const known = model?.knownTargets || [];
  $('#chartEmpty').classList.toggle('hidden', known.length > 0);
  $('#chartAxis').innerHTML = known.map((target) => `<span>${fmtTarget(target)}</span>`).join('');
  const canvas = $('#strategyChart');
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(box.width * ratio);
  canvas.height = Math.round(box.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, box.width, box.height);
  if (!known.length) return;
  const series = known.map((target) => {
    const targetItems = report?.strategies.filter((item) => item.candidate.target === target && item.candidate.staking === 'flat' && item.candidate.riskProfile === 'strict') || [];
    const selected = targetItems[0];
    return {
      target,
      theoretical: theoreticalStrategyEv(model, { target }),
      exploration: selected?.exploration.meanReturnPerStakeUnit ?? null,
      validation: selected?.validation.meanReturnPerStakeUnit ?? null
    };
  });
  const values = series.flatMap((item) => [item.theoretical, item.exploration, item.validation].filter(Number.isFinite));
  const min = Math.min(-0.1, ...values);
  const max = Math.max(0.1, ...values);
  const pad = { left: 38, right: 10, top: 12, bottom: 10 };
  const width = box.width - pad.left - pad.right;
  const height = box.height - pad.top - pad.bottom;
  const y = (value) => pad.top + ((max - value) / (max - min || 1)) * height;
  const zero = y(0);
  ctx.strokeStyle = '#3a453e'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(pad.left, zero); ctx.lineTo(box.width - pad.right, zero); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillStyle = '#819087';
  ctx.fillText(`${fmtPct(max)}`, pad.left - 5, pad.top + 3);
  ctx.fillText('0 %', pad.left - 5, zero + 3);
  ctx.fillText(`${fmtPct(min)}`, pad.left - 5, box.height - pad.bottom);
  const group = width / series.length;
  const colors = ['#b8f34a', '#86a8ff', '#c2a2ff'];
  series.forEach((entry, index) => {
    const center = pad.left + group * (index + 0.5);
    [entry.theoretical, entry.exploration, entry.validation].forEach((value, j) => {
      if (!Number.isFinite(value)) return;
      const barWidth = Math.min(8, group / 5);
      const top = Math.min(y(value), zero);
      const bottom = Math.max(y(value), zero);
      ctx.fillStyle = colors[j];
      ctx.globalAlpha = j === 0 ? 0.9 : 0.72;
      ctx.fillRect(center + (j - 1) * (barWidth + 2) - barWidth / 2, top, barWidth, Math.max(1, bottom - top));
    });
  });
  ctx.globalAlpha = 1;
}

function renderCurrentReport() {
  const report = currentReport();
  $('#exportJson').disabled = !report;
  $('#exportCsv').disabled = !report;
  $('#metricRounds').textContent = numberFormat.format(report?.performance.simulatedRounds || 0);
  $('#checkHoldout').className = `check ${report ? 'done' : 'pending'}`;
  $('#checkHoldout').textContent = report ? '✓' : '·';
  $('#labelHoldout').textContent = report ? 'GRAINE DISTINCTE' : 'NON EFFECTUÉE';
  $('#checkCorrection').className = `check ${report ? 'done' : 'pending'}`;
  $('#checkCorrection').textContent = report ? '✓' : '·';
  $('#labelCorrection').textContent = report ? 'HOLM APPLIQUÉ' : 'NON EFFECTUÉ';

  const statuses = report?.strategies || [];
  const validatedCount = statuses.filter((item) => item.status === 'VALIDATED UNDER ASSUMPTIONS').length;
  const rejectedCount = statuses.filter((item) => item.status === 'REJECTED').length;
  const overall = !report ? (state.model.assumptionsVerified ? 'UNDER TEST' : 'EN ATTENTE')
    : validatedCount ? 'VALIDATED UNDER ASSUMPTIONS'
      : rejectedCount === statuses.length ? 'REJECTED'
        : 'UNDER TEST';
  $('#metricStatus').textContent = overall === 'VALIDATED UNDER ASSUMPTIONS' ? 'VALIDÉ · HYPOTHÈSES' : overall;
  $('#metricStatus').className = `metric-value compact ${overall === 'REJECTED' ? 'negative' : overall === 'VALIDATED UNDER ASSUMPTIONS' ? 'positive' : ''}`;
  $('#validationStatus').textContent = overall;
  $('#validationIcon').textContent = overall === 'REJECTED' ? '×' : overall === 'VALIDATED UNDER ASSUMPTIONS' ? '✓' : '…';
  $('#validationSummary').textContent = !report
    ? (state.model.reachProbabilities && Object.keys(state.model.reachProbabilities).length ? 'Modèle configuré, recherche non exécutée.' : 'Aucune probabilité confirmée.')
    : `${validatedCount} validée sous hypothèses · ${rejectedCount} rejetée · ${statuses.length - validatedCount - rejectedCount} en test.`;
  if (report) {
    $('#validationSummary').textContent += ' Séquences indépendantes simulées, sans observations réelles.';
  }
  renderStrategyTable(safeCurrentModel(), report);
  renderChart(safeCurrentModel(), report);
}

function safeCurrentModel() {
  try { return currentModel(); } catch { return null; }
}

function renderHistory() {
  const body = $('#historyBody');
  if (!state.reports.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="8">Aucune analyse exécutée.</td></tr>';
    return;
  }
  body.innerHTML = state.reports.map((report, index) => {
    const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(report.generatedAt));
    const duration = `${fmt(report.performance.durationMilliseconds / 1000)} s`;
    const selected = index === selectedReportIndex ? ' selected' : '';
    return `<tr class="history-row${selected}"><td>${date}</td><td>${escapeHtml(report.game.name)}</td><td>${numberFormat.format(report.counts.roundsPerPath)}</td><td>${numberFormat.format(report.counts.pathsPerStrategy)}</td><td>${report.counts.candidateStrategies}</td><td>${duration}</td><td class="history-seed">${escapeHtml(report.settings.seed)}</td><td><button class="text-button" data-report-index="${index}">Ouvrir</button></td></tr>`;
  }).join('');
}

function populateModelForm() {
  $('#providerInput').value = state.model.provider || '';
  $('#versionInput').value = state.model.version || '';
  $('#rtpInput').value = state.model.theoreticalRtp ?? '';
  $('#sourceInput').value = state.model.source || '';
  $('#notesInput').value = state.model.notes || '';
  $('#verifyAssumptions').checked = Boolean(state.model.assumptionsVerified);
  $$('.prob-input').forEach((input) => {
    const probability = state.model.reachProbabilities?.[input.dataset.target];
    input.value = Number.isFinite(probability) ? String(probability * 100) : '';
  });
  $('#gameDialog').showModal();
}

function saveModel(event) {
  event.preventDefault();
  const probabilityTable = {};
  for (const input of $$('.prob-input')) {
    const raw = input.value.trim();
    if (!raw) continue;
    const percentage = Number(raw);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return toast('Les probabilités doivent être comprises entre 0 et 100 %.');
    probabilityTable[input.dataset.target] = percentage / 100;
  }
  const rawRtp = $('#rtpInput').value.trim();
  const rtp = rawRtp ? Number(rawRtp) : null;
  if (rtp !== null && (!Number.isFinite(rtp) || rtp < 0 || rtp > 100)) return toast('Le RTP théorique doit être compris entre 0 et 100 %.');
  const candidate = {
    provider: $('#providerInput').value.trim(),
    version: $('#versionInput').value.trim(),
    theoreticalRtp: rtp,
    reachProbabilities: probabilityTable,
    source: $('#sourceInput').value.trim(),
    notes: $('#notesInput').value.trim(),
    assumptionsVerified: $('#verifyAssumptions').checked
  };
  try { createAviatorModel(candidate); } catch (error) { return toast(error.message); }
  state.model = candidate;
  selectedReportIndex = 0;
  persist();
  $('#gameDialog').close();
  renderAll();
  toast('Configuration enregistrée dans ce navigateur.');
}

async function startDiscovery() {
  if (running) return;
  let model;
  let settings;
  try {
    model = currentModel();
    settings = settingsFromForm();
    if (!model.knownTargets.length) throw new Error('Aucune probabilité de cash-out documentée.');
  } catch (error) { return toast(error.message); }

  running = true;
  state.settings = { ...settings, proportionalFraction: settings.proportionalFraction * 100, proportionalFractionIsRatio: false };
  $('#runButton').disabled = true;
  $('#runButton').innerHTML = '<span>◌</span> Recherche et validation en cours…';
  $('#progressArea').classList.remove('hidden');
  $('#progressBar').style.width = '0%';
  $('#progressText').textContent = 'Initialisation du modèle…';
  $('#progressPercent').textContent = '0 %';
  try {
    const report = await runDiscovery(model, settings, {
      onProgress(progress) {
        const percentage = Math.round((progress.overallStep / progress.totalSteps) * 100);
        const phase = progress.phase === 'exploration' ? 'Exploration' : 'Validation simulée';
        $('#progressText').textContent = `${phase} · ${progress.strategyName || progress.candidateId || ''}`;
        $('#progressPercent').textContent = `${percentage} %`;
        $('#progressBar').style.width = `${percentage}%`;
      }
    });
    state.reports.unshift(report);
    state.reports = state.reports.slice(0, 10);
    selectedReportIndex = 0;
    persist();
    renderAll();
    toast(`${numberFormat.format(report.performance.simulatedRounds)} simulations terminées; rapport prêt.`);
  } catch (error) {
    toast(`Simulation interrompue : ${error.message}`);
  } finally {
    running = false;
    $('#progressArea').classList.add('hidden');
    $('#runButton').innerHTML = '<span>▶</span> Lancer la recherche';
    renderRunEstimate();
  }
}

function exportReport(kind) {
  const report = currentReport();
  if (!report) return toast('Aucun rapport à exporter.');
  const date = new Date(report.generatedAt).toISOString().slice(0, 10);
  if (kind === 'csv') downloadTextFile(`1win-ai-lab-${date}.csv`, reportAsCsv(report), 'text/csv');
  else downloadTextFile(`1win-ai-lab-${date}.json`, reportAsJson(report), 'application/json');
}

function clearHistory() {
  state.reports = [];
  selectedReportIndex = 0;
  persist();
  $('#confirmDialog').close();
  renderAll();
  toast('Historique local effacé.');
}

function updateEstimateOnSettingsChange() {
  try {
    state.settings = { ...settingsFromForm(), proportionalFraction: Number($('#proportionInput').value), proportionalFractionIsRatio: false };
    persist();
  } catch { /* Input is being edited; validation runs on submission. */ }
  renderRunEstimate();
}

$('#openConfig').addEventListener('click', populateModelForm);
$('#editModel').addEventListener('click', populateModelForm);
$('#closeGameDialog').addEventListener('click', () => $('#gameDialog').close());
$('#cancelGameDialog').addEventListener('click', () => $('#gameDialog').close());
$('#gameForm').addEventListener('submit', saveModel);
$('#runButton').addEventListener('click', startDiscovery);
$('#exportJson').addEventListener('click', () => exportReport('json'));
$('#exportCsv').addEventListener('click', () => exportReport('csv'));
$('#clearHistory').addEventListener('click', () => $('#confirmDialog').showModal());
$('#confirmClearButton').addEventListener('click', (event) => { event.preventDefault(); clearHistory(); });
$('#historyBody').addEventListener('click', (event) => {
  const button = event.target.closest('[data-report-index]');
  if (!button) return;
  selectedReportIndex = Number(button.dataset.reportIndex);
  renderHistory();
  renderCurrentReport();
});
for (const id of ['roundsSelect', 'pathsSelect', 'stakeInput', 'bankrollInput', 'stopLossInput', 'takeProfitInput', 'lossStreakInput', 'progressionCapInput', 'proportionInput', 'alphaSelect', 'ruinLimitInput', 'seedInput']) {
  $(`#${id}`).addEventListener('change', updateEstimateOnSettingsChange);
}
window.addEventListener('resize', () => renderChart(safeCurrentModel(), currentReport()));
window.addEventListener('storage', (event) => { if (event.key === STORAGE_KEY) location.reload(); });

syncSettingsToForm();
renderAll();

