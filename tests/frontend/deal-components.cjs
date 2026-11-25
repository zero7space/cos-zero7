const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tabs = ['deliverables', 'payments', 'links', 'details'].map(name => ({
  dataset: { dealTab: name }, selected: false, attributes: {},
  classList: { toggle(_, value) { tabs.find(t => t.dataset.dealTab === name).selected = value; } },
  setAttribute(key, value) { this.attributes[key] = value; }
}));
const panels = Object.fromEntries(tabs.map(t => ['deal-tab-' + t.dataset.dealTab, { style: {} }]));
const sandbox = vm.createContext({
  console, localStorage: { getItem() { return null; } }, window: {},
  document: { readyState: 'loading', addEventListener() {},
    getElementById(id) { return panels[id]; }, querySelectorAll() { return tabs; } }
});
for (const file of ['static/js/utils/icons.js', 'static/js/utils/api.js', 'static/js/app.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
const run = code => vm.runInContext(code, sandbox);
async function main() {
  for (const [amount, expected] of [[0, '₹0'], [25000, '₹25K'], [150000, '₹1.5L'], [3655000, '₹36.55L'], [12000000, '₹1.2Cr']]) {
    assert.equal(run(`App.formatCurrency(${amount})`), expected);
  }
  run(`
    App.state.selectedDeal = { id: 'snapshot-deal', deliverables: [
      'Original scope wording', { title: 'Existing module', completed: true, metadata: { source: 'human' } }
    ] };
    API.post = async (endpoint, body) => { window.saved = { endpoint, body }; return body; };
    App.loadInitialData = async () => {};
    App.viewDeal = async () => {};
  `);
  assert.equal(run('App.normalizeDealDeliverables(App.state.selectedDeal.deliverables)[0].title'), 'Original scope wording');
  assert.equal(run('typeof App.state.selectedDeal.deliverables[0]'), 'string', 'Rendering must not rewrite stored source data');
  await run(`App.toggleDealDeliverable('snapshot-deal', 0)`);
  assert.equal(run('window.saved.endpoint'), '/api/deals/snapshot-deal/deliverables');
  assert.equal(run('window.saved.body.deliverables[0].title'), 'Original scope wording');
  assert.equal(run('window.saved.body.deliverables[0].completed'), true);
  assert.equal(run('window.saved.body.deliverables[1].metadata.source'), 'human');
  assert.equal(run('window.saved.body.deliverables[1].completed'), true);
  run('App.state.selectedDeal.deliverables = window.saved.body.deliverables');
  await run(`App.toggleDealDeliverable('snapshot-deal', 0)`);
  assert.equal(run('window.saved.body.deliverables[0].completed'), false);
  assert.equal(run('window.saved.body.deliverables[0].title'), 'Original scope wording');
  for (const name of ['links', 'details', 'payments', 'deliverables']) {
    run(`App.switchDealModalTab('${name}')`);
    assert.equal(tabs.filter(t => t.selected).length, 1);
    assert.equal(tabs.find(t => t.selected).dataset.dealTab, name);
    assert.equal(tabs.find(t => t.selected).attributes['aria-selected'], 'true');
    assert.equal(panels['deal-tab-' + name].style.display, '');
  }
  console.log('PASS: legacy string scope, object metadata preservation, completion payload and reversal, all four dialog tabs');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
