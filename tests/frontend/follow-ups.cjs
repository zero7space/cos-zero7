/* Run with node tests/frontend/follow-ups.cjs. No live service writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = { innerHTML: '' };
const sandbox = vm.createContext({
  console, URLSearchParams, setTimeout() {}, setInterval() {}, Date,
  localStorage: { getItem() { return null; } },
  sessionStorage: { getItem() { return null; }, setItem() {} },
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return page; }, querySelectorAll() { return []; } },
  window: {},
  confirm: () => false,
});
for (const file of ['static/js/utils/icons.js', 'static/js/utils/api.js', 'static/js/app.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}
const run = code => vm.runInContext(code, sandbox);

async function main() {
  // Parsing: IST timestamps are scheduled calls; AI free-text deadlines are not.
  const call = run(`App.getScheduledCall({ next_action: 'Call: Discuss quotation', next_action_date: '2026-11-02T11:00:00+05:30' })`);
  assert.equal(call.date, '2026-11-02');
  assert.equal(call.time, '11:00');
  assert.equal(call.purpose, 'Discuss quotation');
  assert.equal(call.at.toISOString(), '2026-11-02T05:30:00.000Z');
  const naive = run(`App.getScheduledCall({ next_action: 'Call back', next_action_date: '2026-11-02 18:15' })`);
  assert.equal(naive.at.toISOString(), '2026-11-02T12:45:00.000Z', 'zone-less values are read as IST');
  assert.equal(run(`App.getScheduledCall({ next_action: 'Send proposal', next_action_date: 'Today, 5 PM' })`), null);
  assert.equal(run(`App.getScheduledCall({ next_action: 'Send proposal', next_action_date: '2026-11-02' })`), null);
  assert.equal(run(`App.getScheduledCall({})`), null);

  // Buckets are computed on the IST calendar (now = 31 Oct 2026, 23:00 IST).
  const now = 'new Date("2026-10-31T17:30:00Z")';
  const bucket = value => run(`App.getCallBucket(App.getScheduledCall({ next_action_date: '${value}' }), ${now})`);
  assert.equal(bucket('2026-10-31T22:00:00+05:30'), 'overdue');
  assert.equal(bucket('2026-10-31T23:30:00+05:30'), 'today');
  assert.equal(bucket('2026-11-01T09:00:00+05:30'), 'tomorrow');
  assert.equal(bucket('2026-11-07T11:00:00+05:30'), 'week');
  assert.equal(bucket('2026-11-09T11:00:00+05:30'), 'later');
  assert.equal(run(`App.istParts(new Date("2026-10-31T19:00:00Z")).date`), '2026-11-01', 'IST date rolls over at 18:30 UTC');

  // Presets stay inside TRAI calling hours (09:00-21:00 IST).
  for (const preset of ['1h', 'tomorrow', '2d', 'monday', '1w']) {
    const value = run(`App.getCallPreset('${preset}')`);
    assert.match(value.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(value.time >= '09:00' && value.time <= '21:00', `${preset} -> ${value.time}`);
  }
  const monday = run(`App.getCallPreset('monday')`);
  assert.equal(new Date(`${monday.date}T00:00:00Z`).getUTCDay(), 1);

  // Due count and ordering use loaded leads; unscheduled leads are ignored.
  run(`App.state.leads = [
    { id: 'a', name: 'Later', next_action_date: '2099-01-02T11:00:00+05:30' },
    { id: 'b', name: 'Overdue', next_action_date: '2020-01-01T11:00:00+05:30' },
    { id: 'c', name: 'AI task', next_action_date: 'Tomorrow, 12 PM' }
  ]`);
  assert.deepEqual(Array.from(run('App.getScheduledCalls().map(x => x.lead.id)')), ['b', 'a']);
  assert.equal(run('App.getDueCallCount()'), 1);

  // Lead table "Due" cell shows the formatted call; text is escaped.
  run(`App.state.visibleColumns = ['task_due']; App.state.users = []; App.state.deals = []`);
  const row = run(`App.renderLeadRow({ id: 'b', name: '<x>', next_action_date: '2020-01-01T11:00:00+05:30' })`);
  assert.match(row, /call-due bucket-overdue/);
  assert.match(row, /1 Jan, 11:00/);

  // Bulk AI task generation restores human-scheduled calls afterwards.
  run(`
    window.puts = [];
    API.post = async () => ({ message: 'ok' });
    API.put = async (endpoint, body) => { window.puts.push([endpoint, body]); return {}; };
    API.get = async () => [];
    API.showToast = () => {};
  `);
  await run('App.generateAllTasks()');
  assert.deepEqual(JSON.parse(run('JSON.stringify(window.puts)')), [
    ['/api/leads/b', { next_action_date: '2020-01-01T11:00:00+05:30' }],
    ['/api/leads/a', { next_action_date: '2099-01-02T11:00:00+05:30' }],
  ]);

  // A single AI regeneration asks before replacing a scheduled call (confirm() -> false here).
  run(`App.state.leads = [{ id: 'b', name: 'Overdue', next_action: 'Call: x', next_action_date: '2020-01-01T11:00:00+05:30' }]; window.posted = 0; API.post = async () => { window.posted++; return null; }`);
  await run(`App.generateLeadTask('b')`);
  assert.equal(run('window.posted'), 0);

  // Logging a call completes a call that was due; the next-call prompt follows a DNP.
  run(`
    window.puts = [];
    App.state.selectedLead = { id: 'b', name: 'Overdue', next_action: 'Call: x', next_action_date: '2020-01-01T11:00:00+05:30' };
    App.viewLead = async () => {};
    App.loadInitialData = async () => {};
    window.prompted = null;
    App.promptNextCall = (id, preset) => { window.prompted = [id, preset]; };
  `);
  const form = run(`({
    querySelector(sel) {
      return ({ 'button[type="submit"]': null, '#selected-outcome': { value: 'DNP' },
        '[name="notes"]': { value: 'No answer' }, '[name="duration_minutes"]': { value: '2' },
        '[name="recording"]': { files: [] } })[sel];
    }
  })`);
  sandbox.__form = form;
  await run(`App.handleQuickLogCall({ preventDefault() {}, target: __form }, 'b')`);
  const puts = JSON.parse(run('JSON.stringify(window.puts)'));
  assert.deepEqual(puts.map(p => p[1]), [{ call_stage: 'dnp' }, { status: 'contacted' }, { next_action: '', next_action_date: '' }]);
  assert.deepEqual(Array.from(run('window.prompted')), ['b', '1h']);

  // Outcome is required; connected outcomes require a note.
  const logWith = async (outcome, notes, lead) => {
    sandbox.__lead = lead;
    run(`window.puts = []; window.posts = []; window.prompted = null; window.toasts = []; API.showToast = (m) => window.toasts.push(m); App.state.selectedLead = __lead;
         API.post = async (endpoint, body) => { window.posts.push(body); return null; };`);
    sandbox.__form = run(`({ querySelector(sel) { return ({ 'button[type="submit"]': null, '#selected-outcome': { value: ${JSON.stringify(outcome)} },
      '[name="notes"]': { value: ${JSON.stringify(notes)} }, '[name="duration_minutes"]': { value: '3' }, '[name="recording"]': { files: [] } })[sel]; } })`);
    await run(`App.handleQuickLogCall({ preventDefault() {}, target: __form }, ${JSON.stringify(lead.id)})`);
    return JSON.parse(run('JSON.stringify(window.puts)')).map(p => p[1]);
  };
  assert.deepEqual(await logWith('', 'x', { id: 'c' }), []);
  assert.deepEqual(await logWith('Interested', '  ', { id: 'c' }), []);
  assert.match(run('window.toasts.join()'), /note/);

  // Interested qualifies a contacted lead and marks it hot; a won lead's status is never touched.
  assert.deepEqual(await logWith('Interested', 'Wants quote', { id: 'c', status: 'contacted', temperature: 'warm' }),
    [{ call_stage: 'interested' }, { status: 'qualified', temperature: 'hot' }]);
  assert.equal(run('window.posts[0].duration_minutes'), 3, 'connected calls keep the entered talk time');
  assert.deepEqual(Array.from(run('window.prompted')), ['c', '2d']);
  assert.deepEqual(await logWith('Not Interested', 'No budget', { id: 'w', status: 'won' }), [{ call_stage: 'not_interested' }]);

  // Not interested closes as lost, cancels a future call and does not prompt.
  assert.deepEqual(await logWith('Not Interested', 'No budget', { id: 'd', status: 'qualified', next_action: 'Call: x', next_action_date: '2099-01-01T11:00:00+05:30' }),
    [{ call_stage: 'not_interested' }, { status: 'lost', temperature: 'cold' }, { next_action: '', next_action_date: '' }]);
  assert.equal(run('window.prompted'), null);

  // A missed call needs no note and logs no talk time.
  assert.deepEqual(await logWith('DNP', '', { id: 'g', status: 'contacted' }), [{ call_stage: 'dnp' }]);
  assert.equal(run('window.posts[0].duration_minutes'), 0);
  assert.equal(run('window.toasts.some(t => /note/.test(t))'), false);

  // Retry cadence follows consecutive unanswered attempts; a future call is left alone.
  const missed = n => Array.from({ length: n }, (_, i) => ({ type: 'call', outcome: 'DNP', date: `2026-10-0${i + 1}T10:00:00Z` }));
  assert.equal(run(`App.getCallAttempts(${JSON.stringify({ activity: [...missed(2), { type: 'call', outcome: 'Connected', date: '2026-09-01T10:00:00Z' }, { type: 'note' }] })})`), 2);
  assert.equal(run(`App.getCallAttempts(${JSON.stringify({ activity: [{ type: 'call', outcome: 'Connected', date: '2026-10-09T10:00:00Z' }, ...missed(3)] })})`), 0);
  await logWith('DNP', '', { id: 'e', status: 'contacted', activity: missed(2) });
  assert.deepEqual(Array.from(run('window.prompted')).slice(0, 2), ['e', '2d']);
  assert.deepEqual(['1h', 'tomorrow', '2d', '1w', '1w'], [1, 2, 3, 4, 7].map(n => run(`App.getRetryPreset(${n})`)));
  assert.deepEqual(await logWith('DNP', '', { id: 'f', status: 'contacted', next_action: 'Call: x', next_action_date: '2099-01-01T11:00:00+05:30' }), [{ call_stage: 'dnp' }]);
  assert.equal(run('window.prompted'), null);

  // Lead flow step and next step (placeholder "Speed to lead" is not shown as a task).
  const step = (lead, deal = false) => run(`App.getLeadFlowStep(${JSON.stringify(lead)}, ${deal})`);
  assert.equal(step({ status: 'new', call_stage: 'uncontacted' }), 'new');
  assert.equal(step({ status: 'contacted', call_stage: 'dnp' }), 'attempting');
  assert.equal(step({ status: 'contacted', call_stage: 'first_call' }), 'connected');
  assert.equal(step({ status: 'qualified', call_stage: 'connected' }), 'qualified');
  assert.equal(step({ status: 'contacted', call_stage: 'not_interested' }), 'lost');
  assert.equal(step({ status: 'contacted' }, true), 'deal');
  const nowIso = 'new Date("2026-11-02T06:00:00Z")';
  const next = lead => JSON.parse(run(`JSON.stringify(App.getLeadNextStep(${JSON.stringify(lead)}, ${nowIso}))`));
  assert.deepEqual(next({ status: 'new', call_stage: 'uncontacted', next_action: 'Speed to lead call (< 5 mins)', created_at: '2026-10-30T06:00:00Z' }), { text: 'First call · waiting 3d', tone: 'overdue' });
  assert.deepEqual(next({ status: 'contacted', call_stage: 'connected', next_action: 'Speed to lead call (< 5 mins)' }), { text: 'Set next step', tone: 'unscheduled' });
  assert.deepEqual(next({ status: 'contacted', call_stage: 'connected', next_action: 'Send proposal' }), { text: 'Send proposal', tone: 'muted' });
  assert.equal(next({ status: 'contacted', call_stage: 'dnp', next_action: 'Call: Retry', next_action_date: '2026-11-02T10:00:00+05:30' }).tone, 'overdue');
  run(`App.state.visibleColumns = ['next_task', 'task_due']`);
  const placeholderRow = run(`App.renderLeadRow({ id: 'p', status: 'contacted', call_stage: 'connected', next_action: 'Speed to lead call (< 5 mins)', next_action_date: 'Today, 2 PM' })`);
  assert.doesNotMatch(placeholderRow, /Speed to lead|Today, 2 PM/);
  assert.match(placeholderRow, /Set next step/);

  // Form answers: Meta's stale "monthly revenue" key with employee bands is labelled as employees.
  const q = (k, a) => run(`App.formatFormQuestion(${JSON.stringify(k)}, ${JSON.stringify(a)})`);
  assert.equal(q('what_is_your_approximate_monthly_revenue?', '11-50'), 'How many employees work in your company?');
  assert.equal(q('what_is_your_approximate_monthly_revenue?', 'just_me_(1)'), 'How many employees work in your company?');
  assert.equal(q('what_is_your_approximate_monthly_revenue?', '₹10L'), 'What is your approximate monthly revenue?');
  assert.equal(q('are_you_currently_managing_work_in_excel,_tally_or_paper_registers?', 'yes'), 'Are you currently managing work in excel, tally or paper registers?');
  assert.equal(q('What does your business do?', 'trading'), 'What does your business do?');
  assert.deepEqual(['just_me_(1)', '11-50', '200+', 'manufacturing', 'yes', ''].map(a => run(`App.formatFormAnswer(${JSON.stringify(a)})`)),
    ['Just me (1)', '11–50', '200+', 'Manufacturing', 'Yes', '—']);

  // Pager follows the list the lead was opened from, falling back to the Leads table order.
  run(`App.state.leads = [{ id: 'x1', created_at: '2026-10-03' }, { id: 'x2', created_at: '2026-10-02' }, { id: 'x3', created_at: '2026-10-01' }];
       App.state.filters = { status: '', source: '', assigned_to: '', temperature: '', call_stage: '', priority: '', search: '' };
       App.state.leadNavIds = null; App.state.selectedLeadId = 'x2';`);
  assert.match(run('App.renderLeadPager()'), /2 of 3/);
  run(`App.state.leadNavIds = ['x3', 'x1']; App.state.selectedLeadId = 'x3';`);
  const pager = run('App.renderLeadPager()');
  assert.match(pager, /1 of 2/);
  assert.match(pager, /stepLead\(-1\)" disabled/);
  run(`window.viewed = []; App.viewLead = async (id) => { window.viewed.push(id); }; window.scrollTo = () => {};`);
  await run('App.stepLead(1)');
  await run('App.stepLead(-1)');
  assert.deepEqual(Array.from(run('window.viewed')), ['x1']);

  // Dashboard: hot leads by urgency, open proposals, invoices from milestones, weekly heat in IST weeks.
  run(`
    App.state.deals = [{ id: 'd1', lead_id: 'won1', title: 'Deal A', value: 100000, amount_received: 25000,
      payment_milestones: [{ milestone: 'Advance', amount: 25000, status: 'paid' }, { milestone: 'UAT', amount: 50000, status: 'due' },
                           { milestone: 'Go-live', amount: 25000, status: 'pending' }, { milestone: 'AMC', amount: 5000, status: 'recurring' }] }];
    App.state.leads = [
      { id: 'h1', temperature: 'hot', status: 'contacted', call_stage: 'connected', next_action: 'Send deck', created_at: '2026-10-27T05:00:00Z' },
      { id: 'h2', temperature: 'hot', status: 'new', call_stage: 'uncontacted', created_at: '2026-10-26T20:00:00Z' },
      { id: 'h3', temperature: 'hot', status: 'lost', created_at: '2026-10-20T05:00:00Z' },
      { id: 'won1', temperature: 'hot', status: 'won', created_at: '2026-10-01T05:00:00Z' },
      { id: 'p1', temperature: 'warm', status: 'proposal', deal_value: 85000, created_at: '2026-10-21T05:00:00Z' },
      { id: 'p2', temperature: 'cold', status: 'contacted', call_stage: 'proposal_sent', deal_value: 850000, created_at: '2026-10-28T05:00:00Z' },
    ];
  `);
  const dnow = 'new Date("2026-11-02T06:00:00Z")';
  assert.deepEqual(Array.from(run(`App.getDashboardHotLeads(${dnow}).map(h => h.lead.id)`)), ['h2', 'h1']);
  assert.deepEqual(Array.from(run('App.getOpenProposals().map(l => l.id)')), ['p2', 'p1']);
  assert.equal(run(`App.getLeadFlowStep({ status: 'proposal' })`), 'qualified');
  assert.deepEqual(JSON.parse(run('JSON.stringify(App.getInvoiceRows().map(r => [r.name, r.amount, r.billed]))')),
    [['UAT', 50000, true], ['Go-live', 25000, false], ['AMC', 5000, false]]);
  const heat = JSON.parse(run(`JSON.stringify(App.getWeeklyLeadHeat(2, ${dnow}))`));
  // 26 Oct 20:00 UTC is 27 Oct IST, so h2 falls in the week of 26 Oct, not 19 Oct.
  assert.deepEqual(heat, [{ start: '2026-10-26', hot: 2, warm: 0, cold: 1 }, { start: '2026-11-02', hot: 0, warm: 0, cold: 0 }]);
  run(`App.state.currentView = 'dashboard'; App.state.users = [];`);
  run('App.renderDashboardView()');
  assert.match(page.innerHTML, /Invoiced, unpaid/);
  assert.match(page.innerHTML, /₹50K/);
  assert.match(page.innerHTML, /25% of ₹1L won/);
  assert.match(page.innerHTML, /<table class="sr-only">/);

  // Notes holding a binary file decoded as text render as a file reference; normal notes are unchanged.
  const pdfNote = 'Zero7 Team Transcript Document (NumberTree_LLP_AI_Audit_Platform_Proposal.pdf)\nCaption: %PDF-1.4\n%���� 1 0 obj <</Title (x)>> endobj stream x�\u0001\u0002';
  const info = JSON.parse(run(`JSON.stringify(App.getBinaryNoteInfo(${JSON.stringify(pdfNote)}))`));
  assert.deepEqual(info, { title: 'Zero7 Team Transcript Document', fileName: 'NumberTree_LLP_AI_Audit_Platform_Proposal.pdf', caption: '', kind: 'PDF' });
  const pdfHtml = run(`App.renderActivityNotes(${JSON.stringify(pdfNote)})`);
  assert.match(pdfHtml, /NumberTree_LLP_AI_Audit_Platform_Proposal\.pdf/);
  assert.doesNotMatch(pdfHtml, /endobj|%PDF|�/);
  const captioned = 'Doc (spec.pdf)\nCaption: Final scope\n%PDF-1.7 ��';
  assert.equal(JSON.parse(run(`JSON.stringify(App.getBinaryNoteInfo(${JSON.stringify(captioned)}))`)).caption, 'Final scope');
  for (const normal of ['Zero7 Team Note: मयंक ट्रूमन 25,000 वाला प्रोजेक्ट है', 'Call back after 5 <b>', 'x'.repeat(500)]) {
    assert.equal(run(`App.getBinaryNoteInfo(${JSON.stringify(normal)})`), null);
  }
  assert.match(run(`App.renderActivityNotes('Call back after 5 <b>')`), /Call back after 5 &lt;b&gt;/);

  console.log('PASS: binary note rendering; dashboard (hot urgency, proposals, invoices, IST weeks, render); IST parsing, AI-text exclusion, buckets, calling-hour presets, due count, due cell, bulk-AI restore, regenerate guard, call-log completion and prompt, outcome flow, retry cadence, lead flow, placeholder next step, form labels, pager');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
