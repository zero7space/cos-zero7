/* Run with node tests/frontend/heroui-contract.cjs. No live service writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = { innerHTML: '' };
const sandbox = vm.createContext({
  console, URLSearchParams, setTimeout() {},
  localStorage: { getItem() { return null; } },
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return page; } },
  window: {},
});
for (const file of ['static/js/utils/icons.js', 'static/js/utils/api.js', 'static/js/app.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}
const run = code => vm.runInContext(code, sandbox);
async function main() {
  run(`
    App.state.currentUser = { id: 'preview', name: 'Preview Operator', role: 'member' };
    App.state.currentView = 'mail';
    const m = App._initMailState();
    m.messages = [
      { messageId: 'message/1', folderId: 'folder/1', subject: 'Review <proposal>', senderName: 'Preview Sender', summary: 'Review the scoped proposal.', timestamp: Date.now(), isUnread: true },
      { messageId: 'message/2', folderId: 'folder/1', subject: 'Follow up', senderName: 'Second Sender', summary: 'Confirm next steps.', timestamp: Date.now() }
    ];
    m.pagination.total = 2;
    API.get = async endpoint => {
      window.lastEndpoint = endpoint;
      const selected = m.messages.find(x => endpoint.endsWith(encodeURIComponent(x.messageId)));
      return { message: selected, thread: [selected] };
    };
  `);
  await run(`App.openMailThread('folder/1', 'message/1')`);
  assert.equal(run('window.lastEndpoint'), '/api/mail/messages/folder%2F1/message%2F1');
  assert.match(page.innerHTML, /mail-right-column has-reader/);
  assert.match(page.innerHTML, /data-mail-message="message\/1"/);
  assert.match(page.innerHTML, /Review &lt;proposal&gt;/);
  assert.match(page.innerHTML, /Second Sender/);
  assert.equal((page.innerHTML.match(/mail-thread-index-item active/g) || []).length, 1);
  await run(`App.openMailThread('folder/1', 'message/2')`);
  assert.equal(run('App.state.mail.activeThread.message.messageId'), 'message/2');
  assert.match(page.innerHTML, /class="mail-thread-index-item active"\s+data-mail-folder="folder\/1" data-mail-message="message\/2"/);
  run('App.closeMailThread()');
  assert.doesNotMatch(page.innerHTML, /mail-right-column has-reader/);
  assert.match(page.innerHTML, /mail-pagination-footer/);
  assert.match(page.innerHTML, /Preview Sender/);
  run(`App.state.currentView = 'team'`);
  assert.doesNotMatch(run('App.renderAppLayout()'), /onclick="App.openAddMemberModal\(\)"/);
  run(`App.state.currentUser.role = 'admin'`);
  assert.match(run('App.renderAppLayout()'), /onclick="App.openAddMemberModal\(\)"/);
  const baseline = 'scratch/hero-production-baseline/app.js';
  if (fs.existsSync(baseline)) {
    const calls = source => source.match(/API\.(?:get|post|put|patch|delete)\([^\n]+/g).map(c => c.trimEnd());
    // Scheduled-call follow-ups add exactly these calls, all on existing lead routes.
    const followUpCalls = [
      'API.put(`/api/leads/${id}`, fields).catch(() => null)));',
      'API.put(`/api/leads/${leadId}`, {',
      'API.post(`/api/leads/${leadId}/notes`, {',
      "API.put(`/api/leads/${leadId}`, { next_action: '', next_action_date: '' });",
      "API.put(`/api/leads/${leadId}`, { next_action: '', next_action_date: '' });",
      'API.post(`/api/leads/${leadId}/notes`, { content: noteText }).catch(() => null);',
      "API.get('/api/leads');",
      // Lead flow: a call outcome also moves the lead's status forward (or to lost).
      'API.put(`/api/leads/${leadId}`, flowUpdate);',
      "API.put(`/api/leads/${leadId}`, { call_stage: 'connected', ...this.getFlowUpdate(metLead, this.CALL_OUTCOMES.Connected) });",
    ];
    const base = calls(fs.readFileSync(baseline, 'utf8'));
    const extra = [];
    let matched = 0;
    for (const call of calls(fs.readFileSync('static/js/app.js', 'utf8'))) {
      if (matched < base.length && call === base[matched]) matched++;
      else extra.push(call);
    }
    assert.equal(matched, base.length, 'every baseline API call is preserved in order');
    assert.deepEqual([...extra].sort(), [...followUpCalls].sort());
  }
  console.log('PASS: mail selection, encoded IDs, active message, escaped text, list/reader/close, pagination, admin controls, API parity');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
