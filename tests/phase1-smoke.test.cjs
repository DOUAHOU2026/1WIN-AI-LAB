const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    const shouldAdd = force === undefined ? !this.values.has(value) : force;
    if (shouldAdd) this.values.add(value); else this.values.delete(value);
    return shouldAdd;
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
    this.classList = new FakeClassList();
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
    this.disabled = false;
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  scrollIntoView() {}
  getBoundingClientRect() { return { width: 600, height: 156 }; }
  getContext() {
    return new Proxy({}, { get: (_target, key) => key === 'measureText' ? () => ({ width: 0 }) : () => {} , set: () => true });
  }
}

const referencedIds = [...app.matchAll(/\$\('#([\w-]+)'\)/g)].map((match) => match[1]);
const htmlIds = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((match) => match[1]));
const absent = [...new Set(referencedIds)].filter((id) => !htmlIds.has(id));
assert.deepEqual(absent, [], `IDs referenced by app.js exist in index.html: ${absent.join(', ')}`);

const elements = new Map([...htmlIds].map((id) => [id, new FakeElement(id)]));
for (const [id, value] of Object.entries({
  targetSelect: '1.2', roundsSelect: '10000', pathsInput: '3', stakingSelect: 'flat',
  stakeInput: '1', bankrollInput: '100000', fractionInput: '2', capInput: '16', seedInput: 'PHASE1-TEST-42'
})) elements.get(id).value = value;
elements.get('strategyChart').getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
const probabilityRequired = new FakeElement('probabilityRequired');
const probabilityHeading = new FakeElement();
const probabilityText = new FakeElement();
const specialSelectors = new Map([
  ['#probabilityRequired strong', probabilityHeading],
  ['#probabilityRequired p', probabilityText]
]);
const probabilityInputs = [1.2, 1.5, 2, 3, 5, 10].map((target) => {
  const input = new FakeElement();
  input.dataset.target = String(target);
  return input;
});
const localStorage = {
  value: null,
  getItem() { return this.value; },
  setItem(_key, value) { this.value = value; }
};
let nextTimeout = 0;
const context = {
  document: {
    querySelector(selector) { return specialSelectors.get(selector) || elements.get(selector.slice(1)); },
    querySelectorAll(selector) { return selector === '.prob-input' ? probabilityInputs : []; },
    createElement() { return new FakeElement(); }
  },
  window: { devicePixelRatio: 1, addEventListener() {} },
  localStorage,
  structuredClone,
  Intl,
  Date,
  Math,
  JSON,
  Blob,
  URL,
  setTimeout(callback, delay) { if (delay === 0) return setImmediate(callback); return ++nextTimeout; },
  clearTimeout() {},
  console
};
vm.runInNewContext(app, context, { filename: 'app.js' });

async function main() {
  assert.equal(elements.get('runButton').disabled, true, 'simulation is blocked while Aviator probabilities are unknown');
  assert.equal(elements.get('validationStatus').textContent, 'EN COURS DE TEST');

  elements.get('providerInput').value = 'Version de test, non vérifiée';
  elements.get('sourceInput').value = 'https://example.org/rules';
  elements.get('notesInput').value = 'Probabilités synthétiques pour vérifier le moteur uniquement.';
  [80, 60, 40, 30, 10, 5].forEach((value, index) => { probabilityInputs[index].value = String(value); });
  await elements.get('gameForm').listeners.get('submit')({ preventDefault() {} });
  assert.equal(elements.get('runButton').disabled, false, 'a supplied target probability enables the conditional simulator');

  const run = elements.get('runButton').listeners.get('click');
  await run();
  const first = JSON.parse(localStorage.value);
  assert.equal(first.history.length, 1);
  assert.equal(first.history[0].target, 1.2);
  assert.equal(first.history[0].q, 0.8);
  assert.equal(first.history[0].theoreticalEv, -0.040000000000000036);
  assert.equal(first.history[0].totalPlayed, 30000);
  const firstWins = first.history[0].wins;
  const firstNet = first.history[0].totalNet;

  await run();
  const second = JSON.parse(localStorage.value);
  assert.equal(second.history.length, 2);
  assert.equal(second.history[0].wins, firstWins, 'same seed and parameters reproduce winning count');
  assert.equal(second.history[0].totalNet, firstNet, 'same seed and parameters reproduce net result');
  assert.equal(elements.get('resultRuin').textContent, '0 %');
  assert.equal(elements.get('resultTheory').textContent, '-4 %');

  elements.get('stakingSelect').value = 'martingale';
  elements.get('capInput').value = '4';
  elements.get('seedInput').value = 'MARTINGALE-CHECK';
  await run();
  const third = JSON.parse(localStorage.value).history[0];
  assert.equal(third.staking, 'martingale');
  assert.equal(third.totalPlayed, 30000);
  assert.ok(third.ruined >= 0 && third.ruined <= third.paths);

  elements.get('stakingSelect').value = 'flat';
  elements.get('bankrollInput').value = '1000000';
  elements.get('pathsInput').value = '2';
  for (const requestedRounds of [10000, 50000, 100000]) {
    elements.get('roundsSelect').value = String(requestedRounds);
    elements.get('seedInput').value = `ROUND-LIMIT-${requestedRounds}`;
    await run();
    const latest = JSON.parse(localStorage.value).history[0];
    assert.equal(latest.roundsPerPath, requestedRounds);
    assert.equal(latest.totalPlayed, requestedRounds * 2);
    assert.ok(latest.netLow <= latest.averageNet && latest.averageNet <= latest.netHigh);
    assert.ok(latest.ruinLow <= (latest.ruined / latest.paths) && (latest.ruined / latest.paths) <= latest.ruinHigh);
  }

  console.log('PASS: UI IDs, unknown-probability guard, conditional EV, reproducible seed, flat and capped Martingale staking, ruin metrics, confidence intervals, and 10k/50k/100k-round scenarios.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

