/* Contract tests for inline lead row cells, Next Action presets + custom entry, RBAC owner gate, and saveInlineLeadFields. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
}

const sandbox = vm.createContext({
  console,
  URLSearchParams,
  setTimeout() {},
  clearTimeout() {},
  Date,
  CSS: { escape: s => s },
  localStorage: makeStorage(),
  sessionStorage: makeStorage(),
  document: {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  },
  window: { addEventListener() {} },
});

for (const file of ['static/js/utils/icons.js', 'static/js/utils/api.js', 'static/js/app.js', 'static/js/utils/lead-inline-editor.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}
const run = code => vm.runInContext(code, sandbox);

async function main() {
  run(`
    App.state.currentUser = { id: 'adm1', role: 'admin' };
    App.state.users = [{ id: 'adm1', name: 'Abhijeet', role: 'admin' }, { id: 'mem1', name: 'Shailesh', role: 'member' }];
    App.state.deals = [];
    App.state.visibleColumns = ['company', 'contact', 'phone', 'email', 'city', 'deal_value', 'priority', 'next_task', 'status', 'assigned_to', 'internal_note', 'call_stage'];
    App.state.leads = [{
      id: 'l1', name: 'Mohammed', business_name: 'DGS SEALS', phone: '8422976866',
      email: 'm@dgs.example', city: 'Mumbai', deal_value: 250000,
      priority: 'unexplored', status: 'new', call_stage: 'uncontacted',
      next_action: 'Speed to lead call (< 5 mins)', assigned_to: 'adm1',
      last_update_notes: 'dnp note', channel_data: { ad_name: 'Ad 6' }
    }];
  `);

  const adminRow = run(`App.renderLeadRow(App.state.leads[0])`);
  assert(!adminRow.includes('onclick="App.viewLead'), 'Row itself must not trigger navigation');
  for (const field of ['priority', 'next_task', 'status', 'assigned_to', 'internal_note', 'call_stage']) {
    assert(adminRow.includes(`'${field}'`), `Expected inline handler for ${field}`);
  }
  for (const metaField of ['company', 'phone', 'email', 'city']) {
    assert(!adminRow.includes(`App.startLeadInlineEdit?.(this, 'l1', '${metaField}')`), `Meta-sourced field ${metaField} must NOT be inline-editable in front table`);
  }
  assert(adminRow.includes("App.startLeadInlineEdit?.(this, 'l1', 'deal_value')"), 'deal_value should remain inline-editable');
  assert(adminRow.includes('dnp note'));

  // Non-admin (member) must NOT get owner reassignment trigger
  run(`App.state.currentUser = { id: 'mem1', role: 'member' };`);
  const memberRow = run(`App.renderLeadRow(App.state.leads[0])`);
  assert(!memberRow.includes("'assigned_to')"), 'Member must not render interactive Owner reassign button');

  // Setting a custom/preset Next Action on a status=new/uncontacted lead must display in Next action cell instead of stale 'First call · waiting'
  const stepNew = run(`App.getLeadNextStep({ status: 'new', call_stage: 'uncontacted', next_action: 'Prototype needed', created_at: '2026-10-01T00:00:00Z' }).text`);
  assert.equal(stepNew, 'Prototype needed');

  // Verify expected Next Action operational presets exist
  const presets = JSON.parse(run(`JSON.stringify(App.NEXT_ACTION_PRESETS.map(p => p.label))`));
  assert(presets.includes('Prototype needed'));
  assert(presets.includes('Proposal to be sent'));

  // Verify partial PUT discipline in saveInlineLeadFields (only changed field sent, never channel_data)
  run(`
    window.puts = [];
    window.posts = [];
    window.toasts = [];
    API.put = async (ep, body) => { window.puts.push({ ep, body }); return { ...App.state.leads[0], ...body }; };
    API.post = async (ep, body) => { window.posts.push({ ep, body }); return body; };
    API.showToast = (m) => window.toasts.push(m);
  `);
  await run(`App.saveInlineLeadFields('l1', { priority: 'high' }, { toastMessage: 'Priority updated' })`);
  const puts = JSON.parse(run('JSON.stringify(window.puts)'));
  assert.deepEqual(puts, [{ ep: '/api/leads/l1', body: { priority: 'high' } }]);
  assert.equal(run('App.state.leads[0].priority'), 'high');
  assert.equal(run('App.state.leads[0].channel_data.ad_name'), 'Ad 6');

  // Internal note saves both PUT last_update_notes and POST /notes history
  await run(`App.saveInlineLeadFields('l1', { last_update_notes: 'Needs proposal by Friday' }, { toastMessage: 'Saved', alsoLogNote: 'Needs proposal by Friday' })`);
  const posts = JSON.parse(run('JSON.stringify(window.posts)'));
  assert.deepEqual(posts, [{ ep: '/api/leads/l1/notes', body: { content: 'Needs proposal by Friday' } }]);

  console.log('PASS: inline cell triggers, member RBAC owner lock, New-lead Next Action display, presets, partial PUT discipline, dual note persistence');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
