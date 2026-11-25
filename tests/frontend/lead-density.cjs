/* Regression checks for the single-value lead grid and saved preferences. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)) };
}
function appWith(preferences = {}) {
  const localStorage = storage(preferences);
  const sandbox = vm.createContext({ console, localStorage, window: {},
    document: { readyState: 'loading', addEventListener() {} } });
  for (const file of ['static/js/utils/icons.js', 'static/js/utils/api.js', 'static/js/app.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
  }
  return { run: code => vm.runInContext(code, sandbox), localStorage };
}
const defaults = ['contact', 'company', 'phone', 'priority', 'next_task', 'status', 'assigned_to'];
const legacy = ['contact', 'company', 'priority', 'next_task', 'internal_note', 'upload_media', 'call_stage', 'status', 'assigned_to', 'actions'];
for (const raw of [null, JSON.stringify(legacy), '{invalid-json']) {
  const { run } = appWith(raw ? { zero7_lead_columns: raw } : {});
  assert.deepEqual(JSON.parse(run('JSON.stringify(App.loadLeadColumnPreferences())')), defaults);
}
{
  const { run, localStorage } = appWith({ zero7_lead_columns: JSON.stringify(['contact', 'company', 'inbound', 'next_task']) });
  const migrated = JSON.parse(run('JSON.stringify(App.loadLeadColumnPreferences())'));
  for (const id of ['contact', 'phone', 'company', 'city', 'deal', 'inbound', 'inbound_age', 'next_task', 'task_due']) assert(migrated.includes(id), id);
  assert.equal(localStorage.getItem('zero7_lead_columns_v1_backup'), JSON.stringify(['contact', 'company', 'inbound', 'next_task']));
}
{
  const chosen = ['contact', 'city', 'phone'];
  const { run } = appWith({ zero7_lead_columns: JSON.stringify(chosen), zero7_lead_columns_version: '2' });
  assert.deepEqual(JSON.parse(run('JSON.stringify(App.loadLeadColumnPreferences())')), chosen);
}
const { run } = appWith();
run(`
  App.state.currentUser = {id:'admin1', role:'admin'};
  App.state.users = [{id:'owner',name:'Operator'}];
  App.state.deals = [{id:'deal',lead_id:'lead',title:'Active delivery',value:150000}];
  App.state.visibleColumns = ['contact','company','phone','city','next_task','task_due','status','deal'];
  App.state.leads = [{id:'lead',name:'Alpha Person',phone:'9999999999',email:'alpha@example.com',
    business_name:'Beta Company',city:'Mumbai',priority:'high',status:'qualified',call_stage:'connected',
    last_update_notes:'Existing internal note',next_action:'Review the proposal',next_action_date:'Tomorrow, 12 PM',assigned_to:'owner'}];
`);
const html = run('App.renderLeadRow(App.state.leads[0])');
assert(!/^<tr[^>]*onclick=/.test(html), 'Row-level onclick must be removed to protect inline cell edits');
const cell = column => {
  const match = html.match(new RegExp('<td[^>]*data-column="' + column + '"[^>]*>([\\s\\S]*?)</td>'));
  assert(match, 'Missing cell ' + column); return match[1];
};
assert(cell('contact').includes('Alpha Person'));
assert(cell('contact').includes("App.viewLead('lead')"));
assert(!cell('contact').includes('9999999999'));
assert(cell('phone').includes('9999999999'));
assert(cell('company').includes('Beta Company'));
assert(!cell('company').includes('Mumbai'));
assert(!cell('company').includes('Active delivery'));
assert(cell('city').includes('Mumbai'));
assert(cell('next_task').includes('Review the proposal'));
assert(!cell('next_task').includes('Tomorrow'));
assert(cell('task_due').includes('Tomorrow, 12 PM'));
assert(!cell('status').includes('Active delivery'));
assert(cell('deal').includes('Active delivery'));
assert.equal((html.match(/<td\b/g) || []).length, 8);
assert.equal((run('App.renderTableHeaders()').match(/<th\b/g) || []).length, 8);
const original = run('JSON.stringify(App.state.leads[0])');
run('App.renderLeadRow(App.state.leads[0])');
assert.equal(run('JSON.stringify(App.state.leads[0])'), original, 'Rendering must preserve source notes and data');
run("App.state.leads[0].next_action = ''; App.state.visibleColumns = ['contact','next_task'];");
const emptyAction = run('App.renderLeadRow(App.state.leads[0])');
assert(emptyAction.includes('Auto-generate next task with AI'));
assert(emptyAction.includes("App.generateLeadTask('lead')"));
assert(!emptyAction.includes('Tomorrow'));
{
  const { run: rReorder, localStorage } = appWith({
    zero7_lead_columns: JSON.stringify(['contact', 'company', 'phone']),
    zero7_lead_columns_version: '2',
  });
  rReorder("App.state.visibleColumns = App.loadLeadColumnPreferences(); App.reorderLeadColumns('company', 'contact');");
  assert.deepEqual(JSON.parse(rReorder('JSON.stringify(App.state.visibleColumns)')), ['company', 'contact', 'phone']);
  assert.deepEqual(JSON.parse(localStorage.getItem('zero7_lead_columns')), ['company', 'contact', 'phone']);
  rReorder("App.moveLeadColumn('phone', -1);");
  assert.deepEqual(JSON.parse(rReorder('JSON.stringify(App.state.visibleColumns)')), ['company', 'phone', 'contact']);
  const hdrs = rReorder('App.renderTableHeaders()');
  assert(hdrs.indexOf('data-column="company"') < hdrs.indexOf('data-column="contact"'), 'Company header must render before Name');
}
console.log('PASS: single-value cells, optional columns, column reordering (Company before Name), click isolation, legacy preference migration, header alignment, source preservation');
