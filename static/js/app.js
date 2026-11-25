/**
 * Zero7 Consultancy — Minimal Clinical CRM
 * Complete SPA with Collapsible Sidebar, Full Record Pages, and Integrations Hub
 */

const App = {
  state: {
    currentUser: null,
    token: localStorage.getItem('zero7_token'),
    currentView: 'leads', // 'leads' | 'lead_detail' | 'deals' | 'deal_detail' | 'integrations'
    sidebarExpanded: localStorage.getItem('zero7_sidebar_expanded') === null
      ? (window.matchMedia?.('(min-width: 761px)')?.matches ?? true)
      : localStorage.getItem('zero7_sidebar_expanded') === 'true',
    leads: [],
    deals: [],
    users: [],
    integrationsStatus: null,
    filters: { status: '', source: '', assigned_to: '', temperature: '', call_stage: '', priority: '', search: '' },
    visibleColumns: [],
    selectedLeadId: null,
    selectedDealId: null,
    selectedLead: null,
    selectedDeal: null,
    activeLeadTab: 'details',
    theme: localStorage.getItem('zero7_theme') || 'light',
    scheduleData: null,
    scheduleTab: 'all',
    completedScheduleIds: JSON.parse(localStorage.getItem('zero7_completed_schedule_' + new Date().toISOString().slice(0, 10)) || '[]'),
  },

  async init() {
    this.state.visibleColumns = this.loadLeadColumnPreferences();
    this.initTheme();
    this.setupEventListeners();

    if (this.state.token) {
      try {
        this.state.currentUser = await API.get('/api/auth/me');
        await this.loadInitialData();
        await this.handleRoute();

        // Start real-time action queue monitor
        this.checkPendingActionsCount();
        setInterval(() => this.checkPendingActionsCount(), 15000);
        this.startFollowUpMonitor();
      } catch (e) {
        console.warn('Session expired or unauthorized, rendering login');
        this.state.token = null;
        this.state.currentUser = null;
        localStorage.removeItem('zero7_token');
        this.renderLogin();
      }
    } else {
      this.renderLogin();
    }
  },

  setupEventListeners() {
    window.addEventListener('hashchange', () => {
      this.handleRoute();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        this.closeWorkspaceDropdown();
      }
      // J / K step to the next / previous lead while a lead record is open.
      if ((e.key === 'j' || e.key === 'k') && this.state.currentView === 'lead_detail' && !e.ctrlKey && !e.metaKey && !e.altKey
          && !e.target.closest?.('input, textarea, select, [contenteditable="true"]') && !document.querySelector('.modal-backdrop, .modal-overlay')) {
        this.stepLead(e.key === 'j' ? 1 : -1);
      }
    });

    document.addEventListener('click', (e) => {
      if (e.target.matches('.modal-backdrop')) {
        this.closeModal();
      }
      if (!e.target.closest('#workspace-dropdown-container')) {
        this.closeWorkspaceDropdown();
      }
    });
  },

  initTheme() {
    const saved = localStorage.getItem('zero7_theme') || 'light';
    this.state.theme = saved;
    document.documentElement.setAttribute('data-theme', saved);
    document.documentElement.style.colorScheme = saved;
  },

  toggleTheme() {
    const nextTheme = this.state.theme === 'dark' ? 'light' : 'dark';
    this.state.theme = nextTheme;
    localStorage.setItem('zero7_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    document.documentElement.style.colorScheme = nextTheme;

    const iconSpan = document.getElementById('theme-toggle-icon');
    const textSpan = document.getElementById('theme-toggle-text');
    const btn = document.getElementById('theme-toggle-btn');
    if (iconSpan) {
      iconSpan.innerHTML = nextTheme === 'dark' ? Icons.sun(18) : Icons.moon(18);
    }
    if (textSpan) {
      textSpan.textContent = nextTheme === 'dark' ? 'Light Mode' : 'Dark Mode';
    }
    if (btn) {
      btn.title = nextTheme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme';
    }
    API.showToast(`Switched to ${nextTheme === 'dark' ? 'Zinc Dark' : 'Zinc Light'} theme`, 'info');
  },

  async loadInitialData() {
    try {
      const [leads, deals, users] = await Promise.all([
        API.get('/api/leads'),
        API.get('/api/deals'),
        API.get('/api/users')
      ]);
      this.state.leads = leads || [];
      this.state.deals = deals || [];
      this.state.users = users || [];
    } catch (e) {
      console.error('Failed to load initial data:', e);
    }
  },

  async syncSheetPriorities() {
    try {
      API.showToast('Syncing latest Meta leads & priorities from Google Sheet...', 'info');
      const res = await API.post('/api/integrations/google-sheets/sync-priorities');
      API.showToast(res.message || 'Successfully synced from Google Sheet!', 'success');
      await this.loadInitialData();
      if (this.state.currentView === 'leads') {
        this.renderLeadsView();
      } else if (this.state.currentView === 'lead_detail' && this.state.selectedLeadId) {
        await this.viewLead(this.state.selectedLeadId);
      } else {
        this.render();
      }
    } catch (err) {
      console.error('Sheet sync error:', err);
      API.showToast('Failed to sync from Google Sheet', 'error');
    }
  },

  renderColumnOrderStrip() {
    const cols = this.state.visibleColumns || [];
    return cols.map((id, idx) => {
      const def = this.columnDefinitions.find(c => c.id === id);
      if (!def) return '';
      return `
        <div class="column-order-chip${def.fixed ? ' is-fixed' : ''}" data-col-id="${id}" draggable="true"
             ondragstart="App.handleColumnDragStart(event, '${id}')"
             ondragover="App.handleColumnDragOver(event, '${id}')"
             ondragleave="App.handleColumnDragLeave(event)"
             ondrop="App.handleColumnDrop(event, '${id}')"
             ondragend="App.handleColumnDragEnd(event)">
          <span class="column-drag-grip" title="Drag to reposition">⋮⋮</span>
          <span class="column-order-label">${this.escapeHtml(def.label)}</span>
          <span class="column-order-actions">
            <button type="button" class="column-move-btn" ${idx === 0 ? 'disabled' : ''} onclick="App.moveLeadColumn('${id}', -1)" title="Move left" aria-label="Move ${this.escapeHtml(def.label)} left">${Icons.chevronLeft(12)}</button>
            <button type="button" class="column-move-btn" ${idx === cols.length - 1 ? 'disabled' : ''} onclick="App.moveLeadColumn('${id}', 1)" title="Move right" aria-label="Move ${this.escapeHtml(def.label)} right">${Icons.chevronRight(12)}</button>
            ${!def.fixed ? `<button type="button" class="column-move-btn is-remove" onclick="App.toggleColumn('${id}', false)" title="Hide column" aria-label="Hide ${this.escapeHtml(def.label)}">${Icons.close(11)}</button>` : ''}
          </span>
        </div>
      `;
    }).join('');
  },

  saveLeadColumnOrder(columns) {
    const valid = new Set(this.columnDefinitions.map(c => c.id));
    let clean = [...new Set((columns || []).filter(id => valid.has(id)))];
    if (!clean.includes('contact')) clean.unshift('contact');
    this.state.visibleColumns = clean;
    try {
      localStorage.setItem('zero7_lead_columns', JSON.stringify(clean));
      localStorage.setItem('zero7_lead_columns_version', '2');
    } catch (_) { /* Storage unavailable */ }

    const strip = document.getElementById?.('column-order-strip');
    if (strip) strip.innerHTML = this.renderColumnOrderStrip();
    const grid = document.getElementById?.('column-settings-grid');
    if (grid) {
      const activeSet = new Set(clean);
      grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (!cb.disabled) cb.checked = activeSet.has(cb.value);
      });
    }

    if (this.state.currentView === 'schedule') {
      this.renderScheduleView();
    } else if (this.state.currentView === 'leads') {
      this.renderLeadsView();
    }
  },

  moveLeadColumn(colId, delta) {
    const cols = [...(this.state.visibleColumns || [])];
    const idx = cols.indexOf(colId);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= cols.length) return;
    const [moved] = cols.splice(idx, 1);
    cols.splice(nextIdx, 0, moved);
    this.saveLeadColumnOrder(cols);
  },

  reorderLeadColumns(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const cols = [...(this.state.visibleColumns || [])];
    const fromIdx = cols.indexOf(fromId);
    const toIdx = cols.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = cols.splice(fromIdx, 1);
    cols.splice(toIdx, 0, moved);
    this.saveLeadColumnOrder(cols);
  },

  handleColumnDragStart(event, colId) {
    this._draggedColumnId = colId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', colId);
    }
    event.currentTarget?.classList.add('is-dragging');
  },

  handleColumnDragOver(event, colId) {
    if (!this._draggedColumnId || this._draggedColumnId === colId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    event.currentTarget?.classList.add('is-drag-over');
  },

  handleColumnDragLeave(event) {
    event.currentTarget?.classList.remove('is-drag-over');
  },

  handleColumnDrop(event, targetColId) {
    event.preventDefault();
    event.currentTarget?.classList.remove('is-drag-over');
    const sourceColId = this._draggedColumnId || event.dataTransfer?.getData('text/plain');
    this._draggedColumnId = null;
    if (sourceColId && targetColId && sourceColId !== targetColId) {
      this.reorderLeadColumns(sourceColId, targetColId);
    }
  },

  handleColumnDragEnd() {
    this._draggedColumnId = null;
    document.querySelectorAll('.is-dragging, .is-drag-over').forEach(el => {
      el.classList.remove('is-dragging', 'is-drag-over');
    });
  },

  openColumnSettingsModal() {
    const cols = this.columnDefinitions;
    const current = new Set(this.state.visibleColumns || []);

    const html = `
      <div class="modal-header">
        <h3 style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          ${Icons.settings(16)} Customize &amp; Reorder Dashboard Columns
        </h3>
        <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
      </div>
      <div class="modal-body">
        <div class="column-order-section">
          <div class="column-order-title">Column Order <span style="font-weight: 400; color: var(--color-mid-gray);">&mdash; drag chips or click arrows (Name can move after Company)</span></div>
          <div id="column-order-strip" class="column-order-strip">
            ${this.renderColumnOrderStrip()}
          </div>
        </div>
        <p style="font-size: 12.5px; color: var(--color-mid-gray); margin: 14px 0 10px;">
          Toggle visible columns on your Leads dashboard. Preferences and column positions are saved automatically.
        </p>
        <div id="column-settings-grid" class="column-settings-grid">
          ${cols.map(c => `
            <label class="column-settings-option${c.fixed ? ' is-fixed' : ''}">
              <input type="checkbox" 
                     value="${c.id}" 
                     ${current.has(c.id) ? 'checked' : ''} 
                     ${c.fixed ? 'disabled checked' : ''}
                     onchange="App.toggleColumn('${c.id}', this.checked)"
              >
              <span>${c.label}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="App.resetDefaultColumns()">
          Reset to Defaults
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="App.closeModal()">
          Done
        </button>
      </div>
    `;
    this.openModal(html, { size: 'lg' });
  },

  toggleColumn(colId, isChecked) {
    if (colId === 'contact' && !isChecked) return;
    let current = [...(this.state.visibleColumns || [])];
    if (isChecked) {
      if (!current.includes(colId)) current.push(colId);
    } else {
      current = current.filter(id => id !== colId);
    }
    this.saveLeadColumnOrder(current);
  },

  resetDefaultColumns() {
    const defaults = this.getDefaultLeadColumns();
    this.saveLeadColumnOrder(defaults);
    this.closeModal();
    API.showToast('Columns reset to default', 'info');
  },

  async saveInlineNote(leadId, inputEl) {
    if (!inputEl) return;
    const text = (inputEl.value || '').trim();
    if (!text) return;

    try {
      await API.post(`/api/leads/${leadId}/notes`, { content: text });
      const lead = (this.state.leads || []).find(l => l.id === leadId);
      if (lead) {
        lead.last_update_notes = text;
      }
      inputEl.value = '';
      inputEl.placeholder = text.substring(0, 20) + '...';
      inputEl.title = text;
      API.showToast('Note saved to lead', 'success');
    } catch (err) {
      console.error('Failed to save inline note:', err);
      API.showToast('Error saving note', 'error');
    }
  },

  async handleInlineUpload(event, leadId) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (file.size > 200 * 1024 * 1024) {
      API.showToast('File too large. Max 200MB.', 'error');
      event.target.value = '';
      return;
    }

    const btn = document.getElementById(`inline-upload-btn-${leadId}`);
    if (btn) {
      btn.innerHTML = `${Icons.loader(13)} Uploading...`;
      btn.disabled = true;
    }

    try {
      const fd = new FormData();
      fd.append('outcome', 'Connected');
      fd.append('notes', `Attached media: ${file.name}`);
      fd.append('duration_minutes', '5');
      fd.append('recording', file);

      const token = localStorage.getItem('zero7_token');
      const res = await fetch(`/api/leads/${leadId}/calls`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });

      if (!res.ok) throw new Error('Upload failed');

      API.showToast('Recording uploaded to lead!', 'success');
      if (btn) {
        btn.innerHTML = `${Icons.check(13)} Done`;
        setTimeout(() => {
          btn.innerHTML = `${Icons.paperclip(13)} Upload`;
          btn.disabled = false;
        }, 2500);
      }
    } catch (err) {
      console.error('Inline upload error:', err);
      API.showToast('Failed to upload recording', 'error');
      if (btn) {
        btn.innerHTML = `${Icons.paperclip(13)} Upload`;
        btn.disabled = false;
      }
    }
  },

  async generateLeadTask(leadId) {
    const scheduledLead = this.findLead(leadId);
    const scheduledCall = scheduledLead && this.getScheduledCall(scheduledLead);
    if (scheduledCall && !confirm(`${scheduledLead.name || 'This lead'} has a call scheduled for ${this.formatCallTime(scheduledCall.at)}. Replace it with an AI-generated task?`)) {
      return;
    }
    try {
      API.showToast('Generating AI next task...', 'info');
      const updated = await API.post(`/api/leads/${leadId}/generate-task`);
      if (updated) {
        const idx = (this.state.leads || []).findIndex(l => l.id === leadId);
        if (idx !== -1) {
          this.state.leads[idx] = updated;
        }
        if (this.state.selectedLead && this.state.selectedLead.id === leadId) {
          this.state.selectedLead = updated;
        }
        if (this.state.currentView === 'leads') {
          this.renderLeadsTableBody();
        } else if (this.state.currentView === 'lead_detail') {
          this.renderLeadDetailPage();
        }
        API.showToast(`Task: "${updated.next_action}" (${updated.next_action_date})`, 'success');
      }
    } catch (err) {
      console.error('Failed to generate task:', err);
      API.showToast('Error generating AI task', 'error');
    }
  },

  async generateAllTasks() {
    // The bulk AI run rewrites every lead's next action; put human-scheduled calls back afterwards.
    const scheduled = this.getScheduledCalls().map(({ lead }) => ({
      id: lead.id, next_action: lead.next_action, next_action_date: lead.next_action_date
    }));
    try {
      API.showToast('AI analyzing all leads and scheduling next tasks...', 'info');
      const res = await API.post('/api/leads/generate-all-tasks');
      await Promise.all(scheduled.map(({ id, ...fields }) => API.put(`/api/leads/${id}`, fields).catch(() => null)));
      await this.loadInitialData();
      if (this.state.currentView === 'leads') {
        this.renderLeadsView();
      }
      API.showToast(res.message || 'AI next tasks generated for all leads!', 'success');
    } catch (err) {
      console.error('Failed to generate all tasks:', err);
      API.showToast('Error generating AI tasks', 'error');
    }
  },

  // ---------------- SCHEDULED CALLS (FOLLOW-UPS) ----------------
  // A scheduled call lives in the lead's next_action / next_action_date fields.
  // next_action_date holds an IST timestamp ("2026-11-03T11:00:00+05:30"); AI tasks use
  // free text ("Today, 5 PM"), so the timestamp format is what marks a scheduled call.

  CALL_HOURS: { start: '09:00', end: '21:00' },

  findLead(leadId) {
    if (this.state.selectedLead && this.state.selectedLead.id === leadId) return this.state.selectedLead;
    return (this.state.leads || []).find(l => l.id === leadId) || null;
  },

  getScheduledCall(lead) {
    const raw = String(lead?.next_action_date || '').trim();
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (!m) return null;
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(raw);
    const at = new Date(hasZone ? raw.replace(' ', 'T') : `${m[1]}T${m[2]}:00+05:30`);
    if (isNaN(at.getTime())) return null;
    const ist = this.istParts(at);
    const purpose = String(lead.next_action || '').replace(/^Call:\s*/i, '').trim();
    return { at, date: ist.date, time: ist.time, purpose };
  },

  istParts(d = new Date()) {
    const iso = new Date(d.getTime() + 330 * 60000).toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  },

  shiftIstDate(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  },

  getCallBucket(call, now = new Date()) {
    if (call.at < now) return 'overdue';
    const today = this.istParts(now).date;
    if (call.date === today) return 'today';
    if (call.date === this.shiftIstDate(today, 1)) return 'tomorrow';
    if (call.date <= this.shiftIstDate(today, 7)) return 'week';
    return 'later';
  },

  formatCallTime(at, withDay = true) {
    return at.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      ...(withDay ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  },

  formatCallDue(call, now = new Date()) {
    const mins = Math.round((call.at - now) / 60000);
    const abs = Math.abs(mins);
    if (abs < 1) return 'now';
    const span = abs < 60 ? `${abs}m` : abs < 1440 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
    return mins < 0 ? `${span} overdue` : `in ${span}`;
  },

  getScheduledCalls() {
    return (this.state.leads || [])
      .map(lead => ({ lead, call: this.getScheduledCall(lead) }))
      .filter(item => item.call)
      .sort((a, b) => a.call.at - b.call.at);
  },

  getDueCallCount() {
    const now = new Date();
    return this.getScheduledCalls().filter(({ call }) => ['overdue', 'today'].includes(this.getCallBucket(call, now))).length;
  },

  getCallPreset(preset) {
    const today = this.istParts().date;
    const standard = (days) => ({ date: this.shiftIstDate(today, days), time: '11:00' });
    if (preset === '1h') {
      const t = new Date(Date.now() + 60 * 60000);
      t.setUTCMinutes(Math.ceil(t.getUTCMinutes() / 15) * 15, 0, 0);
      const p = this.istParts(t);
      if (p.date !== today || p.time > this.CALL_HOURS.end) return standard(1);
      return p.time < this.CALL_HOURS.start ? { date: today, time: this.CALL_HOURS.start } : p;
    }
    if (preset === 'tomorrow') return standard(1);
    if (preset === '2d') return standard(2);
    if (preset === '1w') return standard(7);
    if (preset === 'monday') {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
      return standard(((8 - dow) % 7) || 7);
    }
    return null;
  },

  applyCallPreset(form, preset) {
    const value = this.getCallPreset(preset);
    if (!form || !value) return;
    form.elements.date.value = value.date;
    form.elements.time.value = value.time;
    form.querySelectorAll('[data-preset]').forEach(btn => btn.classList.toggle('selected', btn.dataset.preset === preset));
  },

  renderScheduleCallForm(lead, call = null, inModal = false) {
    const presets = [['1h', 'In 1 hour'], ['tomorrow', 'Tomorrow'], ['2d', 'In 2 days'], ['monday', 'Next Mon'], ['1w', 'In 1 week']];
    const cancel = inModal ? 'App.closeModal()' : `App.toggleNextCallEditor('${lead.id}', false)`;
    return `
      <form class="next-call-form" id="${inModal ? 'modal-' : ''}next-call-form-${lead.id}" onsubmit="App.handleScheduleCall(event, '${lead.id}')">
        <div class="next-call-presets">
          ${presets.map(([id, label]) => `<button type="button" class="outcome-pill" data-preset="${id}" onclick="App.applyCallPreset(this.form, '${id}')">${label}</button>`).join('')}
        </div>
        <div class="next-call-fields">
          <input type="date" name="date" class="input" min="${this.istParts().date}" value="${call ? call.date : ''}" required aria-label="Call date">
          <input type="time" name="time" class="input" min="${this.CALL_HOURS.start}" max="${this.CALL_HOURS.end}" value="${call ? call.time : '11:00'}" required aria-label="Call time (IST)">
        </div>
        <input type="text" name="purpose" class="input" maxlength="120" placeholder="Purpose, e.g. Discuss quotation" value="${this.escapeHtml(call?.purpose || '')}">
        <div class="next-call-actions">
          <span class="next-call-hint">IST &middot; calling hours 9 am – 9 pm</span>
          ${call || inModal ? `<button type="button" class="btn btn-ghost btn-sm" onclick="${cancel}">Cancel</button>` : ''}
          <button type="submit" class="btn btn-primary btn-sm">${Icons.calendar(13)} ${call ? 'Reschedule' : 'Schedule call'}</button>
        </div>
      </form>`;
  },

  renderNextCallCard(lead) {
    const call = this.getScheduledCall(lead);
    const editing = this._nextCallEditing === lead.id;
    const bucket = call ? this.getCallBucket(call) : '';
    const labels = { overdue: 'Overdue', today: 'Due today', tomorrow: 'Tomorrow', week: 'This week', later: 'Upcoming' };
    const phone = String(lead.phone || '').replace(/[^0-9+]/g, '');
    return `
      <div class="record-card next-call-card ${bucket ? `bucket-${bucket}` : ''}" id="next-call-card-${lead.id}">
        <div class="record-section-title">${Icons.calendar(14)} Next call</div>
        ${call && !editing ? `
          <div class="next-call-summary">
            <div class="next-call-when">
              <span class="next-call-status">${labels[bucket]}</span>
              <strong>${this.formatCallTime(call.at)}</strong>
              <span class="next-call-due">${this.formatCallDue(call)}</span>
            </div>
            ${call.purpose ? `<p class="next-call-purpose">${this.escapeHtml(call.purpose)}</p>` : ''}
            <div class="next-call-actions">
              ${phone ? `<a class="btn btn-secondary btn-sm" href="tel:${phone}">${Icons.phone(13)} Call now</a>` : ''}
              <button type="button" class="btn btn-ghost btn-sm" onclick="App.toggleNextCallEditor('${lead.id}', true)">Reschedule</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="App.cancelScheduledCall('${lead.id}')">Cancel call</button>
              <button type="button" class="btn btn-primary btn-sm" onclick="App.completeScheduledCall('${lead.id}')">${Icons.check(13)} Done</button>
            </div>
          </div>` : this.renderScheduleCallForm(lead, call)}
      </div>`;
  },

  refreshNextCallCard(leadId) {
    const card = document.getElementById(`next-call-card-${leadId}`);
    const lead = this.findLead(leadId);
    if (card && lead) card.outerHTML = this.renderNextCallCard(lead);
  },

  toggleNextCallEditor(leadId, editing) {
    this._nextCallEditing = editing ? leadId : null;
    this.refreshNextCallCard(leadId);
  },

  openScheduleCallModal(leadId) {
    const lead = this.findLead(leadId);
    if (!lead) return;
    const call = this.getScheduledCall(lead);
    this.openModal(`
      <div class="modal-header">
        <h3 style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          ${Icons.calendar(16)} ${call ? 'Reschedule call' : 'Schedule call'} &middot; ${this.escapeHtml(lead.name || 'Lead')}
        </h3>
        <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
      </div>
      <div class="modal-body">${this.renderScheduleCallForm(lead, call, true)}</div>
    `);
  },

  applyLeadUpdate(updated) {
    if (!updated || !updated.id) return;
    const idx = (this.state.leads || []).findIndex(l => l.id === updated.id);
    if (idx !== -1) this.state.leads[idx] = { ...this.state.leads[idx], ...updated };
    if (this.state.selectedLead && this.state.selectedLead.id === updated.id) {
      Object.assign(this.state.selectedLead, updated);
    }
  },

  afterScheduledCallChange(leadId) {
    if (this.state.currentView === 'lead_detail' && this.state.selectedLeadId === leadId) {
      this.refreshNextCallCard(leadId);
      const flowBar = document.querySelector('.record-header-strip > .lead-flow-bar');
      const lead = this.findLead(leadId);
      if (flowBar && lead) flowBar.outerHTML = this.renderLeadFlow(lead, this.hasDeal(lead));
    } else if (this.state.currentView === 'followups') {
      this.renderFollowUpsView();
    } else if (this.state.currentView === 'leads') {
      this.renderLeadsTableBody();
    }
    this.updateFollowUpBadge();
  },

  async handleScheduleCall(e, leadId) {
    e.preventDefault();
    const form = e.target;
    const date = form.elements.date.value;
    const time = form.elements.time.value;
    const purpose = form.elements.purpose.value.trim() || 'Follow-up call';
    if (!date || !time) return;
    if (time < this.CALL_HOURS.start || time > this.CALL_HOURS.end) {
      API.showToast('Schedule calls between 9 am and 9 pm IST (TRAI calling hours)', 'error');
      return;
    }
    const at = new Date(`${date}T${time}:00+05:30`);
    if (at.getTime() < Date.now() - 60000) {
      API.showToast('Pick a time in the future', 'error');
      return;
    }
    const lead = this.findLead(leadId);
    const rescheduling = !!(lead && this.getScheduledCall(lead));
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const updated = await API.put(`/api/leads/${leadId}`, {
        next_action: `Call: ${purpose}`,
        next_action_date: `${date}T${time}:00+05:30`
      });
      const when = this.formatCallTime(at);
      await API.post(`/api/leads/${leadId}/notes`, {
        content: `${rescheduling ? 'Call rescheduled' : 'Call scheduled'} for ${when} IST: ${purpose}`
      }).catch(() => null);
      this._nextCallEditing = null;
      this.applyLeadUpdate(updated);
      if (form.closest('.modal')) this.closeModal();
      this.afterScheduledCallChange(leadId);
      this.requestCallNotifications();
      API.showToast(`Call scheduled for ${when}`, 'success');
    } catch (err) {
      console.error('Failed to schedule call:', err);
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async clearScheduledCall(leadId, noteText) {
    const updated = await API.put(`/api/leads/${leadId}`, { next_action: '', next_action_date: '' });
    if (noteText) {
      await API.post(`/api/leads/${leadId}/notes`, { content: noteText }).catch(() => null);
    }
    this.applyLeadUpdate(updated);
    this.afterScheduledCallChange(leadId);
  },

  async completeScheduledCall(leadId) {
    const lead = this.findLead(leadId);
    const call = lead && this.getScheduledCall(lead);
    if (!call) return;
    try {
      await this.clearScheduledCall(leadId, `Scheduled call for ${this.formatCallTime(call.at)} IST marked done: ${call.purpose}`);
      API.showToast('Call marked done. Schedule the next one when it is agreed.', 'success');
    } catch (err) {
      console.error('Failed to complete scheduled call:', err);
    }
  },

  async cancelScheduledCall(leadId) {
    const lead = this.findLead(leadId);
    const call = lead && this.getScheduledCall(lead);
    if (!call || !confirm(`Cancel the call scheduled for ${this.formatCallTime(call.at)}?`)) return;
    try {
      await this.clearScheduledCall(leadId, `Scheduled call for ${this.formatCallTime(call.at)} IST cancelled`);
      API.showToast('Scheduled call cancelled', 'info');
    } catch (err) {
      console.error('Failed to cancel scheduled call:', err);
    }
  },

  promptNextCall(leadId, preset, purpose = '', message = 'Set the next call so this follow-up is not missed', autoSave = false) {
    const form = document.getElementById(`next-call-form-${leadId}`);
    const card = document.getElementById(`next-call-card-${leadId}`);
    if (!form || !card) return;
    this.applyCallPreset(form, preset);
    if (purpose && !form.elements.purpose.value) form.elements.purpose.value = purpose;
    if (autoSave && form.requestSubmit) {
      form.requestSubmit();
      API.showToast(message, 'info');
      return;
    }
    card.classList.add('is-prompted');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    API.showToast(message, 'info');
  },

  // ==========================================
  // LEAD FLOW (New → Attempting → Connected → Qualified → Deal, or Lost)
  // ==========================================
  // Call outcomes are mutually exclusive; each one moves the lead along the flow and says what happens next.
  CALL_OUTCOMES: {
    'DNP': { label: 'No answer', connected: false, stage: 'dnp', status: 'contacted', next: 'retry', hint: 'Counts as a call attempt. The next try is suggested for you.' },
    'Call Back': { label: 'Busy · call later', connected: false, stage: 'follow_up', status: 'contacted', next: 'tomorrow', purpose: 'Call back as requested', hint: 'Set the time they asked you to call back.' },
    'Connected': { label: 'Spoke · follow up', connected: true, stage: 'connected', status: 'contacted', next: 'tomorrow', hint: 'Write what was discussed, then set the next call.' },
    'Interested': { label: 'Interested', connected: true, stage: 'interested', status: 'qualified', next: '2d', hint: 'Marks the lead qualified. Set the next step.' },
    'Meeting Booked': { label: 'Meeting booked', connected: true, stage: 'interested', status: 'qualified', next: 'tomorrow', purpose: 'Meeting', hint: 'Marks the lead qualified. Set the meeting date and time.' },
    'Not Interested': { label: 'Not interested', connected: true, stage: 'not_interested', status: 'lost', next: null, hint: 'Closes the lead as lost and cancels any scheduled call.' },
  },

  LEAD_FLOW_STEPS: [['new', 'New'], ['attempting', 'Attempting'], ['connected', 'Connected'], ['qualified', 'Qualified'], ['deal', 'Deal']],

  // Consecutive unanswered calls since the last conversation.
  getCallAttempts(lead) {
    const calls = (lead?.activity || []).filter(a => a.type === 'call')
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    let attempts = 0;
    for (const call of calls) {
      if (!/^(dnp|no answer|call back)$/i.test(String(call.outcome || '').trim())) break;
      attempts++;
    }
    return attempts;
  },

  // Retry cadence after an unanswered call: 1 hour, next day, 2 days, then weekly.
  getRetryPreset(attempt) {
    return attempt <= 1 ? '1h' : attempt === 2 ? 'tomorrow' : attempt === 3 ? '2d' : '1w';
  },

  // Status moves only forward (or to lost, never off won); temperature follows clear intent signals.
  getFlowUpdate(lead, flow) {
    const update = {};
    const rank = { new: 0, contacted: 1, qualified: 2 };
    const currentStatus = String(lead?.status || 'new').toLowerCase();
    const nextStatus = flow.status === 'lost'
      ? (currentStatus === 'won' ? null : 'lost')
      : ((rank[currentStatus] ?? 3) < rank[flow.status] ? flow.status : null);
    if (nextStatus && nextStatus !== currentStatus) update.status = nextStatus;
    const temperature = flow.stage === 'interested' ? 'hot' : flow.stage === 'not_interested' ? 'cold' : null;
    if (temperature && String(lead?.temperature || '').toLowerCase() !== temperature && currentStatus !== 'won') update.temperature = temperature;
    return update;
  },

  getLeadFlowStep(lead, hasDeal = false) {
    const stage = String(lead?.call_stage || '').toLowerCase();
    const status = String(lead?.status || '').toLowerCase();
    if (hasDeal || status === 'won') return 'deal';
    if (status === 'lost' || stage === 'not_interested') return 'lost';
    if (['qualified', 'proposal'].includes(status) || ['interested', 'qualified', 'proposal_sent', 'negotiation'].includes(stage)) return 'qualified';
    if (['connected', 'follow_up', 'first_call'].includes(stage)) return 'connected';
    if (stage === 'dnp' || status === 'contacted') return 'attempting';
    return 'new';
  },

  // The seeded "Speed to lead call (< 5 mins)" text is a placeholder, not a task someone set.
  isPlaceholderAction(lead) {
    return /^speed to lead/i.test(String(lead?.next_action || '').trim());
  },

  getLeadNextStep(lead, now = new Date()) {
    const call = this.getScheduledCall(lead);
    if (call) return { text: `${call.purpose || 'Call'} · ${this.formatCallTime(call.at)}`, tone: this.getCallBucket(call, now) };
    const step = this.getLeadFlowStep(lead);
    if (['lost', 'deal'].includes(step)) return { text: lead.next_action || '', tone: 'muted' };
    if (step === 'new') {
      if (lead.next_action && !this.isPlaceholderAction(lead)) {
        return { text: lead.next_action, tone: 'muted' };
      }
      const created = new Date(this._normalizeIso(lead.created_at) || now);
      const mins = Math.max(0, Math.round((now - created) / 60000)) || 0;
      const waited = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
      return { text: `First call · waiting ${waited}`, tone: mins > 5 ? 'overdue' : 'today' };
    }
    if (this.isPlaceholderAction(lead) || !lead.next_action) return { text: 'Set next step', tone: 'unscheduled' };
    return { text: lead.next_action, tone: 'muted' };
  },

  renderLeadFlow(lead, hasDeal = false) {
    const step = this.getLeadFlowStep(lead, hasDeal);
    const order = this.LEAD_FLOW_STEPS.map(([id]) => id);
    const current = step === 'lost' ? -1 : order.indexOf(step);
    const attempts = this.getCallAttempts(lead);
    const next = this.getLeadNextStep(lead);
    return `
      <div class="lead-flow-bar">
        <ol class="lead-flow ${step === 'lost' ? 'is-lost' : ''}" aria-label="Lead stage">
          ${this.LEAD_FLOW_STEPS.map(([id, label], i) => `
            <li class="${i < current ? 'is-done' : i === current ? 'is-current' : ''}" ${i === current ? 'aria-current="step"' : ''}>
              ${this.escapeHtml(label)}${id === 'attempting' && attempts ? ` <span class="lead-flow-count">${attempts}</span>` : ''}
            </li>`).join('')}
          ${step === 'lost' ? '<li class="is-current is-lost-step" aria-current="step">Lost</li>' : ''}
        </ol>
        ${next.text ? `<span class="lead-flow-next tone-${next.tone}" title="Next step: ${this.escapeHtml(next.text)}">${Icons.arrowRight(12)} <span>${this.escapeHtml(next.text)}</span></span>` : ''}
      </div>`;
  },

  // Meta keeps a form field's original key when its question is edited, so label by the answers actually given.
  formatFormQuestion(question, answer) {
    const raw = String(question || 'Question').trim();
    const employeeBand = /^(just_me|\d+\s*-\s*\d+$|\d+\+$)/i.test(String(answer ?? '').trim());
    if (employeeBand && /monthly_revenue|employee|how_many/i.test(raw)) return 'How many employees work in your company?';
    if (!raw.includes('_')) return raw;
    const text = raw.replace(/_/g, ' ').replace(/\s+([?,])/g, '$1').replace(/\s+/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  },

  formatFormAnswer(answer) {
    const raw = String(answer ?? '').trim();
    if (!raw) return '—';
    if (/^just_me_?\(1\)$/i.test(raw)) return 'Just me (1)';
    if (/^\d+\s*-\s*\d+$/.test(raw)) return raw.replace(/\s*-\s*/, '–');
    if (/^[a-z][a-z_]*$/.test(raw)) {
      const text = raw.replace(/_/g, ' ');
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    return raw;
  },

  // Prev/next through the list a lead was opened from; falls back to the Leads table order.
  getLeadNavContextIds() {
    if (this.state.currentView === 'leads') return this.getFilteredLeads().map(l => l.id);
    if (this.state.currentView === 'followups') {
      return (this.state.followUpsTab === 'needing')
        ? this.getLeadsNeedingNextCall().map(l => l.id)
        : this.getScheduledCalls().map(item => item.lead.id);
    }
    return null;
  },

  getLeadNavList() {
    const ids = this.state.leadNavIds;
    return Array.isArray(ids) && ids.includes(this.state.selectedLeadId) ? ids : this.getFilteredLeads().map(l => l.id);
  },

  renderLeadPager() {
    const ids = this.getLeadNavList();
    const i = ids.indexOf(this.state.selectedLeadId);
    if (i < 0 || ids.length < 2) return '';
    return `
      <div class="lead-pager" role="group" aria-label="Move between leads">
        <button type="button" class="lead-pager-btn" onclick="App.stepLead(-1)" ${i === 0 ? 'disabled' : ''} title="Previous lead (K)" aria-label="Previous lead">${Icons.chevronLeft(16)}</button>
        <span class="lead-pager-count">${i + 1} of ${ids.length}</span>
        <button type="button" class="lead-pager-btn" onclick="App.stepLead(1)" ${i === ids.length - 1 ? 'disabled' : ''} title="Next lead (J)" aria-label="Next lead">${Icons.chevronRight(16)}</button>
      </div>`;
  },

  async stepLead(delta) {
    const ids = this.getLeadNavList();
    const next = ids[ids.indexOf(this.state.selectedLeadId) + delta];
    if (!next) return;
    this._nextCallEditing = null;
    await this.viewLead(next);
    window.scrollTo(0, 0);
    document.getElementById('page-content')?.scrollTo?.(0, 0);
  },

  requestCallNotifications() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(() => {
        if (this.state.currentView === 'followups') this.renderFollowUpsView();
      }).catch(() => null);
    }
  },

  updateFollowUpBadge() {
    const count = this.getDueCallCount();
    document.querySelectorAll('[data-followup-badge]').forEach(el => {
      el.textContent = count;
      el.hidden = count === 0;
    });
  },

  async refreshLeadsQuietly() {
    try {
      const leads = await API.get('/api/leads');
      if (Array.isArray(leads)) this.state.leads = leads;
    } catch (err) {
      console.warn('Lead refresh failed:', err);
    }
    this.updateFollowUpBadge();
  },

  // The WhatsApp sync once saved shared files (e.g. PDFs) by decoding their bytes as text. Show those notes as a
  // file reference instead of the unreadable bytes; the stored note is left untouched.
  getBinaryNoteInfo(notes) {
    const text = String(notes || '');
    const pdfAt = text.indexOf('%PDF-');
    const garbled = (text.match(/[�\u0000-\u0008\u000E-\u001F]/g) || []).length;
    if (pdfAt < 0 && !(text.length > 200 && garbled / text.length > 0.02)) return null;
    const head = (pdfAt >= 0 ? text.slice(0, pdfAt) : text.split('\n\n')[0]).trim();
    const fileName = (head.match(/\(([^()\n]+\.[a-z0-9]{2,5})\)/i) || [])[1] || '';
    const caption = ((head.match(/Caption:[ \t]*([^\n]*)$/i) || [])[1] || '').trim();
    const title = head.replace(/\s*Caption:[^\n]*$/i, '').replace(/\s*\([^()\n]+\.[a-z0-9]{2,5}\)/i, '').trim();
    const ext = (fileName.match(/\.([a-z0-9]{2,5})$/i) || [])[1];
    return { title, fileName, caption, kind: ext ? ext.toUpperCase() : (pdfAt >= 0 ? 'PDF' : 'File') };
  },

  renderActivityNotes(notes) {
    const file = this.getBinaryNoteInfo(notes);
    if (!file) return `<div class="activity-body">${this.escapeHtml(notes)}</div>`;
    return `
      <div class="activity-body">
        <div>${this.escapeHtml(/team transcript document/i.test(file.title) || !file.title ? 'Document shared in the Zero7 WhatsApp group' : file.title)}</div>
        <div class="activity-file">
          ${Icons.fileText(14)}
          <span><strong>${this.escapeHtml(file.fileName || `${file.kind} document`)}</strong>
          <small>${file.kind} shared on WhatsApp &middot; its contents can't be shown as text</small></span>
        </div>
        ${file.caption ? `<div>Caption: ${this.escapeHtml(file.caption)}</div>` : ''}
      </div>`;
  },

  // A tab left open keeps running old code after a release; offer a reload when the served version changes.
  async checkForNewVersion() {
    const current = (document.querySelector('script[src*="/js/app.js?v="]')?.getAttribute('src') || '').split('v=')[1];
    if (!current || document.getElementById('app-update-banner')) return;
    try {
      const html = await (await fetch('/', { cache: 'no-store' })).text();
      const served = (html.match(/\/js\/app\.js\?v=([\w.-]+)/) || [])[1];
      if (!served || served === current) return;
      const banner = document.createElement('div');
      banner.id = 'app-update-banner';
      banner.className = 'app-update-banner';
      banner.setAttribute('role', 'status');
      banner.innerHTML = `<span>A new version of the CRM is available.</span><button type="button" class="btn btn-primary btn-sm" onclick="location.reload()">Reload</button>`;
      document.body.appendChild(banner);
    } catch (e) { /* offline; try again later */ }
  },

  startFollowUpMonitor() {
    if (this._followUpTimer) return;
    this._followUpTimer = setInterval(() => this.checkDueCalls(), 60000);
    setInterval(() => { if (!document.hidden) { this.refreshLeadsQuietly(); this.checkForNewVersion(); } }, 5 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.checkForNewVersion(); });
    setTimeout(() => this.checkDueCalls(), 1500);
  },

  // Alerts once per scheduled time (per browser session) when a call is due within 5 minutes.
  checkDueCalls() {
    if (!this.state.currentUser) return;
    this.updateFollowUpBadge();
    const now = Date.now();
    let alerted = {};
    try { alerted = JSON.parse(sessionStorage.getItem('zero7_call_alerts') || '{}'); } catch (e) { alerted = {}; }
    const fresh = this.getScheduledCalls().filter(({ lead, call }) =>
      call.at.getTime() - now <= 5 * 60000 && alerted[lead.id] !== call.at.toISOString());
    if (!fresh.length) return;
    fresh.forEach(({ lead, call }) => { alerted[lead.id] = call.at.toISOString(); });
    try { sessionStorage.setItem('zero7_call_alerts', JSON.stringify(alerted)); } catch (e) { /* alerts may repeat */ }

    if (fresh.length > 2) {
      API.showToast(`${fresh.length} scheduled calls are due. Open Follow-ups to work through them.`, 'info');
      return;
    }
    fresh.forEach(({ lead, call }) => {
      const label = `${lead.name || 'Lead'}${lead.business_name ? ` (${lead.business_name})` : ''}`;
      API.showToast(`Call due: ${this.escapeHtml(label)} · ${this.formatCallTime(call.at)} · ${this.formatCallDue(call)}`, 'info');
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(`Call ${lead.name || 'lead'} now`, {
            body: `${lead.business_name || ''} · ${this.formatCallTime(call.at)} IST · ${call.purpose}`.replace(/^ · /, ''),
            tag: `zero7-call-${lead.id}`
          });
          n.onclick = () => { window.focus(); this.viewLead(lead.id); n.close(); };
        } catch (e) { /* notifications unavailable */ }
      }
    });
  },

  setFollowUpsTab(tab) {
    this.state.followUpsTab = tab;
    this.renderFollowUpsView();
  },

  renderFollowUpRow(lead, call, now) {
    const phone = String(lead.phone || '').replace(/[^0-9+]/g, '');
    const sub = [lead.business_name, lead.phone].filter(Boolean).map(v => this.escapeHtml(v)).join(' &middot; ');
    const bucket = call ? this.getCallBucket(call, now) : 'unscheduled';
    return `
      <div class="followup-row bucket-${bucket}">
        <div class="followup-time">
          ${call ? `<strong>${this.formatCallTime(call.at, false)}</strong><span>${call.at.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })}</span>`
                 : `<strong>Not scheduled</strong><span>${lead.updated_at ? `Updated ${this.escapeHtml(this.formatRelativeTime(lead.updated_at))}` : ''}</span>`}
        </div>
        <div class="followup-main">
          <button type="button" class="lead-name-link" onclick="App.viewLead('${lead.id}')">${this.escapeHtml(lead.name || 'Unnamed lead')}</button>
          ${sub ? `<span class="followup-sub">${sub}</span>` : ''}
          ${call ? `<span class="followup-purpose">${this.escapeHtml(call.purpose)}</span>`
                 : `<span class="followup-purpose">${this.escapeHtml(this.getLeadStageLabel(lead))}</span>`}
        </div>
        ${call ? `<span class="followup-due">${this.formatCallDue(call, now)}</span>` : '<span class="followup-due"></span>'}
        <div class="followup-actions">
          ${phone ? `<a class="btn btn-secondary btn-sm" href="tel:${phone}" title="Call ${this.escapeHtml(lead.phone)}">${Icons.phone(13)} Call</a>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" onclick="App.openScheduleCallModal('${lead.id}')">${call ? 'Reschedule' : `${Icons.calendar(13)} Schedule`}</button>
          ${call ? `<button type="button" class="btn btn-primary btn-sm" onclick="App.completeScheduledCall('${lead.id}')">${Icons.check(13)} Done</button>` : ''}
        </div>
      </div>`;
  },

  getLeadStageLabel(lead) {
    const stage = String(lead.call_stage || lead.status || 'new').replace(/_/g, ' ');
    return `Stage: ${stage.charAt(0).toUpperCase()}${stage.slice(1)}`;
  },

  // Leads that have had a conversation but have nothing scheduled next.
  getLeadsNeedingNextCall() {
    const active = ['first_call', 'connected', 'follow_up', 'dnp', 'interested', 'qualified', 'proposal_sent', 'negotiation'];
    const rank = lead => ({ high: 0, medium: 1 })[String(lead.priority || '').toLowerCase()] ?? 2;
    return (this.state.leads || [])
      .filter(lead => !this.getScheduledCall(lead))
      .filter(lead => active.includes(String(lead.call_stage || '').toLowerCase()))
      .filter(lead => !['won', 'lost', 'closed', 'junk'].includes(String(lead.status || '').toLowerCase()))
      .sort((a, b) => rank(a) - rank(b) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  },

  renderFollowUpsView() {
    const mainEl = document.getElementById('page-content');
    if (!mainEl) return;
    const now = new Date();
    const calls = this.getScheduledCalls();
    const groups = [
      ['overdue', 'Overdue'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 days'], ['later', 'Later']
    ].map(([id, label]) => ({ id, label, items: calls.filter(({ call }) => this.getCallBucket(call, now) === id) }));
    const count = id => groups.find(g => g.id === id).items.length;
    const needing = this.getLeadsNeedingNextCall();
    const tab = this.state.followUpsTab || 'scheduled';
    const canNotify = 'Notification' in window && Notification.permission === 'default';

    const scheduledHtml = calls.length ? groups.filter(g => g.items.length).map(g => `
      <section class="followup-group bucket-${g.id}">
        <h2 class="followup-group-title">${g.label} <span>${g.items.length}</span></h2>
        <div class="followup-list">${g.items.map(({ lead, call }) => this.renderFollowUpRow(lead, call, now)).join('')}</div>
      </section>`).join('') : `
      <div class="followup-empty">
        ${Icons.calendar(22)}
        <p><strong>No calls scheduled.</strong> Open a lead and use <em>Next call</em>, or schedule one from <em>Needs a next call</em>.</p>
      </div>`;

    const needingHtml = needing.length ? `
      <section class="followup-group">
        <div class="followup-list">${needing.map(lead => this.renderFollowUpRow(lead, null, now)).join('')}</div>
      </section>` : `
      <div class="followup-empty">${Icons.checkCircle(22)}<p><strong>Every active conversation has a next call.</strong></p></div>`;

    mainEl.innerHTML = `
      <div class="schedule-view-container followups-view">
        <div class="battle-plan-header">
          <div>
            <h1 class="battle-plan-title">${Icons.calendar(22)} Follow-ups</h1>
            <p class="battle-plan-subtitle">Calls promised to leads, in IST. While the CRM is open you get an alert 5 minutes before each one.</p>
          </div>
          ${canNotify ? `<button class="btn btn-secondary btn-sm" onclick="App.requestCallNotifications()">${Icons.bell(14)} Enable desktop alerts</button>` : ''}
        </div>

        <div class="battle-kpi-grid">
          <div class="battle-kpi-card ${count('overdue') ? 'followup-kpi-alert' : ''}">
            <span class="battle-kpi-lbl">Overdue</span>
            <span class="battle-kpi-val">${count('overdue')}</span>
          </div>
          <div class="battle-kpi-card">
            <span class="battle-kpi-lbl">Due today</span>
            <span class="battle-kpi-val">${count('today')}</span>
          </div>
          <div class="battle-kpi-card">
            <span class="battle-kpi-lbl">Upcoming</span>
            <span class="battle-kpi-val">${count('tomorrow') + count('week') + count('later')}</span>
          </div>
          <div class="battle-kpi-card">
            <span class="battle-kpi-lbl">Needs a next call</span>
            <span class="battle-kpi-val">${needing.length}</span>
          </div>
        </div>

        <div class="ui-segmented" style="overflow-x: auto;">
          <button class="btn-pill ${tab === 'scheduled' ? 'active' : ''}" onclick="App.setFollowUpsTab('scheduled')">Scheduled calls (${calls.length})</button>
          <button class="btn-pill ${tab === 'needing' ? 'active' : ''}" onclick="App.setFollowUpsTab('needing')">Needs a next call (${needing.length})</button>
        </div>

        ${tab === 'needing' ? needingHtml : scheduledHtml}
      </div>
    `;
    this.updateFollowUpBadge();
  },

  // ==========================================
  // DASHBOARD: lead heat, hot leads, proposals, invoices and cash
  // ==========================================
  TEMPERATURES: [['hot', 'Hot'], ['warm', 'Warm'], ['cold', 'Cold']],

  isActiveLead(lead) {
    return !['lost', 'deal'].includes(this.getLeadFlowStep(lead, this.hasDeal(lead)));
  },

  hasDeal(lead) {
    return (this.state.deals || []).some(d => d.lead_id === lead.id);
  },

  // Hot, still-open leads, most urgent next step first.
  getDashboardHotLeads(now = new Date()) {
    const urgency = { overdue: 0, today: 1, unscheduled: 2, tomorrow: 3, week: 4, later: 5, muted: 6 };
    return (this.state.leads || [])
      .filter(lead => String(lead.temperature || '').toLowerCase() === 'hot' && this.isActiveLead(lead))
      .map(lead => ({ lead, next: this.getLeadNextStep(lead, now) }))
      .sort((a, b) => (urgency[a.next.tone] ?? 9) - (urgency[b.next.tone] ?? 9)
        || String(b.lead.created_at || '').localeCompare(String(a.lead.created_at || '')));
  },

  // Proposals sent and not yet won or lost.
  getOpenProposals() {
    return (this.state.leads || [])
      .filter(lead => String(lead.status || '').toLowerCase() === 'proposal'
        || ['proposal_sent', 'negotiation'].includes(String(lead.call_stage || '').toLowerCase()))
      .filter(lead => this.isActiveLead(lead))
      .sort((a, b) => (Number(b.deal_value) || 0) - (Number(a.deal_value) || 0));
  },

  // Billing from deal payment milestones: "due" milestones are invoiced and awaiting payment.
  getInvoiceRows() {
    const billed = ['due', 'overdue', 'invoiced', 'sent'];
    const rows = [];
    (this.state.deals || []).forEach(deal => {
      (Array.isArray(deal.payment_milestones) ? deal.payment_milestones : []).forEach(m => {
        const status = String(m?.status || 'pending').toLowerCase();
        if (status === 'paid') return;
        rows.push({ deal, name: m.milestone || m.milestone_name || 'Milestone', amount: Number(m.amount ?? m.target_amount) || 0,
          status, billed: billed.includes(status) });
      });
    });
    const order = r => r.billed ? 0 : r.status === 'recurring' ? 2 : 1;
    return rows.sort((a, b) => order(a) - order(b) || b.amount - a.amount);
  },

  // New leads per IST week (Monday start) by their current temperature.
  getWeeklyLeadHeat(weeks = 8, now = new Date()) {
    const today = this.istParts(now).date;
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const thisMonday = this.shiftIstDate(today, -dow);
    const buckets = Array.from({ length: weeks }, (_, i) => ({ start: this.shiftIstDate(thisMonday, -7 * (weeks - 1 - i)), hot: 0, warm: 0, cold: 0 }));
    (this.state.leads || []).forEach(lead => {
      const created = new Date(this._normalizeIso(lead.created_at) || NaN);
      if (isNaN(created.getTime())) return;
      const day = this.istParts(created).date;
      const bucket = [...buckets].reverse().find(b => day >= b.start);
      if (!bucket || day > this.shiftIstDate(buckets[buckets.length - 1].start, 6)) return;
      const t = String(lead.temperature || 'warm').toLowerCase();
      bucket[['hot', 'cold'].includes(t) ? t : 'warm']++;
    });
    return buckets;
  },

  openLeadsFiltered(key, value) {
    this.state.filters = { status: '', source: '', assigned_to: '', temperature: '', call_stage: '', priority: '', search: '', [key]: value };
    this.setView('leads');
  },

  renderDashboardView() {
    const mainEl = document.getElementById('page-content');
    if (!mainEl) return;
    const now = new Date();
    const leads = this.state.leads || [];
    const deals = this.state.deals || [];
    const hot = this.getDashboardHotLeads(now);
    const hotNow = hot.filter(h => ['overdue', 'today'].includes(h.next.tone)).length;
    const proposals = this.getOpenProposals();
    const proposalValue = proposals.reduce((s, l) => s + (Number(l.deal_value) || 0), 0);
    const invoices = this.getInvoiceRows();
    const billed = invoices.filter(r => r.billed);
    const billedTotal = billed.reduce((s, r) => s + r.amount, 0);
    const unbilledTotal = invoices.filter(r => !r.billed && r.status !== 'recurring').reduce((s, r) => s + r.amount, 0);
    const wonValue = deals.reduce((s, d) => s + (Number(d.value) || 0), 0);
    const received = deals.reduce((s, d) => s + (Number(d.amount_received) || 0), 0);
    const pct = wonValue ? Math.round((received / wonValue) * 100) : 0;
    const money = v => this.formatCurrency(v);

    // Lead heat chart (stacked weekly bars) and current distribution.
    const weeks = this.getWeeklyLeadHeat(8, now);
    const max = Math.max(1, ...weeks.map(w => w.hot + w.warm + w.cold));
    const weekLabel = start => new Date(`${start}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const active = leads.filter(l => this.isActiveLead(l));
    const heat = Object.fromEntries(this.TEMPERATURES.map(([t]) => [t, active.filter(l => (['hot', 'cold'].includes(String(l.temperature || '').toLowerCase()) ? String(l.temperature).toLowerCase() : 'warm') === t).length]));
    const chart = `
      <div class="dash-chart" role="img" aria-label="New leads per week by temperature, last 8 weeks">
        ${weeks.map(w => {
          const total = w.hot + w.warm + w.cold;
          return `
            <div class="dash-bar-col" tabindex="0">
              <span class="dash-bar-total">${total || ''}</span>
              <div class="dash-bar ${total / max > 0.55 ? 'tip-beside' : ''}" style="height: ${Math.round((total / max) * 100)}%">
                ${this.TEMPERATURES.map(([t]) => w[t] ? `<span class="dash-seg seg-${t}" style="flex-grow: ${w[t]}"></span>` : '').join('')}
                <div class="dash-tip" role="tooltip">
                  <strong>Week of ${weekLabel(w.start)}</strong>
                  ${this.TEMPERATURES.map(([t, label]) => `<span><i class="dash-key seg-${t}"></i>${label} <b>${w[t]}</b></span>`).join('')}
                </div>
              </div>
              <span class="dash-bar-label">${weekLabel(w.start)}</span>
            </div>`;
        }).join('')}
      </div>
      <table class="sr-only">
        <caption>New leads per week by temperature</caption>
        <tr><th>Week</th>${this.TEMPERATURES.map(([, l]) => `<th>${l}</th>`).join('')}</tr>
        ${weeks.map(w => `<tr><td>${weekLabel(w.start)}</td><td>${w.hot}</td><td>${w.warm}</td><td>${w.cold}</td></tr>`).join('')}
      </table>`;

    const flowCounts = this.LEAD_FLOW_STEPS.map(([id, label]) => [label, leads.filter(l => this.getLeadFlowStep(l, this.hasDeal(l)) === id).length]);
    flowCounts.push(['Lost', leads.filter(l => this.getLeadFlowStep(l, this.hasDeal(l)) === 'lost').length]);
    const flowMax = Math.max(1, ...flowCounts.map(([, n]) => n));

    const leadRow = (lead, right, sub) => `
      <button type="button" class="dash-row" onclick="App.viewLead('${lead.id}')">
        <span class="dash-row-main">
          <strong>${this.escapeHtml(lead.name || 'Unnamed lead')}</strong>
          <span>${sub}</span>
        </span>
        ${right}
      </button>`;
    const hotHtml = hot.length ? hot.slice(0, 7).map(({ lead, next }) => leadRow(lead,
      '', `${this.escapeHtml(lead.business_name || lead.city || '')}${lead.business_name || lead.city ? ' &middot; ' : ''}<em class="next-step tone-${next.tone}">${this.escapeHtml(next.text)}</em>`)).join('')
      : '<p class="dash-empty">No open hot leads.</p>';
    const proposalHtml = proposals.length ? proposals.slice(0, 7).map(lead => leadRow(lead,
      `<span class="dash-amount">${Number(lead.deal_value) ? money(lead.deal_value) : '—'}</span>`,
      `${this.escapeHtml(lead.business_name || '')}${lead.business_name ? ' &middot; ' : ''}updated ${this.escapeHtml(this.formatRelativeTime(lead.updated_at) || '')}`)).join('')
      : '<p class="dash-empty">No open proposals. Set a lead’s status to <em>Proposal</em> when you send one.</p>';
    const statusLabel = r => r.billed ? 'Invoiced' : r.status === 'recurring' ? 'Recurring' : 'Not billed';
    const invoiceHtml = invoices.length ? invoices.slice(0, 7).map(r => `
      <button type="button" class="dash-row" onclick="App.viewDeal('${r.deal.id}')">
        <span class="dash-row-main">
          <strong>${this.escapeHtml(r.name)}</strong>
          <span>${this.escapeHtml(r.deal.title || 'Deal')}</span>
        </span>
        <span class="dash-row-end">
          <span class="dash-amount">${money(r.amount)}</span>
          <span class="dash-chip ${r.billed ? 'is-billed' : ''}">${statusLabel(r)}</span>
        </span>
      </button>`).join('')
      : '<p class="dash-empty">No unpaid milestones on won deals.</p>';

    mainEl.innerHTML = `
      <div class="schedule-view-container dashboard-view">
        <div class="battle-plan-header">
          <div>
            <h1 class="battle-plan-title">${Icons.layoutDashboard(22)} Dashboard</h1>
            <p class="battle-plan-subtitle">From lead to cash, as of ${this.escapeHtml(this.formatCallTime(now))} IST.</p>
          </div>
        </div>

        <div class="battle-kpi-grid dash-kpis">
          <button type="button" class="battle-kpi-card ${hotNow ? 'followup-kpi-alert' : ''}" onclick="App.openLeadsFiltered('temperature', 'hot')">
            <span class="battle-kpi-lbl">Hot leads</span>
            <span class="battle-kpi-val">${hot.length}</span>
            <span class="dash-kpi-sub">${hotNow ? `${hotNow} need a call now` : 'None waiting on a call'}</span>
          </button>
          <button type="button" class="battle-kpi-card" onclick="App.openLeadsFiltered('status', 'proposal')">
            <span class="battle-kpi-lbl">Open proposals</span>
            <span class="battle-kpi-val">${proposals.length}</span>
            <span class="dash-kpi-sub">${proposalValue ? `${money(proposalValue)} in play` : 'Value not set'}</span>
          </button>
          <button type="button" class="battle-kpi-card" onclick="App.setView('deals')">
            <span class="battle-kpi-lbl">Invoiced, unpaid</span>
            <span class="battle-kpi-val">${money(billedTotal)}</span>
            <span class="dash-kpi-sub">${billed.length} invoice${billed.length === 1 ? '' : 's'} &middot; ${money(unbilledTotal)} not billed yet</span>
          </button>
          <button type="button" class="battle-kpi-card" onclick="App.setView('deals')">
            <span class="battle-kpi-lbl">Collected</span>
            <span class="battle-kpi-val">${money(received)}</span>
            <span class="dash-kpi-sub">${pct}% of ${money(wonValue)} won</span>
          </button>
        </div>

        <div class="dash-grid-top">
          <section class="record-card dash-card">
            <div class="dash-card-head">
              <h2>New leads by temperature</h2>
              <div class="dash-legend">
                ${this.TEMPERATURES.map(([t, label]) => `<button type="button" onclick="App.openLeadsFiltered('temperature', '${t}')"><i class="dash-key seg-${t}"></i>${label} <b>${heat[t]}</b></button>`).join('')}
              </div>
            </div>
            <p class="dash-card-note">Last 8 weeks, by week the lead came in. Legend counts are open leads today.</p>
            ${chart}
          </section>
          <section class="record-card dash-card">
            <div class="dash-card-head"><h2>Where leads are</h2></div>
            <div class="dash-flow">
              ${flowCounts.map(([label, n]) => `
                <div class="dash-flow-row">
                  <span>${label}</span>
                  <span class="dash-flow-track"><span style="width: ${Math.max(n ? 2 : 0, Math.round((n / flowMax) * 100))}%"></span></span>
                  <b>${n}</b>
                </div>`).join('')}
            </div>
          </section>
        </div>

        <div class="dash-columns">
          <section class="record-card dash-card">
            <div class="dash-card-head"><h2>${Icons.flame(15)} Hot leads <span class="dash-count">${hot.length}</span></h2>
              ${hot.length > 7 ? `<button type="button" class="btn btn-ghost btn-sm" onclick="App.openLeadsFiltered('temperature', 'hot')">View all</button>` : ''}</div>
            <div class="dash-list">${hotHtml}</div>
          </section>
          <section class="record-card dash-card">
            <div class="dash-card-head"><h2>${Icons.fileText(15)} Proposals <span class="dash-count">${proposals.length}</span></h2>
              ${proposals.length > 7 ? `<button type="button" class="btn btn-ghost btn-sm" onclick="App.openLeadsFiltered('status', 'proposal')">View all</button>` : ''}</div>
            <div class="dash-list">${proposalHtml}</div>
          </section>
          <section class="record-card dash-card">
            <div class="dash-card-head"><h2>${Icons.indianRupee(15)} Invoices <span class="dash-count">${invoices.length}</span></h2>
              <button type="button" class="btn btn-ghost btn-sm" onclick="App.setView('deals')">Deals</button></div>
            <div class="dash-list">${invoiceHtml}</div>
            <p class="dash-card-note">From deal payment milestones. "Invoiced" means the milestone is marked due.</p>
          </section>
        </div>
      </div>`;
  },

  toggleSidebar() {
    this.state.sidebarExpanded = !this.state.sidebarExpanded;
    localStorage.setItem('zero7_sidebar_expanded', this.state.sidebarExpanded);
    this.render();
  },

  navigateTo(targetHash, replace = false) {
    if (!targetHash.startsWith('#')) {
      targetHash = '#' + targetHash;
    }
    if (window.location.hash === targetHash) {
      this.handleRoute();
      return;
    }
    if (replace && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', targetHash);
      this.handleRoute();
    } else {
      window.location.hash = targetHash;
    }
  },

  async handleRoute() {
    if (!this.state.currentUser) return;
    if (this._isRouting) return;
    this._isRouting = true;

    try {
      let rawHash = window.location.hash || '';
      if (rawHash.startsWith('#')) rawHash = rawHash.substring(1);
      const [pathPart, queryPart] = rawHash.split('?');
      const cleanPath = (pathPart || '').trim();
      const segments = cleanPath.split('/').filter(Boolean);

      const root = segments[0] || 'leads';

      if (root === 'schedule' || root === 'battle-plan') {
        this.state.currentView = 'schedule';
        this.render();
      } else if (root === 'dashboard') {
        this.state.currentView = 'dashboard';
        this.render();
      } else if (root === 'followups' || root === 'follow-ups') {
        this.state.currentView = 'followups';
        this.render();
        this.refreshLeadsQuietly().then(() => {
          if (this.state.currentView === 'followups') this.renderFollowUpsView();
        });
      } else if (root === 'leads' || root === 'lead') {
        const leadId = segments[1];
        const tab = segments[2] || 'details';
        if (leadId) {
          this.state.selectedLeadId = leadId;
          this.state.activeLeadTab = tab === 'agent' ? 'agent' : 'details';
          this.state.currentView = 'lead_detail';
          if (!this.state.selectedLead || this.state.selectedLead.id !== leadId) {
            try {
              this.state.selectedLead = await API.get(`/api/leads/${leadId}`);
            } catch (err) {
              console.error('[ROUTER] Failed to load lead:', err);
              this.state.selectedLead = this.state.leads.find(l => l.id === leadId) || null;
            }
          }
          this.render();
        } else {
          this.state.currentView = 'leads';
          this.state.selectedLeadId = null;
          this.state.selectedLead = null;
          this.render();
        }
      } else if (root === 'deals' || root === 'deal') {
        const dealId = segments[1];
        this.state.currentView = 'deals';
        this.render();
        if (dealId) {
          this.viewDeal(dealId, 'deliverables', false);
        }
      } else if (root === 'agents' || root === 'agent') {
        this.state.currentView = 'agents';
        const slug = segments[1];
        if (slug) {
          this._grokActiveAgentSlug = slug;
        }
        this.render();
      } else if (root === 'mail' || root === 'inbox') {
        this.state.currentView = 'mail';
        this.render();
      } else if (root === 'whatsapp' || root === 'wa' || root === 'whatsapp-central' || root === 'whatsapp_central') {
        this.state.currentView = 'whatsapp';
        const targetPhone = segments[1];
        if (targetPhone) {
          const ws = this._initWhatsAppState();
          ws.activePhone = targetPhone;
        }
        this.render();
      } else if (root === 'integrations') {
        this.state.currentView = 'integrations';
        this.render();
      } else if (root === 'team') {
        this.state.currentView = 'team';
        this.render();
      } else {
        this.state.currentView = 'leads';
        this.state.selectedLeadId = null;
        this.state.selectedLead = null;
        this.render();
      }

      // Handle Google Tasks OAuth return feedback
      if (queryPart && queryPart.includes('gtasks_success=1')) {
        setTimeout(() => API.showToast('Google Tasks connected! Tasks will sync to your mobile widget.', 'success'), 600);
      } else if (queryPart && queryPart.includes('gtasks_error=')) {
        const err = queryPart.split('gtasks_error=')[1]?.split('&')[0];
        setTimeout(() => API.showToast('Google Tasks connection failed: ' + decodeURIComponent(err || 'Unknown error'), 'error'), 600);
      }
    } finally {
      this._isRouting = false;
    }
  },

  setView(view, id = null) {
    if (view === 'schedule') {
      this.navigateTo('#/schedule');
      return;
    } else if (view === 'followups') {
      this.navigateTo('#/followups');
    } else if (view === 'dashboard') {
      this.navigateTo('#/dashboard');
    } else if (view === 'leads') {
      this.navigateTo('#/leads');
    } else if (view === 'deals') {
      this.navigateTo('#/deals');
    } else if (view === 'mail') {
      this.navigateTo('#/mail');
    } else if (view === 'whatsapp') {
      this.navigateTo(id ? `#/whatsapp/${id}` : '#/whatsapp');
    } else if (view === 'agents') {
      this.navigateTo('#/agents');
    } else if (view === 'integrations') {
      this.navigateTo('#/integrations');
    } else if (view === 'team') {
      this.navigateTo('#/team');
    } else if (view === 'lead_detail' && id) {
      this.navigateTo(`#/leads/${id}`);
    } else if (view === 'deal_detail' && id) {
      this.navigateTo(`#/deals/${id}`);
    } else {
      this.navigateTo(`#/${view}`);
    }
  },


  async viewLead(id, pushRoute = true, tab = null) {
    if (this.state.currentView !== 'lead_detail') this.state.leadNavIds = this.getLeadNavContextIds();
    if (tab) {
      this.state.activeLeadTab = tab;
    } else if (!this.state.activeLeadTab) {
      this.state.activeLeadTab = 'details';
    }
    this.state.selectedLeadId = id;
    this.state.currentView = 'lead_detail';

    const targetHash = `#/leads/${id}${this.state.activeLeadTab === 'agent' ? '/agent' : ''}`;
    if (pushRoute && window.location.hash !== targetHash) {
      this.navigateTo(targetHash);
      return;
    }

    try {
      this.state.selectedLead = await API.get(`/api/leads/${id}`);
    } catch (e) {
      console.error(e);
      this.state.selectedLead = this.state.leads.find(l => l.id === id) || null;
    }
    this.render();
  },

  render() {
    const appEl = document.getElementById('app');
    if (!this.state.currentUser) {
      this.renderLogin();
      return;
    }

    appEl.innerHTML = this.renderAppLayout();

    if (this.state.currentView === 'schedule') {
      this.renderScheduleView();
    } else if (this.state.currentView === 'dashboard') {
      this.renderDashboardView();
    } else if (this.state.currentView === 'followups') {
      this.renderFollowUpsView();
    } else if (this.state.currentView === 'leads') {
      this.renderLeadsView();
    } else if (this.state.currentView === 'lead_detail') {
      this.renderLeadDetailPage();
    } else if (this.state.currentView === 'deals') {
      this.renderDealsView();
    } else if (this.state.currentView === 'deal_detail') {
      this.renderDealDetailPage();
    } else if (this.state.currentView === 'mail') {
      this.renderMailView();
    } else if (this.state.currentView === 'whatsapp') {
      this.renderWhatsAppView();
    } else if (this.state.currentView === 'integrations') {

      this.renderIntegrationsPage();
    } else if (this.state.currentView === 'team') {
      this.renderTeamPage();
    } else if (this.state.currentView === 'agents') {
      this.renderAgentStudioPage();
    }
  },

  // ---------------- AUTH & LOGIN ----------------

  renderLogin() {
    const appEl = document.getElementById('app');
    appEl.innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <div class="sidebar-brand-badge" style="width: 36px; height: 36px; font-size: 14px; border-radius: 8px;">Z7</div>
            <div>
              <h1 style="font-size: 19px; font-weight: 600; letter-spacing: -0.025em; color: var(--color-ink);">Zero7 Consultancy</h1>
              <span class="sidebar-brand-sub" style="margin-top: 2px;">Operating System</span>
            </div>
          </div>
          <p style="font-size: 13px; color: var(--color-mid-gray); margin-bottom: 24px;">Sign in to access leads, deal pipelines, and client intelligence.</p>

          <form id="login-form">
            <div class="form-group">
              <label>Email Address</label>
              <input type="email" id="login-email" name="email" class="input" placeholder="name@zero7.in" required autocomplete="username">
            </div>
            <div class="form-group" style="margin-top: 14px;">
              <label>Password</label>
              <input type="password" id="login-password" name="password" class="input" placeholder="••••••••" required autocomplete="current-password">
            </div>
            <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 20px; height: 38px; font-weight: 500;">Sign In to Zero7 CRM &rarr;</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      try {
        const data = await API.post('/api/auth/login', { email, password });
        if (!data || !data.token) throw new Error('Invalid login response');
        this.state.token = data.token;
        this.state.currentUser = data.user;
        localStorage.setItem('zero7_token', data.token);
        API.showToast('Signed in successfully', 'success');
        await this.loadInitialData();
        await this.handleRoute();
        this.startFollowUpMonitor();
      } catch (err) {
        console.error('Login error:', err);
      }
    });
  },

  fillLogin(email, password) {
    const eEl = document.getElementById('login-email');
    const pEl = document.getElementById('login-password');
    if (eEl) eEl.value = email;
    if (pEl) pEl.value = password;
  },

  logout() {
    this.state.token = null;
    this.state.currentUser = null;
    this.state.selectedLead = null;
    this.state.selectedDeal = null;
    localStorage.removeItem('zero7_token');
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '#/');
    } else {
      window.location.hash = '';
    }
    API.showToast('Logged out', 'info');
    this.renderLogin();
  },

  // ---------------- SHELL & COLLAPSIBLE SIDEBAR ----------------

  renderAppLayout() {
    const isExpanded = this.state.sidebarExpanded;
    const view = this.state.currentView;
    const u = this.state.currentUser || { name: 'User', role: 'member' };
    const initials = (u.name || 'User').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    return `
      <div class="app-shell">
        <!-- Left Sidebar (Collapsible Rail) -->
        <aside class="sidebar-rail ${isExpanded ? 'expanded' : 'collapsed'}">
          <div>
            <div class="sidebar-header">
              <button class="sidebar-toggle-btn" onclick="App.toggleSidebar()" title="Toggle Navigation Menu">
                ${Icons.menu(18)}
              </button>
              ${isExpanded ? `
                <div style="display: flex; align-items: center; gap: 9px;">
                  <div class="sidebar-brand-badge">Z7</div>
                  <div class="sidebar-brand-title">
                    <span>Zero7</span>
                    <span class="sidebar-brand-sub">CRM</span>
                  </div>
                </div>
              ` : `
                <div class="sidebar-brand-badge" style="width: 28px; height: 28px; font-size: 11px;">Z7</div>
              `}
            </div>

            <nav class="sidebar-nav" aria-label="Workspace navigation">
              ${isExpanded ? '<div class="nav-section-label">Workspace</div>' : ''}
              <button class="sidebar-nav-item ${view === 'dashboard' ? 'active' : ''}"
                      onclick="App.setView('dashboard')" title="Dashboard: lead heat, proposals, invoices and cash">
                ${Icons.layoutDashboard(18)}
                ${isExpanded ? `<span>Dashboard</span>` : ''}
              </button>

              <button class="sidebar-nav-item ${view === 'schedule' ? 'active' : ''}"
                      onclick="App.setView('schedule')" title="Capital-Per-Unit-Time Daily Schedule (Battle Plan)">
                ${Icons.zap(18)}
                ${isExpanded ? `<span>Daily Schedule</span>` : ''}
              </button>

              <button class="sidebar-nav-item ${view === 'followups' ? 'active' : ''}"
                      onclick="App.setView('followups')" title="Follow-ups: scheduled calls">
                ${Icons.calendar(18)}
                ${isExpanded ? `<span>Follow-ups</span>` : ''}
                <span class="nav-count-badge" data-followup-badge ${this.getDueCallCount() ? '' : 'hidden'}>${this.getDueCallCount()}</span>
              </button>

              <button class="sidebar-nav-item ${view === 'leads' || view === 'lead_detail' ? 'active' : ''}" 
                      onclick="App.setView('leads')" title="Leads Pipeline">
                ${Icons.target(18)}
                ${isExpanded ? `<span>Leads (${this.state.leads.length})</span>` : ''}
              </button>

              <button class="sidebar-nav-item ${view === 'deals' || view === 'deal_detail' ? 'active' : ''}" 
                      onclick="App.setView('deals')" title="Deals Pipeline">
                ${Icons.briefcase(18)}
                ${isExpanded ? `<span>Deals (${this.state.deals.length})</span>` : ''}
              </button>

              ${isExpanded ? '<div class="nav-section-label">Communication</div>' : ''}
              <button class="sidebar-nav-item ${view === 'mail' ? 'active' : ''}" 
                      onclick="App.setView('mail')" title="Zoho Mail Inbox">
                ${Icons.mail(18)}
                ${isExpanded ? `<span>Mail</span>` : ''}
              </button>

              <button class="sidebar-nav-item ${view === 'whatsapp' ? 'active' : ''}" 
                      onclick="App.setView('whatsapp')" title="Zero7 WhatsApp Central Inbox">
                ${Icons.whatsapp(18)}
                ${isExpanded ? `<span>WhatsApp</span>` : ''}
              </button>

              ${isExpanded ? '<div class="nav-section-label">Manage</div>' : ''}
              <button class="sidebar-nav-item ${view === 'agents' ? 'active' : ''}" 

                      onclick="App.setView('agents')" title="Autonomous Agent Studio">
                ${Icons.bot(18)}
                ${isExpanded ? `<span>Agents</span>` : ''}
              </button>

              <button class="sidebar-nav-item ${view === 'integrations' ? 'active' : ''}" 
                      onclick="App.setView('integrations')" title="Integrations & Webhooks">
                ${Icons.plug(18)}
                ${isExpanded ? `<span>Integrations</span>` : ''}
              </button>

              <button class="sidebar-nav-item ${view === 'team' ? 'active' : ''}" 
                      onclick="App.setView('team')" title="Team & Executioners (RBAC)">
                ${Icons.users(18)}
                ${isExpanded ? `<span>Team (${this.state.users.length})</span>` : ''}
              </button>
            </nav>
          </div>

          <div class="sidebar-footer">
            <button id="theme-toggle-btn" class="theme-toggle-btn" onclick="App.toggleTheme()" title="${this.state.theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}">
              <span id="theme-toggle-icon" style="display:flex;align-items:center;">${this.state.theme === 'dark' ? Icons.sun(18) : Icons.moon(18)}</span>
              ${isExpanded ? `<span id="theme-toggle-text">${this.state.theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>` : ''}
            </button>
            ${isExpanded ? `
              <div class="sidebar-user-chip" onclick="App.openEditUserModal('${u.id}')" title="Click to edit profile & change password">
                <div class="user-avatar">${initials}</div>
                <div style="flex: 1; overflow: hidden;">
                  <div style="font-size: 13px; font-weight: 600; color: var(--color-ink); white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">${this.escapeHtml(u.name)}</div>
                  <div style="font-size: 11px; color: var(--color-mid-gray); text-transform: uppercase;">${u.role} &bull; Edit</div>
                </div>
              </div>
            ` : `
              <div style="display: flex; justify-content: center; margin-bottom: 6px; cursor: pointer;" onclick="App.openEditUserModal('${u.id}')" title="${this.escapeHtml(u.name)} - Click to edit profile & change password">
                <div class="user-avatar">${initials}</div>
              </div>
            `}
            <button class="sidebar-nav-item" onclick="App.logout()" title="Logout" style="color: var(--color-danger);">
              ${Icons.logOut(18)}
              ${isExpanded ? `<span>Log Out</span>` : ''}
            </button>
          </div>
        </aside>

        <!-- Main Workspace Area -->
        <main class="main-viewport">
          <header class="top-nav">
            <div style="display: flex; align-items: center; gap: 14px;">
              <div>
                <div class="top-nav-breadcrumb">Zero7 Workspace</div>
                <div class="top-nav-title" style="display: flex; align-items: center;">
                  ${view === 'lead_detail' ? `
                    <button class="top-nav-back-btn" onclick="App.setView('leads')" title="Back to Leads List">
                      ${Icons.arrowLeft(16)}
                    </button>
                  ` : view === 'deal_detail' ? `
                    <button class="top-nav-back-btn" onclick="App.setView('deals')" title="Back to Deals Pipeline">
                      ${Icons.arrowLeft(16)}
                    </button>
                  ` : ''}
                  <span>
                    ${view === 'schedule' ? 'Daily Schedule' :
                      view === 'dashboard' ? 'Dashboard' :
                      view === 'followups' ? 'Follow-ups' :
                      view === 'leads' ? 'Leads Management' :
                      view === 'lead_detail' ? 'Lead Profile & Activity' :
                      view === 'deals' ? 'Deals Pipeline' :
                      view === 'deal_detail' ? 'Deal Overview' :
                      view === 'mail' ? 'Zoho Mail Inbox' :
                      view === 'whatsapp' ? 'WhatsApp Central Inbox' :
                      view === 'team' ? 'Team & Execution' :
                      view === 'agents' ? 'Autonomous Agent Studio' : 'Integrations & Webhooks'}

                  </span>
                  ${view === 'lead_detail' ? this.renderLeadPager() : ''}
                </div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <button class="btn btn-secondary btn-sm" id="action-queue-btn" onclick="App.openActionQueueDrawer()" style="display: inline-flex; align-items: center; gap: 6px;" title="Human-in-the-Loop Action Approval Queue">
                ${Icons.sparkles(14)}
                <span>Actions</span>
                <span id="pending-actions-badge" style="background: var(--color-primary); color: var(--color-primary-fg); border-radius: 6px; padding: 1px 6px; font-size: 10.5px; font-weight: 600; display: none;">0</span>
              </button>
              ${view === 'leads' ? `
                <button class="btn btn-primary btn-sm" onclick="App.openAddLeadModal()">
                  ${Icons.plus(14)} Add Lead
                </button>
              ` : view === 'deals' ? `
                <button class="btn btn-primary btn-sm" onclick="App.openAddDealModal()">
                  ${Icons.plus(14)} New Deal
                </button>
              ` : view === 'team' && u.role === 'admin' ? `
                <button class="btn btn-primary btn-sm" onclick="App.openAddMemberModal()">
                  ${Icons.plus(14)} Add Team Member
                </button>
              ` : ''}
            </div>
          </header>

          <div class="page-content" id="page-content"></div>
        </main>
      </div>
    `;
  },

  // ---------------- 1. LEADS VIEW ----------------

  getFilteredLeads() {
    let filtered = [...this.state.leads];

    if (this.state.filters.status) {
      filtered = filtered.filter(l => (l.status || '').toLowerCase() === this.state.filters.status.toLowerCase());
    }
    if (this.state.filters.source) {
      filtered = filtered.filter(l => (l.source || '').toLowerCase() === this.state.filters.source.toLowerCase());
    }
    if (this.state.filters.temperature) {
      filtered = filtered.filter(l => (l.temperature || '').toLowerCase() === this.state.filters.temperature.toLowerCase());
    }
    if (this.state.filters.call_stage) {
      filtered = filtered.filter(l => (l.call_stage || '').toLowerCase() === this.state.filters.call_stage.toLowerCase());
    }
    if (this.state.filters.priority) {
      filtered = filtered.filter(l => (l.priority || 'unexplored').toLowerCase() === this.state.filters.priority.toLowerCase());
    }
    if (this.state.filters.assigned_to) {
      filtered = filtered.filter(l => l.assigned_to === this.state.filters.assigned_to);
    }
    if (this.state.filters.search) {
      const q = this.state.filters.search.toLowerCase();
      filtered = filtered.filter(l =>
        (l.name && l.name.toLowerCase().includes(q)) ||
        (l.business_name && l.business_name.toLowerCase().includes(q)) ||
        (l.city && l.city.toLowerCase().includes(q)) ||
        (l.phone && l.phone.toLowerCase().includes(q)) ||
        (l.email && l.email.toLowerCase().includes(q))
      );
    }

    filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    return filtered;
  },

  getDefaultLeadColumns() {
    return ['contact', 'company', 'phone', 'priority', 'next_task', 'status', 'assigned_to'];
  },

  loadLeadColumnPreferences(storage = localStorage) {
    const defaults = this.getDefaultLeadColumns();
    const legacyDefaults = ['contact', 'company', 'priority', 'next_task', 'internal_note', 'upload_media', 'call_stage', 'status', 'assigned_to', 'actions'];
    let columns = defaults;
    try {
      const raw = storage.getItem('zero7_lead_columns');
      const saved = raw ? JSON.parse(raw) : null;
      const version = storage.getItem('zero7_lead_columns_version');
      if (Array.isArray(saved) && saved.length && (version === '2' || saved.join('|') !== legacyDefaults.join('|'))) {
        const split = { contact: ['contact', 'phone'], company: ['company', 'city', 'deal'], inbound: ['inbound', 'inbound_age'], next_task: ['next_task', 'task_due'] };
        const expanded = version === '2' ? saved : saved.flatMap(id => split[id] || [id]);
        const valid = new Set(this.columnDefinitions.map(column => column.id));
        columns = [...new Set(expanded.filter(id => valid.has(id)))];
        if (!columns.includes('contact')) columns.unshift('contact');
      }
      if (raw && version !== '2') storage.setItem('zero7_lead_columns_v1_backup', raw);
      storage.setItem('zero7_lead_columns', JSON.stringify(columns));
      storage.setItem('zero7_lead_columns_version', '2');
    } catch (_) { /* Restricted or malformed browser storage uses the safe defaults. */ }
    return columns;
  },

  columnDefinitions: [
    { id: 'contact', label: 'Name', width: 160, fixed: true },
    { id: 'company', label: 'Company', width: 180 },
    { id: 'phone', label: 'Phone', width: 136 },
    { id: 'email', label: 'Email', width: 220 },
    { id: 'city', label: 'City', width: 120 },
    { id: 'inbound', label: 'Received (IST)', width: 185 },
    { id: 'inbound_age', label: 'Lead age', width: 100 },
    { id: 'priority', label: 'Priority', width: 110 },
    { id: 'next_task', label: 'Next action', width: 240 },
    { id: 'task_due', label: 'Due', width: 150 },
    { id: 'internal_note', label: 'Internal note', width: 200 },
    { id: 'upload_media', label: 'Attach', width: 60 },
    { id: 'temperature', label: 'Temperature', width: 110 },
    { id: 'call_stage', label: 'Call stage', width: 130 },
    { id: 'source', label: 'Source', width: 120 },
    { id: 'status', label: 'Status', width: 110 },
    { id: 'deal', label: 'Delivery deal', width: 180 },
    { id: 'deal_value', label: 'Est. value', width: 110 },
    { id: 'assigned_to', label: 'Owner', width: 110 },
    { id: 'actions', label: 'Open', width: 56 }
  ],

  getLeadTableWidth() {
    return (this.state.visibleColumns || []).reduce((sum, id) => sum + (this.columnDefinitions.find(column => column.id === id)?.width || 120), 0);
  },

  renderLeadColgroup() {
    return `<colgroup>${(this.state.visibleColumns || []).map(id => `<col style="width: ${this.columnDefinitions.find(column => column.id === id)?.width || 120}px;">`).join('')}</colgroup>`;
  },

  renderTableHeaders() {
    return (this.state.visibleColumns || []).map(id => {
      const column = this.columnDefinitions.find(item => item.id === id);
      return column
        ? `<th scope="col" data-column="${id}" draggable="true" title="Drag column to reposition" ondragstart="App.handleColumnDragStart(event, '${id}')" ondragover="App.handleColumnDragOver(event, '${id}')" ondragleave="App.handleColumnDragLeave(event)" ondrop="App.handleColumnDrop(event, '${id}')" ondragend="App.handleColumnDragEnd(event)">${column.label}</th>`
        : '';
    }).join('');
  },

  renderLeadsTableBody() {
    const tbody = document.getElementById('leads-table-body');
    if (!tbody) return false;
    const filtered = this.getFilteredLeads();
    const colCount = (this.state.visibleColumns || []).length || 10;
    tbody.innerHTML = filtered.length > 0 ? filtered.map(lead => this.renderLeadRow(lead)).join('') : `
      <tr>
        <td colspan="${colCount}" style="text-align: center; padding: 48px; color: var(--color-mid-gray);">
          <div style="font-size: 15px; font-weight: 500; color: var(--color-ink); margin-bottom: 4px;">No leads found</div>
          <p style="font-size: 13px;">${this.state.filters.search ? `No leads matching "${this.escapeHtml(this.state.filters.search)}"` : 'Create a new lead manually or ingest from Meta Ads webhook.'}</p>
        </td>
      </tr>
    `;

    const countEl = document.getElementById('leads-table-count');
    if (countEl) countEl.textContent = filtered.length;
    const resetBtn = document.getElementById('leads-filter-reset-btn');
    const hasActiveFilter = (this.state.filters.status || this.state.filters.source || this.state.filters.temperature || this.state.filters.call_stage || this.state.filters.priority || this.state.filters.assigned_to || this.state.filters.search);
    if (resetBtn) {
      resetBtn.style.display = hasActiveFilter ? '' : 'none';
    }
    return true;
  },

  renderLeadsView() {
    const container = document.getElementById?.('page-content');
    if (!container) return;

    const filtered = this.getFilteredLeads();
    const isAdmin = this.state.currentUser?.role === 'admin';
    const hasActiveFilter = (this.state.filters.status || this.state.filters.source || this.state.filters.temperature || this.state.filters.call_stage || this.state.filters.priority || this.state.filters.assigned_to || this.state.filters.search);

    const totalLeads = this.state.leads.length;
    const hotLeads = this.state.leads.filter(l => (l.temperature || '').toLowerCase() === 'hot' || (l.priority || '').toLowerCase() === 'high').length;
    const qualifiedLeads = this.state.leads.filter(l => (l.status || '').toLowerCase() === 'qualified' || (l.status || '').toLowerCase() === 'proposal').length;
    const wonCount = this.state.deals.filter(d => (d.stage || '').toLowerCase() === 'won').length || this.state.leads.filter(l => (l.status || '').toLowerCase() === 'won').length;

    container.innerHTML = `
      <section class="leads-workspace" aria-label="Lead workspace">
      <!-- Fluid UI KPI Metric Cards -->
      <div class="fluid-kpi-grid lead-kpi-grid">
        <div class="fluid-kpi-card">
          <div class="fluid-kpi-info">
            <span class="fluid-kpi-label">Total Leads</span>
            <span class="fluid-kpi-value">${totalLeads}</span>
            <span class="fluid-kpi-trend positive">Active Pipeline</span>
          </div>
          <div class="fluid-kpi-icon-box blue">
            ${Icons.target(22)}
          </div>
        </div>

        <div class="fluid-kpi-card">
          <div class="fluid-kpi-info">
            <span class="fluid-kpi-label">Hot Opportunities</span>
            <span class="fluid-kpi-value">${hotLeads}</span>
            <span class="fluid-kpi-trend positive">${Icons.flame ? Icons.flame(11) : ''} High Priority</span>
          </div>
          <div class="fluid-kpi-icon-box amber">
            ${Icons.sparkles(22)}
          </div>
        </div>

        <div class="fluid-kpi-card">
          <div class="fluid-kpi-info">
            <span class="fluid-kpi-label">Qualified Pipeline</span>
            <span class="fluid-kpi-value">${qualifiedLeads}</span>
            <span class="fluid-kpi-trend neutral">${Icons.briefcase(11)} Proposal Ready</span>
          </div>
          <div class="fluid-kpi-icon-box purple">
            ${Icons.briefcase(22)}
          </div>
        </div>

        <div class="fluid-kpi-card">
          <div class="fluid-kpi-info">
            <span class="fluid-kpi-label">Won Contracts</span>
            <span class="fluid-kpi-value">${wonCount}</span>
            <span class="fluid-kpi-trend positive">${Icons.check(11)} Closed Won</span>
          </div>
          <div class="fluid-kpi-icon-box green">
            ${Icons.check(22)}
          </div>
        </div>
      </div>

      <!-- Fluid UI Filter Toolbar -->
      <div class="filter-bar ui-lead-toolbar">
        <div class="search-box">
          ${Icons.search(16)}
          <input type="text" id="lead-search-input" placeholder="Search by name, company, city..." 
                 value="${this.escapeHtml(this.state.filters.search)}" 
                 oninput="App.updateFilter('search', this.value)">
        </div>

        <select class="filter-select ${this.state.filters.priority ? 'active' : ''}" style="width: 140px;" onchange="App.updateFilter('priority', this.value)">
          <option value="">All Priorities</option>
          <option value="high" ${this.state.filters.priority === 'high' ? 'selected' : ''}>High</option>
          <option value="medium" ${this.state.filters.priority === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="low" ${this.state.filters.priority === 'low' ? 'selected' : ''}>Low</option>
          <option value="unexplored" ${this.state.filters.priority === 'unexplored' ? 'selected' : ''}>Unexplored</option>
          <option value="won" ${this.state.filters.priority === 'won' ? 'selected' : ''}>Won</option>
          <option value="lost" ${this.state.filters.priority === 'lost' ? 'selected' : ''}>Lost</option>
        </select>

        <select class="filter-select ${this.state.filters.temperature ? 'active' : ''}" style="width: 125px;" onchange="App.updateFilter('temperature', this.value)">
          <option value="">All Temp</option>
          <option value="hot" ${this.state.filters.temperature === 'hot' ? 'selected' : ''}>Hot</option>
          <option value="warm" ${this.state.filters.temperature === 'warm' ? 'selected' : ''}>Warm</option>
          <option value="cold" ${this.state.filters.temperature === 'cold' ? 'selected' : ''}>Cold</option>
        </select>

        <select class="filter-select ${this.state.filters.call_stage ? 'active' : ''}" style="width: 155px;" onchange="App.updateFilter('call_stage', this.value)">
          <option value="">All Call Stages</option>
          <option value="uncontacted" ${this.state.filters.call_stage === 'uncontacted' ? 'selected' : ''}>Uncontacted / Not Called</option>
          <option value="first_call" ${this.state.filters.call_stage === 'first_call' ? 'selected' : ''}>First Call</option>
          <option value="follow_up" ${this.state.filters.call_stage === 'follow_up' ? 'selected' : ''}>Follow-up</option>
          <option value="dnp" ${this.state.filters.call_stage === 'dnp' ? 'selected' : ''}>DNP (No Answer)</option>
          <option value="connected" ${this.state.filters.call_stage === 'connected' ? 'selected' : ''}>Connected</option>
          <option value="interested" ${this.state.filters.call_stage === 'interested' ? 'selected' : ''}>Interested</option>
          <option value="not_interested" ${this.state.filters.call_stage === 'not_interested' ? 'selected' : ''}>Not Interested</option>
        </select>

        <select class="filter-select ${this.state.filters.status ? 'active' : ''}" style="width: 135px;" onchange="App.updateFilter('status', this.value)">
          <option value="">All Statuses</option>
          <option value="new" ${this.state.filters.status === 'new' ? 'selected' : ''}>New</option>
          <option value="contacted" ${this.state.filters.status === 'contacted' ? 'selected' : ''}>Contacted</option>
          <option value="qualified" ${this.state.filters.status === 'qualified' ? 'selected' : ''}>Qualified</option>
          <option value="proposal" ${this.state.filters.status === 'proposal' ? 'selected' : ''}>Proposal</option>
          <option value="won" ${this.state.filters.status === 'won' ? 'selected' : ''}>Won</option>
          <option value="lost" ${this.state.filters.status === 'lost' ? 'selected' : ''}>Lost</option>
        </select>

        <select class="filter-select ${this.state.filters.source ? 'active' : ''}" style="width: 135px;" onchange="App.updateFilter('source', this.value)">
          <option value="">All Sources</option>
          <option value="meta_ads" ${this.state.filters.source === 'meta_ads' ? 'selected' : ''}>Meta Ads</option>
          <option value="scraping" ${this.state.filters.source === 'scraping' ? 'selected' : ''}>Lead Scraping</option>
          <option value="manual" ${this.state.filters.source === 'manual' ? 'selected' : ''}>Manual Entry</option>
          <option value="referral" ${this.state.filters.source === 'referral' ? 'selected' : ''}>Referral</option>
          <option value="website" ${this.state.filters.source === 'website' ? 'selected' : ''}>Website</option>
          <option value="linkedin" ${this.state.filters.source === 'linkedin' ? 'selected' : ''}>LinkedIn</option>
        </select>

        ${isAdmin ? `
          <select class="filter-select ${this.state.filters.assigned_to ? 'active' : ''}" style="width: 155px;" onchange="App.updateFilter('assigned_to', this.value)">
            <option value="">All Consultants</option>
            ${this.state.users.map(u => `
              <option value="${u.id}" ${this.state.filters.assigned_to === u.id ? 'selected' : ''}>${u.name}</option>
            `).join('')}
          </select>
        ` : ''}

        <div style="margin-left: auto; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <button class="btn-pill" onclick="App.openColumnSettingsModal()" title="Customize Visible Columns">
            ${Icons.settings ? Icons.settings(13) : Icons.edit(13)} Columns
          </button>

          <button class="btn-pill" onclick="App.generateAllTasks()" title="Auto-schedule next tasks for all leads using AI">
            ${Icons.sparkles(13)} Schedule
          </button>

          <button class="btn-pill" onclick="App.syncSheetPriorities()" title="Sync Latest Meta Leads & Priorities from Google Sheet">
            ${Icons.arrowRight(13)} Sync
          </button>

          <button id="leads-filter-reset-btn" class="btn-pill" onclick="App.clearFilters()" style="display: ${hasActiveFilter ? '' : 'none'}; color: var(--color-danger); border-color: rgba(239, 68, 68, 0.2);">
            ${Icons.close(12)} Reset
          </button>
        </div>
      </div>

      <div class="table-container ui-records-table">
        <div class="ui-table-topbar">
          <h2>All leads <span class="ui-table-count" id="leads-table-count">${filtered.length}</span></h2>
          <span class="ui-table-caption">Contact, prioritize, and follow through</span>
        </div>
        <div class="ui-table-scroll">
        <table class="table leads-table" aria-label="Leads and next actions" style="min-width: ${this.getLeadTableWidth()}px;">
          ${this.renderLeadColgroup()}
          <thead>
            <tr>
              ${this.renderTableHeaders()}
            </tr>
          </thead>
          <tbody id="leads-table-body">
            ${filtered.length > 0 ? filtered.map(lead => this.renderLeadRow(lead)).join('') : `
              <tr>
                <td colspan="${(this.state.visibleColumns || []).length || 10}" style="text-align: center; padding: 48px; color: var(--color-mid-gray);">
                  <div style="font-size: 15px; font-weight: 600; color: var(--color-ink); margin-bottom: 4px;">No leads found</div>
                  <p style="font-size: 13px;">${this.state.filters.search ? `No leads matching "${this.escapeHtml(this.state.filters.search)}"` : 'Create a new lead manually or ingest from Meta Ads webhook.'}</p>
                </td>
              </tr>
            `}
          </tbody>
        </table>
        </div>
      </div>
      </section>
    `;
  },

  updateFilter(key, value) {
    this.state.filters[key] = value;
    if (key === 'search') {
      if (this.renderLeadsTableBody()) {
        return;
      }
    }
    this.renderLeadsView();
    if (key === 'search') {
      const input = document.getElementById('lead-search-input');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  },

  clearFilters() {
    this.state.filters = { status: '', source: '', assigned_to: '', temperature: '', call_stage: '', priority: '', search: '' };
    this.renderLeadsView();
  },

  renderLeadRow(lead) {
    const assignedUser = (this.state.users || []).find(user => user.id === lead.assigned_to);
    const activeDeal = (this.state.deals || []).find(deal => deal.lead_id === lead.id);
    const isAdmin = this.state.currentUser?.role === 'admin';
    const textCell = (column, value, extraClass = '') => {
      const text = String(value ?? '').trim() || '—';
      return `<td data-column="${column}" class="${extraClass}"><span class="lead-cell-text" title="${this.escapeHtml(text)}">${this.escapeHtml(text)}</span></td>`;
    };
    const editableTextCell = (column, value, tooltipText, extraClass = '') => {
      const text = String(value ?? '').trim();
      const empty = !text || text === '—';
      return `<td data-column="${column}" class="${extraClass}" onclick="event.stopPropagation()"><button type="button" class="lead-inline-cell-btn" title="${this.escapeHtml(tooltipText || (empty ? 'Click to edit' : text))}" onclick="event.stopPropagation(); App.startLeadInlineEdit?.(this, '${lead.id}', '${column}')">${empty ? '<span class="lead-cell-empty">—</span>' : `<span class="lead-cell-text">${this.escapeHtml(text)}</span>`}</button></td>`;
    };
    const cells = (this.state.visibleColumns || []).map(column => {
      switch (column) {
        case 'contact':
          return `<td data-column="contact"><div class="lead-contact-cell"><button type="button" class="lead-name-link" title="Open ${this.escapeHtml(lead.name || 'Unnamed lead')}" onclick="event.stopPropagation(); App.viewLead('${lead.id}')">${this.escapeHtml(lead.name || 'Unnamed lead')}</button><button type="button" class="lead-open-hover-btn" title="Open lead record" aria-label="Open ${this.escapeHtml(lead.name || 'lead')}" onclick="event.stopPropagation(); App.viewLead('${lead.id}')">${Icons.arrowUpRight ? Icons.arrowUpRight(13) : Icons.chevronRight(13)}</button></div></td>`;
        case 'company':
          return textCell(column, lead.business_name || 'Individual / Personal');
        case 'phone':
          return textCell(column, lead.phone, 'lead-number');
        case 'email':
          return textCell(column, lead.email);
        case 'city':
          return textCell(column, lead.city);
        case 'inbound': return textCell(column, this.formatDateTime(lead.created_at));
        case 'inbound_age': return textCell(column, this.formatRelativeTime(lead.created_at));
        case 'priority':
          return `<td data-column="priority" onclick="event.stopPropagation()"><button type="button" class="lead-inline-cell-btn" aria-haspopup="listbox" title="Click to change Priority" onclick="event.stopPropagation(); App.openLeadInlinePopover?.(this, '${lead.id}', 'priority')">${this.getPriorityBadge(lead.priority)}</button></td>`;
        case 'next_task': {
          const step = this.getLeadNextStep(lead);
          return `
            <td data-column="next_task" onclick="event.stopPropagation()">
              <div class="lead-action-cell">
                <button type="button" class="lead-inline-cell-btn lead-next-action-trigger" aria-haspopup="dialog" title="${this.escapeHtml(step.text || 'Click to choose or type next action')}" onclick="event.stopPropagation(); App.openLeadInlinePopover?.(this, '${lead.id}', 'next_task')">
                  ${step.text ? `<span class="lead-cell-text next-step tone-${step.tone}">${this.escapeHtml(step.text)}</span>` : '<span class="lead-cell-empty">Set next action</span>'}
                </button>
                <button type="button" class="task-regen-btn" onclick="event.stopPropagation(); App.generateLeadTask('${lead.id}')" title="${lead.next_action ? 'Regenerate task with AI' : 'Auto-generate next task with AI'}">${Icons.refresh(14)}</button>
              </div>
            </td>`;
        }
        case 'task_due': {
          const call = this.getScheduledCall(lead);
          if (!call) {
            const fallback = (this.isPlaceholderAction(lead) ? '' : lead.next_action_date) || 'Pending';
            return `<td data-column="task_due" onclick="event.stopPropagation()"><button type="button" class="lead-inline-cell-btn" title="${this.escapeHtml(fallback)} (click to schedule IST call)" onclick="event.stopPropagation(); App.openScheduleCallModal('${lead.id}')"><span class="lead-cell-text">${this.escapeHtml(fallback)}</span></button></td>`;
          }
          return `<td data-column="task_due" onclick="event.stopPropagation()"><button type="button" class="lead-inline-cell-btn" title="Scheduled call, ${this.escapeHtml(this.formatCallDue(call))} (click to reschedule)" onclick="event.stopPropagation(); App.openScheduleCallModal('${lead.id}')"><span class="lead-cell-text call-due bucket-${this.getCallBucket(call)}">${Icons.phone(12)} ${this.escapeHtml(this.formatCallTime(call.at))}</span></button></td>`;
        }
        case 'internal_note':
          return `
            <td data-column="internal_note" onclick="event.stopPropagation()">
              <button type="button" class="lead-inline-cell-btn lead-inline-note-trigger" aria-haspopup="dialog"
                      title="${this.escapeHtml(lead.last_update_notes || 'Click to add internal note')}"
                      onclick="event.stopPropagation(); App.openLeadInlinePopover?.(this, '${lead.id}', 'internal_note')">
                ${lead.last_update_notes
                  ? `<span class="lead-cell-text">${this.escapeHtml(lead.last_update_notes)}</span>`
                  : '<span class="lead-cell-empty">Add note…</span>'}
              </button>
            </td>`;
        case 'upload_media':
          return `
            <td data-column="upload_media" onclick="event.stopPropagation()">
              <input type="file" id="inline-file-${lead.id}" accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov,.webm" style="display: none;" onchange="App.handleInlineUpload(event, '${lead.id}')">
              <button type="button" id="inline-upload-btn-${lead.id}" class="inline-upload-btn" onclick="document.getElementById('inline-file-${lead.id}').click()" title="Attach recording">${Icons.paperclip(14)}</button>
            </td>`;
        case 'temperature':
          return `<td data-column="temperature" onclick="event.stopPropagation()"><button type="button" class="lead-inline-cell-btn" aria-haspopup="listbox" title="Click to change Temperature" onclick="event.stopPropagation(); App.openLeadInlinePopover?.(this, '${lead.id}', 'temperature')">${this.getTemperatureBadge(lead.temperature)}</button></td>`;
        case 'call_stage':
          return `<td data-column="call_stage" onclick="event.stopPropagation()"><button type="button" class="lead-inline-cell-btn" aria-haspopup="listbox" title="Click to change Call Stage" onclick="event.stopPropagation(); App.openLeadInlinePopover?.(this, '${lead.id}', 'call_stage')">${this.getCallStageBadge(lead.call_stage)}</button></td>`;
        case 'source': return `<td data-column="source">${this.getSourceBadge(lead.source)}</td>`;
        case 'status':
          return `<td data-column="status" onclick="event.stopPropagation()"><button type="button" class="lead-inline-cell-btn" aria-haspopup="listbox" title="Click to change Status" onclick="event.stopPropagation(); App.openLeadInlinePopover?.(this, '${lead.id}', 'status')">${this.getStatusBadge(lead.status)}</button></td>`;
        case 'deal':
          return activeDeal ? `<td data-column="deal"><button type="button" class="lead-name-link" title="Open delivery deal" onclick="event.stopPropagation(); App.viewDeal('${activeDeal.id}')">${this.escapeHtml(activeDeal.title || 'Active delivery')}</button></td>` : textCell(column, '—');
        case 'deal_value':
          return editableTextCell(column, this.formatCurrency(lead.deal_value || 0), 'Click to edit estimated value', 'lead-number');
        case 'assigned_to':
          return isAdmin
            ? `<td data-column="assigned_to" onclick="event.stopPropagation()"><button type="button" class="lead-inline-cell-btn" aria-haspopup="listbox" title="Click to change Owner" onclick="event.stopPropagation(); App.openLeadInlinePopover?.(this, '${lead.id}', 'assigned_to')">${assignedUser?.name ? `<span class="lead-cell-text">${this.escapeHtml(assignedUser.name)}</span>` : '<span class="lead-cell-empty">Unassigned</span>'}</button></td>`
            : textCell(column, assignedUser?.name || 'Unassigned');
        case 'actions':
          return `<td data-column="actions" onclick="event.stopPropagation()"><button type="button" class="ui-row-action" onclick="App.viewLead('${lead.id}')" title="Open lead record">${Icons.chevronRight(16)}</button></td>`;
        default: return '';
      }
    }).join('');
    return `<tr data-lead-id="${lead.id}">${cells}</tr>`;
  },

  renderChannelIntelligenceCard(lead) {
    if (!lead) return '';
    const src = lead.source || 'manual';
    const ch = lead.channel_data || {};
    
    const hasMeta = src === 'meta_ads' || lead.meta_ad_name || lead.meta_form_id || ch.campaign_name || ch.ad_name;
    const hasScraping = src === 'scraping' && (ch.website || ch.linkedin_url || ch.industry || ch.scraped_query);
    const hasReferral = src === 'referral' && (ch.referred_by || ch.relationship);

    if (!hasMeta && !hasScraping && !hasReferral && Object.keys(ch).length === 0) {
      return '';
    }

    if (hasMeta) {
      const campaign = ch.campaign_name || 'Standard Meta Campaign';
      const adset = ch.adset_name || 'Default Audience Segment';
      const ad = ch.ad_name || lead.meta_ad_name || 'Lead Ad';
      const form = ch.form_name || (lead.meta_form_id ? `Form ID: ${lead.meta_form_id}` : 'Instant Form');
      const platform = ch.platform ? (ch.platform.toLowerCase().includes('instagram') ? 'Instagram' : 'Facebook') : 'Meta Ads';
      
      const creative = ch.creative || {};
      const thumbUrl = creative.thumbnail_url || creative.image_url;
      const creativeTitle = creative.title || ad;
      const creativeBody = creative.body || '';
      const formAnswers = ch.form_answers || [];

      const cardId = 'channel-intel-' + (lead.id || 'default');
      const adId = ch.ad_id || '';
      return `
        <div class="channel-intelligence-card">
          <div class="channel-card-header" style="cursor: pointer;" onclick="App.toggleChannelCard('${cardId}')">
            <div class="channel-card-title">
              ${Icons.target(14)} Meta Ads Attribution
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              ${thumbUrl ? `<img src="${this.escapeHtml(thumbUrl)}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;border:1px solid var(--color-hairline);" alt="Ad">` : ''}
              <span class="channel-source-tag" style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${platform} · ${this.escapeHtml(ad.length > 30 ? ad.substring(0,30) + '…' : ad)}
              </span>
              <span id="${cardId}-arrow" style="transition: transform 0.2s ease; display: inline-flex; align-items: center; transform: rotate(-90deg);">${Icons.chevronDown(12)}</span>
            </div>
          </div>
          <div id="${cardId}-body" style="display: none;">

          <div class="channel-meta-grid">
            <div class="channel-meta-pill">
              <div class="channel-meta-label">Submitted On</div>
              <div class="channel-meta-value" style="color: var(--color-ink); font-weight: 600;">${this.formatDateTime(lead.created_at)}</div>
            </div>
            <div class="channel-meta-pill">
              <div class="channel-meta-label">Campaign</div>
              <div class="channel-meta-value">${this.escapeHtml(campaign)}</div>
            </div>
            <div class="channel-meta-pill">
              <div class="channel-meta-label">Ad Set</div>
              <div class="channel-meta-value">${this.escapeHtml(adset)}</div>
            </div>
            <div class="channel-meta-pill">
              <div class="channel-meta-label">Ad Creative Name</div>
              <div class="channel-meta-value">${this.escapeHtml(ad)}</div>
            </div>
            <div class="channel-meta-pill">
              <div class="channel-meta-label">Inbound Form</div>
              <div class="channel-meta-value">${this.escapeHtml(form)}</div>
            </div>
          </div>

          <div id="${cardId}-creative-area">
            ${this.renderCreativeAreaContent(lead, ch, cardId)}
          </div>


          ${formAnswers && formAnswers.length > 0 ? `
            <div class="form-answers-section">
              <div class="form-answers-title">
                ${Icons.notepad(12)} Prospect Inbound Form Responses (${formAnswers.length})
              </div>
              <div class="form-qa-list">
                ${formAnswers.map(qa => `
                  <div class="form-qa-row" title="Form field: ${this.escapeHtml(qa.question || '')}">
                    <span class="form-qa-q">${this.escapeHtml(this.formatFormQuestion(qa.question, qa.answer))}</span>
                    <span class="form-qa-a">${this.escapeHtml(this.formatFormAnswer(qa.answer))}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          </div>
        </div>
      `;
    }

    if (hasScraping) {
      const cardId = 'channel-intel-' + (lead.id || 'default') + '-scraping';
      return `
        <div class="channel-intelligence-card">
          <div class="channel-card-header" style="cursor: pointer;" onclick="App.toggleChannelCard('${cardId}')">
            <div class="channel-card-title">
              ${Icons.globe(14)} B2B Scraping Intelligence
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="channel-source-tag">Scraped Source</span>
              <span id="${cardId}-arrow" style="transition: transform 0.2s ease; display: inline-flex; align-items: center; transform: rotate(-90deg);">${Icons.chevronDown(12)}</span>
            </div>
          </div>
          <div id="${cardId}-body" style="display: none;">

          <div class="channel-meta-grid">
            ${ch.website ? `
              <div class="channel-meta-pill">
                <div class="channel-meta-label">Website</div>
                <div class="channel-meta-value">
                  <a href="${this.escapeHtml(ch.website.startsWith('http') ? ch.website : 'https://' + ch.website)}" target="_blank" style="color: var(--color-ink); text-decoration: underline; display: inline-flex; align-items: center; gap: 4px;">
                    ${this.escapeHtml(ch.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))} ${Icons.externalLink(11)}
                  </a>
                </div>
              </div>
            ` : ''}
            ${ch.linkedin_url ? `
              <div class="channel-meta-pill">
                <div class="channel-meta-label">LinkedIn</div>
                <div class="channel-meta-value">
                  <a href="${this.escapeHtml(ch.linkedin_url.startsWith('http') ? ch.linkedin_url : 'https://' + ch.linkedin_url)}" target="_blank" style="color: var(--color-ink); text-decoration: underline; display: inline-flex; align-items: center; gap: 4px;">
                    Company Profile ${Icons.externalLink(11)}
                  </a>
                </div>
              </div>
            ` : ''}
            ${ch.industry ? `
              <div class="channel-meta-pill">
                <div class="channel-meta-label">Industry</div>
                <div class="channel-meta-value">${this.escapeHtml(ch.industry)}</div>
              </div>
            ` : ''}
            ${ch.scraped_query ? `
              <div class="channel-meta-pill">
                <div class="channel-meta-label">Scraped Query</div>
                <div class="channel-meta-value">${this.escapeHtml(ch.scraped_query)}</div>
              </div>
            ` : ''}
          </div>
          </div>
        </div>
      `;
    }

    if (hasReferral) {
      const cardId = 'channel-intel-' + (lead.id || 'default') + '-referral';
      return `
        <div class="channel-intelligence-card">
          <div class="channel-card-header" style="cursor: pointer;" onclick="App.toggleChannelCard('${cardId}')">
            <div class="channel-card-title">
              ${Icons.user(14)} Referral Background
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="channel-source-tag">Referral</span>
              <span id="${cardId}-arrow" style="transition: transform 0.2s ease; display: inline-flex; align-items: center; transform: rotate(-90deg);">${Icons.chevronDown(12)}</span>
            </div>
          </div>
          <div id="${cardId}-body" style="display: none;">

          <div class="channel-meta-grid">
            <div class="channel-meta-pill">
              <div class="channel-meta-label">Referred By</div>
              <div class="channel-meta-value">${this.escapeHtml(ch.referred_by || 'Unknown')}</div>
            </div>
            ${ch.relationship ? `
              <div class="channel-meta-pill">
                <div class="channel-meta-label">Relationship / Context</div>
                <div class="channel-meta-value">${this.escapeHtml(ch.relationship)}</div>
              </div>
            ` : ''}
          </div>
          </div>
        </div>
      `;
    }

    return '';
  },

  // ---------------- AI INTELLIGENCE & PROTOTYPE STUDIO ----------------

  renderCompanyBriefCard(lead) {
    if (!lead) return '';
    const brief = lead.company_brief || (this.state.companyBriefs && this.state.companyBriefs[lead.id]);
    const cardId = 'company-brief-' + lead.id;

    if (!brief) {
      return `
        <div class="company-brief-card" id="${cardId}">
          <div class="brief-header">
            <div class="brief-title">
              ${Icons.sparkles(15)} Company Intelligence & Strategic Brief
            </div>
            <span class="brief-badge">AI Solutions Architect</span>
          </div>
          <div style="text-align: center; padding: 24px 16px; background: var(--color-surface-alt); border-radius: var(--radius-sm); border: 1px dashed var(--color-hairline);">
            <div style="font-size: 13px; color: var(--color-mid-gray); margin-bottom: 12px;">
              No company analysis generated yet for <strong>${this.escapeHtml(lead.name || 'this lead')}</strong>.
            </div>
            <button type="button" class="btn btn-primary btn-sm" id="btn-analyze-${lead.id}" onclick="App.reAnalyzeLeadAI('${lead.id}')">
              ${Icons.sparkles(13)} Generate AI Strategic Brief &rarr;
            </button>
          </div>
        </div>
      `;
    }

    const tags = Array.isArray(brief.industry_tags) ? brief.industry_tags : [];

    return `
      <div class="company-brief-card" id="${cardId}">
        <div class="brief-header">
          <div class="brief-title">
            ${Icons.sparkles(15)} Company Intelligence & Strategic Brief
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="brief-badge">AI Solutions Architect</span>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-reanalyze-${lead.id}" style="padding: 3px 8px; font-size: 11px;" onclick="App.reAnalyzeLeadAI('${lead.id}')" title="Re-run AI research">
              ${Icons.refresh(12)} Refresh Brief
            </button>
          </div>
        </div>

        <!-- Executive Summary -->
        <div class="brief-summary-box">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--color-mid-gray); margin-bottom: 4px; letter-spacing: 0.4px;">
            Executive Synthesis
          </div>
          ${this.escapeHtml(brief.executive_summary || 'Business profile analysis.')}
        </div>

        <!-- Two column: Bottlenecks vs Opportunity -->
        <div class="brief-columns-grid">
          <div class="brief-box brief-box-bottlenecks">
            <div class="brief-box-title">
              ${Icons.alert(13)} Current Operational Bottlenecks
            </div>
            <div>${this.escapeHtml(brief.operational_bottlenecks || 'Manual tracking gaps.')}</div>
          </div>
          <div class="brief-box brief-box-opportunity">
            <div class="brief-box-title">
              ${Icons.target(13)} Zero7 Solution Vector
            </div>
            <div>${this.escapeHtml(brief.zero7_opportunity || 'Custom ERP & workflow automation.')}</div>
          </div>
        </div>

        <!-- Tech Architecture & Estimated Budget Strip -->
        <div class="brief-meta-strip">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <strong style="color: var(--color-ink);">Recommended Stack:</strong>
            <span style="color: var(--color-mid-gray);">${this.escapeHtml(brief.recommended_tech || 'Web Portal + PostgreSQL + WhatsApp API')}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${brief.estimated_budget ? `
              <span style="background: var(--color-purple-light); color: var(--color-purple); border: 1px solid var(--color-hairline); padding: 2px 10px; border-radius: var(--radius-pill); font-weight: 600; font-size: 11.5px;">
                Est. Tier: ${this.escapeHtml(brief.estimated_budget)}
              </span>
            ` : ''}
            ${tags.map(t => `<span class="badge badge-secondary" style="font-size: 10.5px;">${this.escapeHtml(t)}</span>`).join('')}
          </div>
        </div>

        <!-- Opening Pitch Hook with 1-click Copy -->
        ${brief.pitch_hook ? `
          <div class="brief-pitch-card">
            <div class="brief-pitch-header">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--color-ink-muted); display: flex; align-items: center; gap: 5px;">
                ${Icons.whatsapp(12)} High-Converting Outreach Hook
              </span>
              <button type="button" class="btn btn-secondary btn-sm" style="border-radius: var(--radius-pill); padding: 3px 10px; font-size: 11px;" onclick="App.copyPitchHook(decodeURIComponent('${encodeURIComponent(brief.pitch_hook)}'))">
                ${Icons.copy(11)} Copy Pitch
              </button>
            </div>
            <div class="brief-pitch-text">
              "${this.escapeHtml(brief.pitch_hook)}"
            </div>
          </div>
        ` : ''}
      </div>
    `;
  },

  renderPrototypeStudio(lead) {
    if (!lead) return '';
    const protos = (this.state.leadPrototypes && this.state.leadPrototypes[lead.id]) || [];
    const activeProto = protos.length > 0 ? protos[0] : null;
    const shareToken = activeProto?.share_token || '';
    const shareUrl = shareToken ? `${window.location.origin}/api/public/prototype/${shareToken}` : '';
    const cleanPhone = (lead.phone || '').replace(/[^0-9+]/g, '');
    const waPhone = cleanPhone.startsWith('+') ? cleanPhone.replace('+', '') : (cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone);

    return `
      <div class="prototype-studio-card" id="proto-studio-${lead.id}">
        <div class="brief-header">
          <div>
            <div class="brief-title">
              ${Icons.code(16)} AI Solution Studio: Let's Build a Prototype
            </div>
            <div style="font-size: 12px; color: var(--color-mid-gray); margin-top: 2px;">
              Rapid interactive prototype generator & client pitch demo
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${activeProto ? `
              <span class="badge badge-success" style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
                ${Icons.checkCircle(12)} Prototype Ready (${this.escapeHtml(activeProto.title || 'Demo')})
              </span>
            ` : `
              <span class="badge badge-secondary" style="font-size: 11px;">
                Ready to Ideate
              </span>
            `}
          </div>
        </div>

        <div class="proto-studio-layout">
          <!-- Left Pane: Conversational Copilot -->
          <div class="proto-chat-pane">
            <div class="proto-chat-messages" id="proto-chat-messages-${lead.id}">
              <div class="proto-msg proto-msg-assistant">
                ${Icons.sparkles(13)} <strong>Hi team!</strong> I can build a working interactive prototype for <strong>${this.escapeHtml(lead.business_name || lead.name)}</strong>.
                What workflow should we design for them? Pick a prompt or type your custom idea below:
              </div>
              ${(activeProto?.conversation_history || []).map(msg => `
                <div class="proto-msg proto-msg-${msg.role === 'user' ? 'user' : 'assistant'}">
                  ${this.escapeHtml(msg.content)}
                </div>
              `).join('')}
            </div>

            <!-- Pre-configured Suggestion Pills -->
            <div class="proto-prompt-pills">
              <span class="proto-pill" onclick="App.applyPrototypePrompt('${lead.id}', 'Build an interactive order & production management portal for ${this.escapeHtml(lead.business_name || 'this business')}')">
                ${Icons.package(13)} Order & Production Portal
              </span>
              <span class="proto-pill" onclick="App.applyPrototypePrompt('${lead.id}', 'Create a real-time dispatch and stock tracking app replacing Excel')">
                ${Icons.truck(13)} Dispatch & Stock Tracker
              </span>
              <span class="proto-pill" onclick="App.applyPrototypePrompt('${lead.id}', 'Design a client ordering dashboard with WhatsApp invoice sharing')">
                ${Icons.whatsapp(13)} WhatsApp Order Dashboard
              </span>
              <span class="proto-pill" onclick="App.applyPrototypePrompt('${lead.id}', 'Generate a formal Scope of Work and quote estimate for MVP')">
                ${Icons.fileText(13)} Scope of Work & Quote
              </span>
            </div>

            <!-- Input Bar -->
            <form class="proto-chat-input-bar" onsubmit="App.handleSendPrototypeChat(event, '${lead.id}')">
              <input type="text" id="proto-input-${lead.id}" class="input" style="font-size: 12.5px; height: 36px;" placeholder="e.g. Build an inventory & billing dashboard..." autocomplete="off">
              <button type="submit" class="btn btn-primary btn-sm" id="proto-btn-${lead.id}" style="height: 36px; padding: 0 14px;">
                ${Icons.arrowRight(14)}
              </button>
            </form>
          </div>

          <!-- Right Pane: Live Sandboxed Prototype Preview -->
          <div class="proto-preview-pane">
            <div class="proto-preview-topbar">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div class="proto-viewport-toggles">
                  <button type="button" class="proto-vp-btn active" id="btn-vp-desktop-${lead.id}" onclick="App.setPrototypeViewport('${lead.id}', 'desktop')">
                    ${Icons.monitor(12)} Desktop
                  </button>
                  <button type="button" class="proto-vp-btn" id="btn-vp-mobile-${lead.id}" onclick="App.setPrototypeViewport('${lead.id}', 'mobile')">
                    ${Icons.smartphone(12)} Mobile
                  </button>
                </div>
                <span style="font-size: 11.5px; color: #94a3b8;" id="proto-title-label-${lead.id}">
                  ${this.escapeHtml(activeProto?.title || 'Interactive Concept Demo')}
                </span>
              </div>

              <div style="display: flex; align-items: center; gap: 6px;">
                ${shareToken ? `
                  <button type="button" class="btn btn-secondary btn-sm" style="background: #1e293b; color: #e2e8f0; border-color: #334155; padding: 3px 8px; font-size: 11px;" onclick="App.copyShareableLink('${shareToken}')" title="Copy public link">
                    ${Icons.externalLink(12)} Share Link
                  </button>
                  <a href="https://wa.me/${waPhone}?text=${encodeURIComponent(`Hi ${lead.name}! Our team at Zero7 built an interactive prototype tailored for ${lead.business_name || 'your business'}: ${shareUrl}. Would love your feedback!`)}" target="_blank" class="btn btn-sm" style="background: #059669; color: #ffffff; padding: 3px 8px; font-size: 11px; text-decoration: none;">
                    ${Icons.whatsapp(12)} Pitch on WA
                  </a>
                  <a href="/api/public/prototype/${shareToken}" target="_blank" class="btn btn-secondary btn-sm" style="background: #1e293b; color: #e2e8f0; border-color: #334155; padding: 3px 8px; font-size: 11px; display: inline-flex; align-items: center;" title="Open in new tab">
                    ${Icons.externalLink(11)}
                  </a>
                ` : `
                  <span style="font-size: 11px; color: #64748b;">Preview will appear after generation</span>
                `}
              </div>
            </div>

            <!-- Iframe Sandbox -->
            <div class="proto-iframe-wrapper">
              ${shareToken ? `
                <iframe src="/api/public/prototype/${shareToken}/raw" id="proto-iframe-${lead.id}" class="proto-iframe" sandbox="allow-scripts allow-forms allow-same-origin allow-modals"></iframe>
              ` : `
                <div style="text-align: center; color: #94a3b8; padding: 30px;">
                  <div style="margin-bottom: 12px; color: #3b82f6;">${Icons.zap(32)}</div>
                  <div style="font-size: 14px; font-weight: 600; color: #e2e8f0; margin-bottom: 4px;">Live Interactive Sandbox</div>
                  <div style="font-size: 12px; color: #64748b; max-width: 320px; margin: 0 auto 16px auto;">
                    Type a prompt on the left to build a fully working, interactive UI prototype for this client.
                  </div>
                  <button type="button" class="btn btn-primary btn-sm" onclick="App.applyPrototypePrompt('${lead.id}', 'Build an interactive operations dashboard for ${this.escapeHtml(lead.business_name || lead.name)}')">
                    ${Icons.sparkles(12)} Build First Prototype &rarr;
                  </button>
                </div>
              `}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  async loadCompanyBrief(leadId) {
    if (!leadId) return;
    try {
      if (!this.state.companyBriefs) this.state.companyBriefs = {};
      const brief = await API.get(`/api/leads/${leadId}/ai/brief`);
      if (brief) {
        this.state.companyBriefs[leadId] = brief;
        const container = document.getElementById(`company-brief-container-${leadId}`);
        if (container && this.state.selectedLead && this.state.selectedLead.id === leadId) {
          container.innerHTML = this.renderCompanyBriefCard(this.state.selectedLead);
        }
        if (this.state.activeLeadTab === 'agent' && document.getElementById('agent-deliverables-pipeline-container')) {
          this.renderDeliverablesPipeline(this.state.selectedLead);
        }
      }
    } catch (e) {
      console.warn('Could not auto-load company brief:', e);
    }
  },

  async reAnalyzeLeadAI(leadId) {
    const btn = document.getElementById(`btn-reanalyze-${leadId}`) || document.getElementById(`btn-analyze-${leadId}`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span style="display:inline-block;animation:spin 1s linear infinite;">${Icons.loader(14)}</span> Analyzing...`;
    }
    try {
      API.showToast('Research Agent analyzing company & market context...', 'info');
      const brief = await API.post(`/api/leads/${leadId}/ai/research`);
      if (!this.state.companyBriefs) this.state.companyBriefs = {};
      this.state.companyBriefs[leadId] = brief;
      API.showToast('Company Brief generated successfully!', 'success');
      const container = document.getElementById(`company-brief-container-${leadId}`);
      if (container && this.state.selectedLead && this.state.selectedLead.id === leadId) {
        container.innerHTML = this.renderCompanyBriefCard(this.state.selectedLead);
      }
      if (this.state.activeLeadTab === 'agent' && document.getElementById('agent-deliverables-pipeline-container')) {
        this.renderDeliverablesPipeline(this.state.selectedLead);
      }
    } catch (e) {
      API.showToast('AI Research failed: ' + (e.message || 'Unknown error'), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${Icons.refresh(12)} Refresh Brief`;
      }
    }
  },

  copyPitchHook(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      API.showToast('Outreach hook copied to clipboard!', 'success');
    }).catch(() => {
      API.showToast('Could not copy to clipboard', 'error');
    });
  },

  async openFounderHandoffModal(leadId) {
    if (!leadId) return;
    const lead = (this.state.leads || []).find(l => l.id === leadId) || this.state.selectedLead;
    const clientName = lead ? (lead.business_name || lead.name) : 'Client';

    // Show initial loading state in modal
    const loadingHtml = `
      <div style="padding: 32px; text-align: center; max-width: 580px; margin: 0 auto;">
        <div style="width: 44px; height: 44px; border-radius: 8px; background: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
          ${Icons.zap(20)}
        </div>
        <h3 style="font-size: 17px; font-weight: 600; color: var(--color-ink); margin: 0 0 8px 0;">Synthesizing 60-Second Founder Handoff</h3>
        <p style="font-size: 13px; color: var(--color-mid-gray); margin: 0; line-height: 1.5;">
          Scanning WhatsApp history, call transcripts, active prototypes, and commitments for <strong>${this.escapeHtml(clientName)}</strong>...
        </p>
      </div>
    `;
    this.openModal(loadingHtml);

    try {
      const data = await API.post(`/api/leads/${leadId}/ai/catch-me-up`, {});
      if (!data) throw new Error('No debrief data returned');

      const commitmentsHtml = (data.commitments_pending || []).length > 0
        ? data.commitments_pending.map(c => `
            <div style="display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--color-ink); margin-bottom: 6px;">
              <span style="color: #f59e0b; display: inline-flex; align-items: center; margin-top: 2px;">${Icons.clock(13)}</span>
              <span>${this.escapeHtml(c)}</span>
            </div>
          `).join('')
        : '<p style="font-size: 12.5px; color: var(--color-mid-gray); margin: 0;">No outstanding commitments recorded.</p>';

      const talkingPointsHtml = (data.three_talking_points || []).map((tp, idx) => `
        <div style="background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div style="display: flex; align-items: flex-start; gap: 8px;">
            <span style="background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); width: 20px; height: 20px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0; margin-top: 2px;">${idx + 1}</span>
            <span style="font-size: 13px; color: var(--color-ink); line-height: 1.4;">${this.escapeHtml(tp)}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-xs" onclick="navigator.clipboard.writeText('${this.escapeHtml(tp).replace(/'/g, "\\'")}'); API.showToast('Copied talking point!', 'success');" style="flex-shrink: 0; border-radius: 6px; padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" title="Copy to clipboard">
            ${Icons.copy(12)} Copy
          </button>
        </div>
      `).join('');

      const watchOutsHtml = (data.watch_outs || []).map(w => `
        <div style="display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; color: #b45309; margin-bottom: 4px;">
          <span style="display: inline-flex; align-items: center; margin-top: 1px;">${Icons.alert(13)}</span>
          <span>${this.escapeHtml(w)}</span>
        </div>
      `).join('');

      const resultHtml = `
        <div style="max-width: 680px; padding: 6px;">
          <!-- Header Strip -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--color-hairline); padding-bottom: 16px; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 40px; height: 40px; border-radius: 8px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); display: flex; align-items: center; justify-content: center; font-weight: 600;">
                ${Icons.zap(18)}
              </div>
              <div>
                <h3 style="font-size: 17px; font-weight: 600; color: var(--color-ink); margin: 0; letter-spacing: -0.025em;">
                  Founder Handoff: ${this.escapeHtml(clientName)}
                </h3>
                <p style="font-size: 12px; color: var(--color-mid-gray); margin: 3px 0 0 0;">
                  60-Second Pre-Call Briefing &bull; 100% Shared Context
                </p>
              </div>
            </div>
            <button type="button" class="btn btn-secondary btn-xs" onclick="App.closeModal()" style="border-radius: 6px; padding: 4px 8px; display: inline-flex; align-items: center;">${Icons.close(14)}</button>
          </div>

          <!-- Section 1: Executive 60-Second Summary -->
          <div style="background: hsl(var(--muted) / 0.4); border: 1px solid hsl(var(--border)); border-radius: 8px; padding: 14px 16px; margin-bottom: 16px;">
            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: hsl(var(--muted-foreground)); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
              ${Icons.zap(12)} 60-Second Briefing
            </div>
            <p style="font-size: 13.5px; color: var(--color-ink); margin: 0; line-height: 1.5; font-weight: 500;">
              ${this.escapeHtml(data.summary_60s || 'No summary available')}
            </p>
          </div>

          <!-- Section 2: Last Interaction & Pending Commitments -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px;">
            <div style="background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: 12px; padding: 14px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--color-mid-gray); margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
                ${Icons.phone(12)} Last Activity
              </div>
              <p style="font-size: 12.5px; color: var(--color-ink); margin: 0; line-height: 1.4;">
                ${this.escapeHtml(data.last_activity || 'No recent activity')}
              </p>
            </div>
            <div style="background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: 12px; padding: 14px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--color-mid-gray); margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
                ${Icons.clock(12)} What Client Expects Next
              </div>
              ${commitmentsHtml}
            </div>
          </div>

          <!-- Section 3: 3 Killer Talking Points -->
          <div style="margin-bottom: 16px;">
            <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-ink); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
              ${Icons.target(13)} 3 Talking Points to Lead Conversation
            </div>
            ${talkingPointsHtml}
          </div>

          <!-- Section 4: Watch-Outs -->
          ${watchOutsHtml ? `
            <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 10px; padding: 10px 14px; margin-bottom: 16px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #b45309; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                ${Icons.alert(12)} Watch-Outs / Objections to Navigate
              </div>
              ${watchOutsHtml}
            </div>
          ` : ''}

          <!-- Footer Actions -->
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-hairline); padding-top: 14px; margin-top: 10px;">
            <div style="font-size: 12.5px; color: var(--color-mid-gray);">
              <strong>Next Action:</strong> ${this.escapeHtml(data.recommended_next_action || 'Follow up with client')}
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="App.openFounderHandoffModal('${leadId}')" title="Re-synthesize briefing" style="display: inline-flex; align-items: center; gap: 4px;">
                ${Icons.refresh(12)} Re-run
              </button>
              <button type="button" class="btn btn-primary btn-sm" onclick="App.closeModal()" style="display: inline-flex; align-items: center; gap: 4px;">
                ${Icons.check(12)} Ready for Call
              </button>
            </div>
          </div>
        </div>
      `;
      this.openModal(resultHtml);
    } catch (err) {
      console.error('Founder handoff error:', err);
      API.showToast('Could not generate Founder Handoff: ' + (err.message || 'Server error'), 'error');
      this.closeModal();
    }
  },

  async provisionGitHubVault(leadId) {
    if (!leadId) return;
    try {
      API.showToast('Provisioning GitHub Vault & local project folder...', 'info');
      const res = await API.post(`/api/leads/${leadId}/github/provision`, {});
      if (res && res.success) {
        API.showToast('Universal GitHub Vault provisioned successfully!', 'success');
        const updated = await API.get(`/api/leads/${leadId}`);
        if (updated) {
          this.state.selectedLead = updated;
          const idx = (this.state.leads || []).findIndex(l => l.id === leadId);
          if (idx !== -1) this.state.leads[idx] = updated;
          this.renderLeadDetailPage();
        }
      } else {
        API.showToast('Failed to provision vault: ' + (res.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      console.error('GitHub vault error:', err);
      API.showToast('Error provisioning GitHub Vault: ' + (err.message || 'Server error'), 'error');
    }
  },

  async loadPrototypes(leadId) {
    if (!leadId) return;
    try {
      if (!this.state.leadPrototypes) this.state.leadPrototypes = {};
      const list = await API.get(`/api/leads/${leadId}/ai/prototypes`);
      if (list && list.length > 0) {
        const full = await API.get(`/api/leads/${leadId}/ai/prototypes/${list[0].id}`);
        this.state.leadPrototypes[leadId] = [full];
        const container = document.getElementById(`prototype-studio-container-${leadId}`);
        if (container && this.state.selectedLead && this.state.selectedLead.id === leadId) {
          container.innerHTML = this.renderPrototypeStudio(this.state.selectedLead);
        }
        if (this.state.activeLeadTab === 'agent' && document.getElementById('agent-deliverables-pipeline-container')) {
          this.renderDeliverablesPipeline(this.state.selectedLead);
        }
      }
    } catch (e) {
      console.warn('Could not auto-load prototypes:', e);
    }
  },

  applyPrototypePrompt(leadId, promptText) {
    const input = document.getElementById(`proto-input-${leadId}`);
    if (input) {
      input.value = promptText;
      input.focus();
    }
  },

  async handleSendPrototypeChat(event, leadId) {
    if (event) event.preventDefault();
    const input = document.getElementById(`proto-input-${leadId}`);
    const btn = document.getElementById(`proto-btn-${leadId}`);
    const message = input ? input.value.trim() : '';
    if (!message) return;

    const chatBox = document.getElementById(`proto-chat-messages-${leadId}`);
    if (chatBox) {
      chatBox.innerHTML += `
        <div class="proto-msg proto-msg-user">${this.escapeHtml(message)}</div>
        <div class="proto-msg proto-msg-assistant" id="proto-loading-${leadId}">
          <span style="display:inline-block;animation:spin 1s linear infinite;">${Icons.loader(14)}</span> Designing interactive prototype with Gemini 3.7 Tiered...
        </div>
      `;
      chatBox.scrollTop = chatBox.scrollHeight;
    }

    if (input) input.value = '';
    if (btn) btn.disabled = true;

    try {
      const activeProto = (this.state.leadPrototypes && this.state.leadPrototypes[leadId] && this.state.leadPrototypes[leadId][0]) || null;
      const payload = {
        message: message,
        prototype_id: activeProto?.id || null
      };

      const res = await API.post(`/api/leads/${leadId}/ai/prototype/chat`, payload);

      if (!this.state.leadPrototypes) this.state.leadPrototypes = {};
      this.state.leadPrototypes[leadId] = [res];

      API.showToast('Interactive prototype updated!', 'success');

      const container = document.getElementById(`prototype-studio-container-${leadId}`);
      if (container && this.state.selectedLead && this.state.selectedLead.id === leadId) {
        container.innerHTML = this.renderPrototypeStudio(this.state.selectedLead);
      }
    } catch (err) {
      API.showToast('Prototype generation failed: ' + (err.message || 'Error'), 'error');
      const loader = document.getElementById(`proto-loading-${leadId}`);
      if (loader) {
        loader.innerHTML = `<span style="display:inline-flex; align-items:center; gap:4px; color:var(--color-danger);">${Icons.alert(14)} Generation failed: ${this.escapeHtml(err.message || 'Please try again')}</span>`;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  setPrototypeViewport(leadId, mode) {
    const iframe = document.getElementById(`proto-iframe-${leadId}`);
    const btnDesk = document.getElementById(`btn-vp-desktop-${leadId}`);
    const btnMob = document.getElementById(`btn-vp-mobile-${leadId}`);
    if (!iframe) return;

    if (mode === 'mobile') {
      iframe.classList.add('mobile-mode');
      if (btnMob) btnMob.classList.add('active');
      if (btnDesk) btnDesk.classList.remove('active');
    } else {
      iframe.classList.remove('mobile-mode');
      if (btnDesk) btnDesk.classList.add('active');
      if (btnMob) btnMob.classList.remove('active');
    }
  },

  copyShareableLink(token) {
    if (!token) return;
    const url = `${window.location.origin}/api/public/prototype/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      API.showToast('Public prototype link copied to clipboard!', 'success');
    }).catch(() => {
      API.showToast('Could not copy link', 'error');
    });
  },

  openCreativeModal(leadId) {
    const lead = this.state.selectedLead || this.state.leads.find(l => l.id === leadId);
    if (!lead || !lead.channel_data) return;

    const ch = lead.channel_data;
    const cr = ch.creative || {};
    const imgUrl = cr.image_url || cr.thumbnail_url;
    const streamUrl = cr.stream_url || cr.preview_link;
    const isVideo = cr.is_video === true || (cr.filename && (cr.filename.endsWith('.mp4') || cr.filename.endsWith('.mov') || cr.filename.endsWith('.webm')));
    const title = cr.title || ch.ad_name || lead.meta_ad_name || 'Meta Ad Creative';
    const body = cr.body || '';
    const driveUrl = cr.web_view_link || 'https://drive.google.com/drive/folders/1dwX-XZ9QqH5IXKVKhn9_NCvbiDqTUNjj';

    const modalHtml = `
      <div id="creative-modal-overlay" class="creative-modal-overlay" onclick="if(event.target === this) App.closeCreativeModal()">
        <div class="creative-modal-content" style="max-width: 620px;">
          <div class="creative-modal-header">
            <div style="font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px;">
              ${isVideo ? Icons.video(16) : Icons.image(16)} Ad Creative & Copy Preview
            </div>
            <button class="btn btn-secondary btn-sm" onclick="App.closeCreativeModal()" style="padding: 4px 8px;">
              ${Icons.close(14)}
            </button>
          </div>
          <div class="creative-modal-body">
            ${isVideo && streamUrl ? `
              <div style="background: #000; border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 14px; text-align: center;">
                <video src="${this.escapeHtml(streamUrl)}" controls autoplay playsinline style="max-height: 440px; width: 100%; object-fit: contain; display: block;"></video>
              </div>
            ` : (imgUrl ? `
              <div style="background: #0f172a; border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 14px; text-align: center;">
                <img src="${this.escapeHtml(imgUrl)}" class="creative-modal-img" alt="Ad Preview" style="max-height: 440px; width: auto; max-width: 100%; object-fit: contain; margin: 0 auto; display: block;">
              </div>
            ` : `
              <div style="padding: 28px 16px; text-align: center; background: var(--color-surface-alt); border-radius: var(--radius-sm); border: 1px dashed var(--color-hairline); margin-bottom: 14px;">
                <div style="margin-bottom: 8px;">${Icons.folder(32)}</div>
                <div style="font-weight: 600; font-size: 13.5px; color: var(--color-ink);">No creative file attached yet</div>
                <div style="font-size: 12px; color: var(--color-mid-gray); margin-top: 4px; max-width: 380px; margin-left: auto; margin-right: auto;">
                  Drop your real ad video/graphic into your Google Drive folder <strong>CRM Meta Ads Sync</strong> or upload it below.
                </div>
                <div style="display: flex; gap: 8px; justify-content: center; margin-top: 14px;">
                  <button type="button" class="btn btn-primary btn-sm" onclick="App.uploadCreativeForLead('${lead.id}', '${this.escapeHtml(title)}')">
                    ${Icons.upload(12)} Upload File
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.open('${driveUrl}', '_blank')">
                    ${Icons.folder(12)} Open in Drive
                  </button>
                </div>
              </div>
            `)}
            <div style="margin-bottom: 14px;">
              <span class="badge" style="font-size: 11px; margin-bottom: 6px; display: inline-block;">${this.escapeHtml(ch.platform || 'Instagram / Facebook')}</span>
              <h3 style="font-size: 16px; font-weight: 600; margin-top: 6px; margin-bottom: 8px;">${this.escapeHtml(title)}</h3>
              ${body ? `
                <div style="font-size: 13px; color: var(--color-ink-soft); line-height: 1.5; white-space: pre-line; background: var(--color-surface-alt); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--color-hairline);">
                  ${this.escapeHtml(body)}
                </div>
              ` : `
                <div style="font-size: 12px; color: var(--color-mid-gray); font-style: italic;">No ad copy text recorded.</div>
              `}
            </div>
            <div style="font-size: 12px; color: var(--color-mid-gray); display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--color-hairline); padding-top: 10px;">
              <div><strong>Campaign:</strong> ${this.escapeHtml(ch.campaign_name || 'N/A')}</div>
              <div><strong>Ad Set:</strong> ${this.escapeHtml(ch.adset_name || 'N/A')}</div>
              ${ch.ad_id ? `<div><strong>Meta Ad ID:</strong> <code>${this.escapeHtml(ch.ad_id)}</code></div>` : ''}
              <div style="margin-top: 6px; display: flex; gap: 8px;">
                <button type="button" class="btn btn-secondary btn-sm" style="padding: 3px 8px; font-size: 11px;" onclick="window.open('${driveUrl}', '_blank')">
                  ${Icons.folder(12)} Open in Google Drive &rarr;
                </button>
                <button type="button" class="btn btn-secondary btn-sm" style="padding: 3px 8px; font-size: 11px;" onclick="App.closeCreativeModal(); App.uploadCreativeForLead('${lead.id}', '${this.escapeHtml(title)}')">
                  ${Icons.upload(12)} Upload / Replace Asset
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
  },

  closeCreativeModal() {
    const modal = document.getElementById('creative-modal-overlay');
    if (modal) modal.remove();
  },

  // ---------------- 2. FULL LEAD RECORD PAGE ----------------

  renderLeadDetailPage() {
    const container = document.getElementById('page-content');
    const lead = this.state.selectedLead;
    if (!container || !lead) return;

    const activity = lead.activity || [];
    const cleanPhone = (lead.phone || '').replace(/[^0-9+]/g, '');
    const waPhone = cleanPhone.startsWith('+') ? cleanPhone.replace('+', '') : (cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone);
    const activeDeal = (this.state.deals || []).find(d => d.lead_id === lead.id);

    container.innerHTML = `
      <div class="record-page">
        <!-- Header Strip: Lead Info on Left, Segmented Tabs on Right -->
        <div class="record-header-strip" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; gap: 16px; flex-wrap: wrap;">
          <div>
            <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
              <h1 style="font-size: 24px; font-weight: 700; letter-spacing: -0.5px; color: var(--color-ink); margin: 0;">${this.escapeHtml(lead.name || 'Unnamed')}</h1>
              ${this.getPriorityBadge(lead.priority)}
              ${this.getTemperatureBadge(lead.temperature)}
              ${activeDeal ? `
                <button type="button" class="btn btn-secondary btn-xs" onclick="App.viewDeal('${activeDeal.id}')" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; background: rgba(37, 99, 235, 0.08); color: #2563eb; border-color: rgba(37, 99, 235, 0.25); border-radius: 12px; padding: 2px 10px; cursor: pointer;" title="View in Deals Delivery Hub">
                  ${Icons.briefcase(11)} Deal: ${this.formatCurrency((activeDeal.value || 0))} &bull; ${(activeDeal.delivery_stage || 'in_development').toUpperCase()} &rarr;
                </button>
              ` : ''}
            </div>
            <div style="color: var(--color-mid-gray); font-size: 13.5px; margin-top: 6px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
              <span style="font-weight: 600; color: var(--color-ink);">${this.escapeHtml(lead.business_name || 'No business name')}</span>
              ${lead.city ? `&bull; <span>${Icons.mapPin(13)} ${this.escapeHtml(lead.city)}</span>` : ''}
              &bull; 
              <span style="display: inline-flex; align-items: center; gap: 4px; color: var(--color-ink); font-size: 12.5px;">
                ${Icons.calendar(13)} <strong>Inbound:</strong> ${this.formatDateTime(lead.created_at)} <span style="color: var(--color-mid-gray);">(${this.formatRelativeTime(lead.created_at)})</span>
              </span>
            </div>
          </div>
          ${this.renderLeadFlow(lead, !!activeDeal)}

          <!-- Action Buttons + Segmented Navigation Tabs Shifted to Right-Hand Side -->
          <div style="display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap;">
            <!-- Founder Handoff (Catch Me Up) -->
            <button type="button" class="btn btn-primary btn-sm" onclick="App.openFounderHandoffModal('${lead.id}')" 
                    title="60-second instant founder briefing before calls" style="display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.zap(13)} Catch Me Up
            </button>

            <!-- GitHub Vault Badge / Provisioner -->
            ${lead.github_repo_url ? `
              <div style="display: inline-flex; align-items: center; gap: 4px;">
                <a href="${lead.github_repo_url}" target="_blank" rel="noopener noreferrer" 
                   class="btn btn-secondary btn-sm" 
                   style="display: inline-flex; align-items: center; gap: 5px; text-decoration: none;" 
                   title="Open GitHub Vault">
                  ${Icons.github(13)} Vault Active ${Icons.externalLink(12)}
                </a>
                <button type="button" class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('git clone ${lead.github_repo_url}.git'); API.showToast('Copied git clone command to clipboard!', 'success');" title="Copy git clone command" style="display: inline-flex; align-items: center; gap: 4px;">
                  ${Icons.copy(12)} clone
                </button>
              </div>
            ` : `
              <button type="button" class="btn btn-secondary btn-sm" onclick="App.provisionGitHubVault('${lead.id}')" 
                      title="Initialize GitHub repository and universal AI vault" style="display: inline-flex; align-items: center; gap: 4px;">
                ${Icons.github(13)} Initialize Vault
              </button>
            `}

            <!-- Segmented Navigation Tabs -->
            <div class="lead-tab-toggle">
              <button type="button" id="tab-btn-lead-details" 
                      class="lead-tab-btn ${(!this.state.activeLeadTab || this.state.activeLeadTab === 'details') ? 'active' : ''}" 
                      onclick="App.switchLeadDetailTab('details')">
                ${Icons.notepad(14)} Lead Detail
              </button>
              <button type="button" id="tab-btn-agent" 
                      class="lead-tab-btn ${this.state.activeLeadTab === 'agent' ? 'active' : ''}" 
                      onclick="App.switchLeadDetailTab('agent')">
                ${Icons.bot(14)} Agent
              </button>
            </div>
          </div>
        </div>

        <!-- TAB 1: Lead Detail (Default Active) -->
        <div id="lead-tab-details" class="lead-tab-pane" style="display: ${(!this.state.activeLeadTab || this.state.activeLeadTab === 'details') ? 'block' : 'none'};">
          <div class="record-grid">
            <!-- Left Column: Comprehensive Lead Record & Edit Form FIRST -->
            <div>
              <div class="record-card" style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; flex-wrap: wrap; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid hsl(var(--border) / 0.6);">
                  <div>
                    <div class="record-section-title" style="margin-bottom: 2px;">
                      ${Icons.edit(14)} Lead Profile &amp; Core Attributes
                    </div>
                    <div class="lead-card-meta-bar">
                      <span class="meta-item">${Icons.calendar(11)} Inbound: <strong>${this.formatDateTime(lead.created_at)}</strong> <span style="opacity: 0.8;">(${this.formatRelativeTime(lead.created_at)})</span></span>
                      <span class="meta-dot">&bull;</span>
                      <span class="meta-item">${Icons.clock(11)} Last Updated: <strong>${this.formatDateTime(lead.updated_at || lead.created_at)}</strong></span>
                    </div>
                  </div>
                  <div>
                    ${activeDeal ? `
                      <div style="display: flex; gap: 8px; align-items: center;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="App.viewDeal('${activeDeal.id}')" title="View active deal">
                          ${Icons.briefcase(13)} Deal: ${this.formatCurrency((activeDeal.value || 0))}
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" style="color: var(--color-critical); border-color: var(--color-hairline); display: inline-flex; align-items: center; gap: 4px;" onclick="App.revertDealToLead('${activeDeal.id}')" title="Revert to lead">
                          ${Icons.rotateCcw(12)} Revert
                        </button>
                      </div>
                    ` : `
                      <button type="button" class="btn btn-secondary btn-sm" onclick="App.convertToDeal('${lead.id}')" style="font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
                        ${Icons.briefcase(13)} Promote to Deal ${Icons.arrowRight(12)}
                      </button>
                    `}
                  </div>
                </div>

            <form id="lead-edit-form" onsubmit="App.handleSaveLeadEdits(event, '${lead.id}')">
              <!-- PRIMARY CONTACT -->
              <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: hsl(var(--muted-foreground)); margin: 10px 0 8px 0; display: flex; align-items: center; gap: 5px;">
                ${Icons.user ? Icons.user(11) : ''} Primary Contact
              </div>

              <div style="display: grid; grid-template-columns: 1.15fr 1fr; gap: 14px; margin-bottom: 12px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Contact Person Name *</label>
                  <input type="text" name="name" class="input" style="height: 38px; font-size: 13.5px;" value="${this.escapeHtml(lead.name || '')}" required>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Business / Brand Name</label>
                  <input type="text" name="business_name" class="input" style="height: 38px; font-size: 13.5px;" value="${this.escapeHtml(lead.business_name || '')}">
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1.15fr 1fr; gap: 14px; margin-bottom: 12px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Email Address</label>
                  <input type="email" name="email" class="input" style="height: 38px; font-size: 13.5px;" placeholder="name@company.com" value="${this.escapeHtml(lead.email || '')}">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Phone Number</label>
                  <div style="display: flex; gap: 6px; align-items: center;">
                    <input type="tel" name="phone" class="input" style="height: 38px; font-size: 13.5px; flex: 1;" placeholder="+91..." value="${this.escapeHtml(lead.phone || '')}">
                    ${waPhone ? `
                      <a href="https://wa.me/${waPhone}" target="_blank" rel="noopener noreferrer" 
                         class="wa-quick-btn" title="Chat on WhatsApp (+${waPhone})">
                        ${Icons.whatsapp(14)}
                        <span>Chat</span>
                      </a>
                    ` : ''}
                  </div>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">City / Location</label>
                  <input type="text" name="city" class="input" style="height: 38px; font-size: 13.5px;" placeholder="e.g. Bengaluru, Mumbai" value="${this.escapeHtml(lead.city || '')}">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Website URL</label>
                  <input type="url" name="website" class="input" style="height: 38px; font-size: 13.5px;" placeholder="https://example.com" value="${this.escapeHtml(lead.website || '')}">
                </div>
              </div>

              <!-- PIPELINE & QUALIFICATION -->
              <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: hsl(var(--muted-foreground)); margin: 16px 0 8px 0; display: flex; align-items: center; gap: 5px;">
                ${Icons.briefcase ? Icons.briefcase(11) : ''} Pipeline &amp; Qualification
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Pipeline Status</label>
                  <select name="status" class="select" style="height: 38px; font-size: 13px;">
                    <option value="new" ${lead.status === 'new' ? 'selected' : ''}>New</option>
                    <option value="contacted" ${lead.status === 'contacted' ? 'selected' : ''}>Contacted</option>
                    <option value="qualified" ${lead.status === 'qualified' ? 'selected' : ''}>Qualified</option>
                    <option value="proposal" ${lead.status === 'proposal' ? 'selected' : ''}>Proposal</option>
                    <option value="won" ${lead.status === 'won' ? 'selected' : ''}>Won</option>
                    <option value="lost" ${lead.status === 'lost' ? 'selected' : ''}>Lost</option>
                  </select>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Priority Level</label>
                  <select name="priority" class="select" style="height: 38px; font-size: 13px;">
                    <option value="unexplored" ${(lead.priority || 'unexplored') === 'unexplored' ? 'selected' : ''}>Unexplored</option>
                    <option value="high" ${lead.priority === 'high' ? 'selected' : ''}>High Priority</option>
                    <option value="medium" ${lead.priority === 'medium' ? 'selected' : ''}>Medium</option>
                    <option value="low" ${lead.priority === 'low' ? 'selected' : ''}>Low</option>
                    <option value="won" ${lead.priority === 'won' ? 'selected' : ''}>Won</option>
                    <option value="lost" ${lead.priority === 'lost' ? 'selected' : ''}>Lost</option>
                  </select>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Lead Temperature</label>
                  <select name="temperature" class="select" style="height: 38px; font-size: 13px;">
                    <option value="hot" ${lead.temperature === 'hot' ? 'selected' : ''}>Hot (High Intent)</option>
                    <option value="warm" ${lead.temperature === 'warm' ? 'selected' : ''}>Warm (Evaluating)</option>
                    <option value="cold" ${lead.temperature === 'cold' ? 'selected' : ''}>Cold (Unresponsive)</option>
                  </select>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Call Disposition</label>
                  <select name="call_stage" class="select" style="height: 38px; font-size: 13px;">
                    <option value="uncontacted" ${(!lead.call_stage || lead.call_stage === 'uncontacted' || lead.call_stage === 'not_called') ? 'selected' : ''}>Uncontacted (Not Called)</option>
                    <option value="first_call" ${lead.call_stage === 'first_call' ? 'selected' : ''}>First Call</option>
                    <option value="follow_up" ${lead.call_stage === 'follow_up' ? 'selected' : ''}>Follow-up</option>
                    <option value="dnp" ${lead.call_stage === 'dnp' ? 'selected' : ''}>DNP (Did Not Pick)</option>
                    <option value="connected" ${lead.call_stage === 'connected' ? 'selected' : ''}>Connected</option>
                    <option value="interested" ${lead.call_stage === 'interested' ? 'selected' : ''}>Interested</option>
                    <option value="not_interested" ${lead.call_stage === 'not_interested' ? 'selected' : ''}>Not Interested</option>
                  </select>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Est. Deal Value (₹)</label>
                  <input type="number" name="deal_value" class="input" style="height: 38px; font-size: 13.5px;" value="${lead.deal_value || 0}">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Assigned Consultant</label>
                  <select name="assigned_to" class="select" style="height: 38px; font-size: 13px;">
                    <option value="">Unassigned (Queue)</option>
                    ${this.state.users.map(u => `
                      <option value="${u.id}" ${lead.assigned_to === u.id ? 'selected' : ''}>${u.name} (${u.role})</option>
                    `).join('')}
                  </select>
                </div>
              </div>

              <!-- NOTES -->
              <div class="form-group" style="margin-top: 14px; margin-bottom: 0;">
                <label style="font-size: 11.5px; font-weight: 600; color: hsl(var(--muted-foreground)); margin-bottom: 4px; display: block;">Last Update / Operational Notes</label>
                <textarea name="last_update_notes" class="input" rows="3" style="font-size: 13px; line-height: 1.5; padding: 10px 12px;" placeholder="Latest conversation updates, client preferences, objections...">${this.escapeHtml(lead.last_update_notes || '')}</textarea>
              </div>

              <div style="display: flex; justify-content: flex-end; align-items: center; margin-top: 18px; padding-top: 14px; border-top: 1px solid hsl(var(--border) / 0.7);">
                <button type="submit" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px; padding: 0 16px; height: 36px; font-size: 13px;">
                  ${Icons.check(13)} Save Changes
                </button>
              </div>
            </form>
          </div>

          <!-- Channel Intelligence & Meta Attribution Card placed BELOW Details -->
          ${this.renderChannelIntelligenceCard(lead)}

          <!-- AI Company Intelligence Brief Card placed BELOW Channel Intelligence -->
          <div id="company-brief-container-${lead.id}">
            ${this.renderCompanyBriefCard(lead)}
          </div>

        </div>

        <!-- Right Column: Quick Call / Note Logging & Activity Feed -->
          <div>
            ${this.renderNextCallCard(lead)}

            <!-- Fast Call & Video Meeting Logger Card -->
            <div class="record-card" style="margin-bottom: 20px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <div class="record-section-title" style="margin-bottom: 0;">
                  ${Icons.phone(14)} Outreach Log
                </div>
                <!-- Mode Switcher Tabs -->
                <div style="display: flex; gap: 4px; background: var(--color-surface-alt); padding: 3px; border-radius: var(--radius-sm); border: 1px solid var(--color-hairline);">
                  <button type="button" id="tab-btn-audio-${lead.id}" class="btn btn-sm ${this._leadMeetingMode !== 'video' ? 'btn-primary' : 'btn-ghost'}" style="padding: 2px 8px; font-size: 11px; height: 24px;" onclick="App.switchCallLoggerMode('${lead.id}', 'audio')">
                    ${Icons.phone(11)} Phone Call
                  </button>
                  <button type="button" id="tab-btn-video-${lead.id}" class="btn btn-sm ${this._leadMeetingMode === 'video' ? 'btn-primary' : 'btn-ghost'}" style="padding: 2px 8px; font-size: 11px; height: 24px;" onclick="App.switchCallLoggerMode('${lead.id}', 'video')">
                    ${Icons.video(11)} Video Meet
                  </button>
                </div>
              </div>

              <!-- Audio Call Form -->
              <form id="call-log-form-${lead.id}" style="display: ${this._leadMeetingMode === 'video' ? 'none' : 'block'};" onsubmit="App.handleQuickLogCall(event, '${lead.id}')">
                <div class="outcome-groups" id="quick-outcome-pills" role="radiogroup" aria-label="What happened on the call">
                  ${[['Didn’t connect', false], ['Spoke to them', true]].map(([groupLabel, connected]) => `
                    <div class="outcome-group">
                      <span class="outcome-group-label">${groupLabel}</span>
                      <div class="outcome-group-pills">
                        ${Object.entries(this.CALL_OUTCOMES).filter(([, o]) => o.connected === connected).map(([key, o]) => `
                          <button type="button" class="outcome-pill" role="radio" aria-checked="false" data-outcome="${key}" onclick="App.selectOutcome(this, '${key}')">${o.label}</button>`).join('')}
                      </div>
                    </div>`).join('')}
                </div>
                <input type="hidden" name="outcome" id="selected-outcome" value="">
                <p class="outcome-hint" id="outcome-hint">Pick what happened on the call.</p>

                <textarea name="notes" class="input" rows="2" placeholder="Key discussion points or next steps..." style="margin-bottom: 10px;"></textarea>
                
                <div id="recording-upload-zone" class="record-upload-zone" onclick="document.getElementById('recording-file-input').click()" ondragover="event.preventDefault(); this.style.borderColor='hsl(var(--ring))'" ondragleave="this.style.borderColor='hsl(var(--border))'" ondrop="App.handleRecordingDrop(event)">
                  <input type="file" id="recording-file-input" name="recording" accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov,.webm" style="display: none;" onchange="App.handleRecordingSelect(this)">
                  <div id="recording-preview" style="font-size: 12px; color: hsl(var(--muted-foreground)); display: flex; align-items: center; justify-content: center; gap: 6px;">
                    ${Icons.paperclip(13)} <span>Attach call recording (MP3, M4A, WAV, MP4) &bull; Max 200MB</span>
                  </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div class="call-duration-field" style="display: flex; align-items: center; gap: 6px;">
                    <input type="number" name="duration_minutes" class="input" value="5" min="0" max="180" style="width: 75px;" title="Duration in minutes">
                    <span style="font-size: 11px; color: var(--color-mid-gray);">mins</span>
                  </div>
                  <button type="submit" class="btn btn-primary btn-sm">Record Call</button>
                </div>
              </form>

              <!-- Video Meeting Form (Google Meet / Zoom / Drive) -->
              <form id="video-meet-form-${lead.id}" style="display: ${this._leadMeetingMode === 'video' ? 'block' : 'none'};" onsubmit="App.handleAttachDriveMeeting(event, '${lead.id}')">
                <div class="form-group" style="margin-bottom: 8px;">
                  <input type="text" name="title" class="input" placeholder="Meeting Title (e.g. Discovery Call / Prototype Walkthrough)" value="Discovery Video Call" style="font-size: 12px; height: 32px;" required>
                </div>

                <div class="form-group" style="margin-bottom: 8px;">
                  <input type="text" name="drive_url" class="input" placeholder="Paste Google Meet recording Drive link or File ID..." style="font-size: 12px; height: 32px;" required>
                  <div style="font-size: 10px; color: var(--color-mid-gray); margin-top: 3px; display: flex; align-items: center; gap: 4px;">
                    ${Icons.folder(10)} Google Meet recordings in Drive are linked with 0 byte Git bloat
                  </div>
                </div>

                <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;">
                  <select name="outcome" class="select" style="font-size: 12px; height: 32px; flex: 1;">
                    <option value="Meeting Completed" selected>Meeting Completed</option>
                    <option value="Follow-up Required">Follow-up Required</option>
                    <option value="Scope Finalized">Scope Finalized</option>
                    <option value="Rescheduled">Rescheduled</option>
                  </select>
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <input type="number" name="duration_minutes" class="input" value="30" min="5" max="300" style="width: 65px; height: 32px; font-size: 12px;" title="Duration in minutes">
                    <span style="font-size: 11px; color: var(--color-mid-gray);">mins</span>
                  </div>
                </div>

                <textarea name="notes" class="input" rows="2" placeholder="Key meeting agreements, founder takeaways, and decisions..." style="margin-bottom: 10px; font-size: 12px;"></textarea>

                <div style="display: flex; justify-content: flex-end;">
                  <button type="submit" class="btn btn-primary btn-sm" style="display: inline-flex; align-items: center; gap: 5px;">
                    ${Icons.video(12)} Attach &amp; Sync Meeting
                  </button>
                </div>
              </form>
            </div>

            <!-- Fast Note Logger Card -->
            <div class="record-card" style="margin-bottom: 20px;">
              <div class="record-section-title">
                ${Icons.notepad(14)} Add Internal Note
              </div>
              <form onsubmit="App.handleQuickAddNote(event, '${lead.id}')">
                <textarea name="content" class="input" rows="2" placeholder="Record internal client note..." required style="margin-bottom: 10px;"></textarea>
                <div style="display: flex; justify-content: flex-end;">
                  <button type="submit" class="btn btn-secondary btn-sm">Save Note</button>
                </div>
              </form>
            </div>

            <!-- Full Activity History Feed -->
            <div class="record-card">
              <div class="record-section-title">
                ${Icons.clock(14)} Activity & Call Logs (${activity.length})
              </div>
              <div class="activity-list" style="margin-top: 12px;">
                ${activity.length > 0 ? activity.map(act => this.renderActivityItem(act)).join('') : `
                  <div style="text-align: center; padding: 24px; color: var(--color-mid-gray); font-size: 13px;">
                    No outreach calls or notes logged yet.
                  </div>
                `}
              </div>
            </div>

            <!-- Authentic WhatsApp Web Conversation Card -->
            <div class="wa-chat-container-card" style="margin-top: 20px;">
              <!-- WhatsApp Web Header -->
              <div class="wa-chat-header">
                <div class="wa-header-contact">
                  <div class="wa-avatar">
                    ${(lead.name || 'W').charAt(0).toUpperCase()}
                    <span class="online-badge" id="wa-header-online-badge" title="WhatsApp Status"></span>
                  </div>
                  <div class="wa-header-info">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                      <h4 style="margin: 0;">${this.escapeHtml(lead.name || 'Lead Contact')}</h4>
                      <span style="font-size: 11.5px; color: #54656f;">${this.escapeHtml(lead.phone || 'No phone')}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px;">
                      <span style="font-size: 10.5px; color: #54656f; font-weight: 600;">Inboxes:</span>
                      <span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 10px; padding: 2px 7px; border: 1px solid #bae6fd; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">${Icons.smartphone(11)} Personal (+91 9993202900)</span>
                      <span class="badge" style="background: #fef3c7; color: #92400e; font-size: 10px; padding: 2px 7px; border: 1px solid #fde68a; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">${Icons.building(11)} Zero7 Central (+91 9479007951)</span>
                    </div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <button class="btn btn-secondary btn-sm" onclick="App.loadWhatsAppConversation('${lead.id}')" style="font-size: 11px; padding: 4px 8px; display: inline-flex; align-items: center; gap: 4px;" title="Refresh Chat Stream">
                    ${Icons.refresh(11)} Refresh
                  </button>
                  ${waPhone ? `
                    <a href="https://web.whatsapp.com/send?phone=${waPhone}" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;" title="Open in WhatsApp Web">
                      ${Icons.externalLink(11)} Web
                    </a>
                  ` : ''}
                </div>
              </div>

              <!-- WhatsApp Account Selector Ribbon & Status Indicator -->
              <div class="wa-pills-bar" style="background: var(--color-surface-alt); padding: 8px 14px; border-bottom: 1px solid var(--color-hairline); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <span style="font-size: 11px; color: var(--color-ink-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;">Inbox Filter:</span>
                  <div id="wa-account-pills-wrap" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <div style="font-size: 11px; color: var(--color-mid-gray);">Loading inboxes...</div>
                  </div>
                </div>
                <div id="wa-sync-status-indicator" style="font-size: 11px; display: inline-flex; align-items: center; gap: 5px;">
                  <span style="color: var(--color-mid-gray); display: inline-flex; align-items: center; gap: 4px;">${Icons.clock(11)} Checking status...</span>
                </div>
              </div>

              <!-- WhatsApp Chat Scroll View with Doodle Wallpaper -->
              <div id="wa-chat-container" class="wa-chat-body">
                <div style="text-align: center; color: var(--color-mid-gray); font-size: 12px; padding: 40px 20px;">Loading conversations...</div>
              </div>

              <!-- WhatsApp Interactive Composer Footer -->
              <div class="wa-chat-footer">
                <span style="color: #54656f; cursor: default; display: inline-flex; align-items: center;">${Icons.smile(18)}</span>
                <span style="color: #54656f; cursor: default; display: inline-flex; align-items: center;">${Icons.paperclip(18)}</span>
                <input type="text"
                       id="lead-wa-quick-input"
                       class="form-input"
                       style="flex: 1; font-size: 13px; height: 36px; padding: 6px 12px; border-radius: 8px;"
                       placeholder="Type a message to send via Zero7 Central..."
                       onkeydown="if(event.key==='Enter') App.sendLeadWhatsAppMessage('${lead.id}')">
                <button type="button"
                        class="btn btn-primary btn-sm"
                        onclick="App.sendLeadWhatsAppMessage('${lead.id}')"
                        title="Send via Zero7 Central"
                        style="display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 12px;">
                  ${Icons.send(14)}
                  <span>Send</span>
                </button>
              </div>
            </div>

          </div>
        </div>
        </div>
        <!-- END TAB 1: Lead Detail -->

        <!-- TAB 2: Agent Workspace & Client Deliverables Pipeline Split -->
        <!-- TAB 2: Agent Workspace & Intelligence Split (Clean UI matching Agent Studio) -->
        <div id="lead-tab-agent" class="lead-tab-pane" style="display: ${this.state.activeLeadTab === 'agent' ? 'block' : 'none'};">
          <div class="baby-grok-bot-container" style="max-width: 100%; margin: 0; padding: 0;">
            <div class="baby-grok-bot-shell" style="height: calc(100vh - 210px); min-height: 640px;">
              
              <!-- Antigravity-Style Window Header -->
              <div class="baby-grok-bot-header antigravity-bot-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <!-- Breadcrumb (Matching Antigravity: e.g. Biopac / Biopac: hey?) -->
                  <div class="antigravity-header-breadcrumb">
                    <span class="antigravity-breadcrumb-org">${this.escapeHtml(lead.business_name || lead.name || 'Workspace')}</span>
                    <span class="antigravity-breadcrumb-sep">/</span>
                    <span class="antigravity-breadcrumb-title" id="antigravity-header-thread-title">${this.escapeHtml(lead.business_name || lead.name || 'Lead')}: Session</span>
                  </div>

                  <!-- Runs & Threads Dropdown Trigger -->
                  <div class="baby-grok-runs-trigger" onclick="App.toggleLeadAgentRunsDrawer()" title="View execution threads & runs" style="height: 24px; padding: 0 8px; font-size: 11px;">
                    <span id="lead-agent-runs-trigger-text">Runs</span>
                    <span style="display: inline-flex; align-items: center; opacity: 0.6;">${Icons.chevronDown(10)}</span>
                  </div>
                </div>

                <!-- Right: Status, Open IDE, and Deliverables Inspector Toggle -->
                <div style="display: flex; align-items: center; gap: 8px;">
                  <!-- Worker Live Badge -->
                  <div id="agent-worker-status-badge" class="agent-status-badge offline" style="height: 24px; padding: 0 8px; font-size: 11px;">
                    <span class="agent-pulse-dot"></span>
                    <span id="agent-worker-status-text">Worker Offline</span>
                  </div>

                  <!-- Deliverables Panel Toggle -->
                  <button class="btn btn-secondary btn-sm ${this._deliverablesCollapsed ? '' : 'active'}" id="lead-inspector-toggle-btn" onclick="App.toggleDeliverablesPanel()" title="Toggle Client Intelligence & Deliverables" style="height: 28px; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border-radius: 6px;">
                    ${Icons.clipboardList(14)}
                    <span style="font-size: 11.5px; font-weight: 500;">Deliverables</span>
                  </button>
                </div>
              </div>

              <!-- Body Frame -->
              <div class="baby-grok-bot-body">
                
                <!-- Left AI Teammates Sidebar (Matching Agent Studio + Pinned General Agent) -->
                <div class="baby-grok-bot-sidebar" id="lead-agent-sidebar" style="width: ${this._grokSidebarWidth || 240}px;">
                  <div class="baby-grok-sidebar-header">
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span class="baby-grok-sidebar-title">Teammates</span>
                      <span style="font-size: 10px; color: hsl(var(--muted-foreground));">5</span>
                    </div>
                  </div>

                  <!-- Pinned General Agent on Top -->
                  <div class="baby-grok-sidebar-section" style="display: flex; align-items: center; gap: 6px;">
                    ${Icons.crown(13)} Pinned General Agent
                  </div>
                  <div class="baby-grok-sidebar-list" style="flex: 0 0 auto; padding-bottom: 2px;">
                    <div class="baby-grok-sidebar-item ${(!this._leadActiveAgentSlug || this._leadActiveAgentSlug === 'chief') ? 'active' : ''}" id="lead-sidebar-agent-chief" onclick="App.selectLeadAgent('chief', '${lead.id}')">
                      <div class="baby-grok-avatar" style="background: #64748b; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center;">
                        ${Icons.crown(13)}
                      </div>
                      <div class="baby-grok-item-info">
                        <div class="baby-grok-item-top">
                          <span class="baby-grok-item-name">Chief Orchestrator</span>
                          <span class="baby-grok-item-time" style="font-size: 8.5px; background: rgba(100,116,139,0.2); padding: 1px 4px; border-radius: 3px; font-weight: 600;">PINNED</span>
                        </div>
                        <div class="baby-grok-item-status">General agent &amp; orchestration</div>
                      </div>
                    </div>
                  </div>

                  <!-- Specialized Teammates Section -->
                  <div class="baby-grok-sidebar-section divided" style="display: flex; align-items: center; gap: 6px;">
                    ${Icons.zap(13)} Specialized Agents
                  </div>
                  <div class="baby-grok-sidebar-list" style="flex: 1 1 auto;">
                    <div class="baby-grok-sidebar-item ${this._leadActiveAgentSlug === 'prototype_maker' ? 'active' : ''}" id="lead-sidebar-agent-prototype_maker" onclick="App.selectLeadAgent('prototype_maker', '${lead.id}')">
                      <div class="baby-grok-avatar" style="background: #f19d38; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center;">
                        ${Icons.zap(13)}
                      </div>
                      <div class="baby-grok-item-info">
                        <div class="baby-grok-item-top">
                          <span class="baby-grok-item-name">Prototype Maker</span>
                          <span class="baby-grok-item-time">Active</span>
                        </div>
                        <div class="baby-grok-item-status">Tailwind mockups &amp; live subdomains</div>
                      </div>
                    </div>

                    <div class="baby-grok-sidebar-item ${this._leadActiveAgentSlug === 'lead_researcher' ? 'active' : ''}" id="lead-sidebar-agent-lead_researcher" onclick="App.selectLeadAgent('lead_researcher', '${lead.id}')">
                      <div class="baby-grok-avatar" style="background: #3b82f6; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center;">
                        ${Icons.search(13)}
                      </div>
                      <div class="baby-grok-item-info">
                        <div class="baby-grok-item-top">
                          <span class="baby-grok-item-name">Lead Researcher</span>
                          <span class="baby-grok-item-time">Active</span>
                        </div>
                        <div class="baby-grok-item-status">Market intelligence &amp; audit</div>
                      </div>
                    </div>

                    <div class="baby-grok-sidebar-item ${this._leadActiveAgentSlug === 'whatsapp_nudge' ? 'active' : ''}" id="lead-sidebar-agent-whatsapp_nudge" onclick="App.selectLeadAgent('whatsapp_nudge', '${lead.id}')">
                      <div class="baby-grok-avatar" style="background: #10b981; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center;">
                        ${Icons.messageSquare(13)}
                      </div>
                      <div class="baby-grok-item-info">
                        <div class="baby-grok-item-top">
                          <span class="baby-grok-item-name">WhatsApp Nudge</span>
                          <span class="baby-grok-item-time">Active</span>
                        </div>
                        <div class="baby-grok-item-status">Re-engagement outreach pitch</div>
                      </div>
                    </div>

                    <div class="baby-grok-sidebar-item ${this._leadActiveAgentSlug === 'sow_architect' ? 'active' : ''}" id="lead-sidebar-agent-sow_architect" onclick="App.selectLeadAgent('sow_architect', '${lead.id}')">
                      <div class="baby-grok-avatar" style="background: #a855f7; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center;">
                        ${Icons.target(13)}
                      </div>
                      <div class="baby-grok-item-info">
                        <div class="baby-grok-item-top">
                          <span class="baby-grok-item-name">SOW Architect</span>
                          <span class="baby-grok-item-time">Active</span>
                        </div>
                        <div class="baby-grok-item-status">Phase 1 MVP sprint breakdown</div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Left Resizer Splitter -->
                <div class="baby-grok-resizer baby-grok-resizer-left" onmousedown="App.initGrokResize(event, 'sidebar')" title="Drag to resize sidebar"></div>

                <!-- Main Central Workspace: System-Level Execution & Conversation -->
                <div class="baby-grok-bot-main">
                  
                  <!-- Threads / Runs Drawer (Opens smoothly when trigger clicked) -->
                  <div class="baby-grok-runs-dropdown ${this._leadRunsDrawerOpen ? 'open' : ''}" id="lead-agent-runs-drawer">
                    <div class="baby-grok-runs-dropdown-header">
                      <div style="display: flex; align-items: center; gap: 6px;">
                        ${Icons.messageSquare(14)}
                        <span>Synced Antigravity Threads</span>
                        <span id="agent-threads-count" style="font-size: 10px; opacity: 0.7;">0</span>
                      </div>
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <button class="btn btn-primary btn-sm" onclick="App.startNewAgentConversation('${lead.id}')" style="font-size: 11px; padding: 2px 8px; height: auto;">
                          + New Thread
                        </button>
                        <button class="btn-icon" onclick="App.toggleLeadAgentRunsDrawer()">${Icons.close(12)}</button>
                      </div>
                    </div>
                    <div id="agent-threads-list" class="baby-grok-runs-list">
                      <div style="text-align: center; padding: 18px 12px; font-size: 11.5px; color: var(--color-mid-gray);">
                        Loading conversation threads...
                      </div>
                    </div>
                  </div>

                  <!-- Pre-Flight Readiness Banner -->
                  <div id="lead-agent-preflight-banner" class="lead-agent-preflight-wrap"></div>

                  <!-- Conversational / Job Feed Viewport -->
                  <div id="agent-chat-feed" class="baby-grok-bot-transcript">
                    <!-- Populated dynamically by renderAgentChatFeed(leadId, jobs) -->
                  </div>

                  <!-- Floating Antigravity Composer Dock -->
                  <div class="antigravity-composer-dock">
                    <div class="antigravity-composer-card">
                      <!-- Popover for autocomplete -->
                      <div id="pill-autocomplete-popover" class="pill-autocomplete-popover" style="display: none; bottom: calc(100% + 12px); left: 14px;"></div>

                      <!-- Top Input Area -->
                      <div class="antigravity-composer-textarea-wrap">
                        <textarea id="agent-prompt-input" 
                                  class="antigravity-composer-textarea" 
                                  rows="1" 
                                  placeholder="Ask anything, @ to mention, / for actions"
                                  oninput="App.autoResizeComposer(this)"
                                  onkeydown="App.handleComposerKeyDown(event, '${lead.id}')"></textarea>
                      </div>

                      <!-- Bottom Tray Controls -->
                      <div class="antigravity-composer-tray">
                        <div class="antigravity-tray-left">
                          <!-- + Context / Pills -->
                          <button type="button" class="antigravity-tray-btn" onclick="App.insertAgentPill('@lead.profile')" title="Insert context data pill (@)">
                            ${Icons.plus(15)}
                          </button>

                          <!-- Model Selector Pill (e.g. Gemini 2.0 Flash High / Antigravity Pro) -->
                          <div class="antigravity-model-selector-container" style="position: relative; display: inline-flex;">
                            <div class="antigravity-model-selector-pill" onclick="App.toggleModelSelectorDropdown(event, '${lead.id}')" title="Configure Antigravity AI Model">
                              <span class="antigravity-model-name">${this._getLeadAgentModelLabel(lead.id)}</span>
                              <span class="antigravity-model-caret" style="display: inline-flex; align-items: center;">${Icons.chevronDown(10)}</span>
                            </div>
                            <div id="antigravity-model-dropdown" class="antigravity-model-dropdown" style="display: none;" onclick="event.stopPropagation()"></div>
                          </div>

                          <!-- Voice Dictation -->
                          <button type="button" id="agent-mic-btn" class="antigravity-tray-btn" onclick="App.toggleAgentVoiceDictation()" title="Voice Dictation">
                            ${Icons.mic(14)}
                          </button>
                        </div>

                        <div class="antigravity-tray-right">
                          <button type="button" id="agent-submit-btn" class="antigravity-send-btn" onclick="App.submitAgentJob('${lead.id}')" title="Send Task">
                            ${Icons.arrowUp(14)}
                          </button>
                        </div>
                      </div>
                    </div>

                    <!-- Scroll to bottom button -->
                    <button type="button" id="antigravity-scroll-bottom-btn" class="antigravity-scroll-bottom-btn" onclick="App.scrollChatToBottom()" title="Scroll to bottom" style="display: none;">
                      ${Icons.arrowDown(14)}
                    </button>
                  </div>
                </div>

                <!-- Right Inspector Drawer: Client Intelligence & Deliverables -->
                <div class="baby-grok-bot-inspector ${this._deliverablesCollapsed ? '' : 'open'}" id="agent-deliverables-pipeline-container" style="width: 360px;">
                  <!-- Rendered via renderDeliverablesPipeline(lead) -->
                </div>

              </div>
            </div>
          </div>
        </div>
        <!-- END TAB 2: Agent -->
      </div>
    `;

    // Auto-load WhatsApp conversations (default to 'all' to show unified stored history)
    this._waSelectedAccount = 'all';
    setTimeout(() => this.loadWhatsAppConversation(lead.id, 'all'), 250);

    // Auto-load AI Company Brief & Interactive Prototypes
    setTimeout(() => {
      this.loadCompanyBrief(lead.id);
      this.loadPrototypes(lead.id);
      if (this.state.activeLeadTab === 'agent') {
        this.initAgentWorkspace(lead);
      }
    }, 100);
  },

  switchLeadDetailTab(tabName) {
    this.state.activeLeadTab = tabName;
    const leadId = this.state.selectedLeadId || this.state.selectedLead?.id;
    if (leadId) {
      const targetHash = `#/leads/${leadId}${tabName === 'agent' ? '/agent' : ''}`;
      if (window.location.hash !== targetHash && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', targetHash);
      }
    }
    const detailsPane = document.getElementById('lead-tab-details');
    const agentPane = document.getElementById('lead-tab-agent');
    const btnDetails = document.getElementById('tab-btn-lead-details');
    const btnAgent = document.getElementById('tab-btn-agent');

    if (tabName === 'agent') {
      if (detailsPane) detailsPane.style.display = 'none';
      if (agentPane) {
        agentPane.style.display = 'block';
        if (!agentPane.querySelector('.agent-workspace-container')) {
          console.warn('[AGENT TAB] Container missing, re-rendering detail page...');
          this.renderLeadDetailPage();
          return;
        }
      }
      if (btnDetails) btnDetails.classList.remove('active');
      if (btnAgent) btnAgent.classList.add('active');
      this.initAgentWorkspace(this.state.selectedLead || this.state.leads.find(l => l.id === (document.getElementById('agent-submit-btn')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1])));
    } else {
      if (detailsPane) detailsPane.style.display = 'block';
      if (agentPane) agentPane.style.display = 'none';
      if (btnDetails) btnDetails.classList.add('active');
      if (btnAgent) btnAgent.classList.remove('active');
    }
  },

  // ==================== ANTIGRAVITY AGENT WORKSPACE METHODS ====================

  _agentPollingTimer: null,
  _agentSpeechRecognition: null,
  _isAgentDictating: false,
  _activeConversationId: null,
  _activeProjectId: null,
  _activeProjectName: null,
  _projectConversations: [],
  _leadActiveAgentSlug: 'chief',
  _currentLeadJobs: [],

  _getLeadAgentDisplayName(slug) {
    const s = slug || this._leadActiveAgentSlug || 'chief';
    const names = {
      chief: 'Chief Orchestrator',
      prototype_maker: 'Prototype Maker',
      lead_researcher: 'Lead Researcher',
      whatsapp_nudge: 'WhatsApp Nudge',
      sow_architect: 'SOW Architect'
    };
    return names[s] || 'Agent';
  },

  selectLeadAgent(slug, leadId) {
    this._leadActiveAgentSlug = slug;

    // Update sidebar items active state
    const sidebar = document.getElementById('lead-agent-sidebar');
    if (sidebar) {
      sidebar.querySelectorAll('.baby-grok-sidebar-item').forEach(el => el.classList.remove('active'));
      const activeEl = document.getElementById(`lead-sidebar-agent-${slug}`);
      if (activeEl) activeEl.classList.add('active');
    }

    const agentMeta = {
      chief: { name: 'Chief Orchestrator', icon: Icons.crown(14), coat: '#64748b' },
      prototype_maker: { name: 'Prototype Maker', icon: Icons.zap(14), coat: '#f19d38' },
      lead_researcher: { name: 'Lead Researcher', icon: Icons.search(14), coat: '#3b82f6' },
      whatsapp_nudge: { name: 'WhatsApp Nudge', icon: Icons.messageSquare(14), coat: '#10b981' },
      sow_architect: { name: 'SOW Architect', icon: Icons.target(14), coat: '#a855f7' }
    };
    const meta = agentMeta[slug] || agentMeta.chief;

    // Update header avatar and title
    const avatarEl = document.getElementById('lead-active-agent-avatar');
    const titleEl = document.getElementById('lead-active-agent-title');
    if (avatarEl) {
      avatarEl.style.background = meta.coat;
      avatarEl.innerHTML = meta.icon;
    }
    if (titleEl) {
      titleEl.textContent = meta.name;
    }

    // Update composer placeholder
    const input = document.getElementById('agent-prompt-input');
    const curLead = this.state.selectedLead || (leadId ? (this.state.leads || []).find(l => l.id === leadId) : null) || {};
    const clientName = curLead.business_name || curLead.name || 'this client';
    if (input) {
      input.placeholder = `Instruct ${meta.name} on what to research, build, or analyze for ${this.escapeHtml(clientName)}... Type @ for data pills`;
    }

    // Update model pill label if present
    const modelPillName = document.querySelector('.antigravity-model-name');
    if (modelPillName) {
      modelPillName.textContent = this._getLeadAgentModelLabel(leadId);
    }

    // Re-render chat feed for this agent
    if (this._currentLeadJobs && this._currentLeadJobs.length > 0) {
      this.renderAgentChatFeed(leadId, this._currentLeadJobs);
    } else {
      this.loadAgentJobs(leadId);
    }

    // Update pre-flight readiness banner
    this.renderPrototypeReadinessBanner(leadId, 'lead-agent-preflight-banner');
  },

  onAgentSlugChange(slug, leadId) {
    this.selectLeadAgent(slug, leadId);
  },

  async initAgentWorkspace(lead) {
    if (!lead || !lead.id) return;
    this.checkAgentWorkerStatus();
    await this.loadAvailableAgentProjects(lead);
    await this.loadProjectConversations(lead);
    await this.loadAgentJobs(lead.id);
    this.renderDeliverablesPipeline(lead);
    this.renderPrototypeReadinessBanner(lead.id, 'lead-agent-preflight-banner');

    const input = document.getElementById('agent-prompt-input');
    if (input) {
      this.attachPillAutocomplete(input, lead.id, 'pill-autocomplete-popover');
      if (!input._boundAgentKeys) {
        input._boundAgentKeys = true;
        input.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            this.submitAgentJob(lead.id);
          }
        });
      }
    }

    const feed = document.getElementById('agent-chat-feed');
    const scrollBtn = document.getElementById('antigravity-scroll-bottom-btn');
    if (feed && scrollBtn && !feed._hasScrollListener) {
      feed._hasScrollListener = true;
      feed.addEventListener('scroll', () => {
        const isScrolledUp = (feed.scrollHeight - feed.scrollTop - feed.clientHeight) > 100;
        scrollBtn.style.display = isScrolledUp ? 'inline-flex' : 'none';
      });
    }
  },

  async loadProjectConversations(lead) {
    const listEl = document.getElementById('agent-threads-list');
    const countEl = document.getElementById('agent-threads-count');
    if (!listEl) return;

    const projId = (lead && lead.project_id) || this._activeProjectId;
    const projPath = (lead && lead.project_path) || '';
    const projName = (lead && (lead.project_name || (projPath ? projPath.split('\\').pop() : (lead.business_name || lead.name || '')))) || '';
    const lookupKey = projId || projName || 'all';

    try {
      const res = await API.get(`/api/agent/projects/${encodeURIComponent(lookupKey)}/conversations`);
      const threads = (res && res.conversations) || [];
      this._projectConversations = threads;

      if (countEl) countEl.textContent = threads.length;
      const triggerText = document.getElementById('lead-agent-runs-trigger-text');
      if (triggerText) {
        triggerText.textContent = `${threads.length} run${threads.length !== 1 ? 's' : ''}`;
      }

      // Auto-select latest thread if none selected
      if (!this._activeConversationId && threads.length > 0) {
        this._activeConversationId = threads[0].id;
      }

      this.renderThreadsSidebar(threads, this._activeConversationId);

      // Load active conversation transcript if available
      if (this._activeConversationId) {
        this.loadConversationTranscript(this._activeConversationId);
      }
    } catch (e) {
      console.warn('Failed to load project conversations:', e);
      if (listEl) {
        listEl.innerHTML = `
          <div style="text-align: center; padding: 20px 12px; font-size: 11.5px; color: var(--color-mid-gray);">
            No synced threads yet.<br>Click <strong>+ New Conversation</strong> to start one!
          </div>
        `;
      }
    }
  },

  renderThreadsSidebar(threads, activeId) {
    const listEl = document.getElementById('agent-threads-list');
    if (!listEl) return;

    if (!threads || threads.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 24px 12px; font-size: 11.5px; color: var(--color-mid-gray); line-height: 1.5;">
          No conversations found for this project in Antigravity.<br><br>
          <span style="font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">Click <strong>${Icons.plus(11)} New Conversation</strong> to create the first thread!</span>
        </div>
      `;
      return;
    }

    let html = '';
    threads.forEach(t => {
      const isActive = activeId && (t.id === activeId);
      const title = t.title || 'Untitled Conversation';
      const steps = t.step_count ? `${t.step_count} steps` : 'Active';
      const timeStr = t.last_modified ? this.formatDate(t.last_modified) : '';

      html += `
        <div class="agent-thread-item ${isActive ? 'active' : ''}" 
             onclick="App.selectConversationThread('${t.id}')"
             title="${this.escapeHtml(title)}">
          <div class="agent-thread-top">
            <span style="display: inline-flex; align-items: center; flex-shrink: 0;">${isActive ? Icons.messageSquare(12) : Icons.messageCircle(12)}</span>
            <span class="agent-thread-title">${this.escapeHtml(title)}</span>
          </div>
          <div class="agent-thread-meta">
            <span>${this.escapeHtml(timeStr)}</span>
            <span class="agent-thread-badge">${steps}</span>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;
  },

  _threadsCollapsed: localStorage.getItem('zero7_agent_threads_collapsed') === 'true',
  _deliverablesCollapsed: localStorage.getItem('zero7_agent_deliverables_collapsed') === 'true',
  _leadRunsDrawerOpen: false,

  toggleLeadAgentRunsDrawer(forceState) {
    this._leadRunsDrawerOpen = typeof forceState === 'boolean' ? forceState : !this._leadRunsDrawerOpen;
    const drawer = document.getElementById('lead-agent-runs-drawer');
    if (drawer) {
      if (this._leadRunsDrawerOpen) {
        drawer.classList.add('open');
      } else {
        drawer.classList.remove('open');
      }
    }
  },

  insertAgentPill(pillTag) {
    const input = document.getElementById('agent-prompt-input');
    if (input) {
      const val = input.value.trim();
      input.value = val ? `${val} ${pillTag} ` : `${pillTag} `;
      input.focus();
    }
  },

  toggleThreadsSidebar() {
    this.toggleLeadAgentRunsDrawer();
  },

  toggleDeliverablesPanel() {
    this._deliverablesCollapsed = !this._deliverablesCollapsed;
    localStorage.setItem('zero7_agent_deliverables_collapsed', this._deliverablesCollapsed ? 'true' : 'false');
    const container = document.getElementById('agent-deliverables-pipeline-container');
    const toggleBtn = document.getElementById('lead-inspector-toggle-btn');
    if (container) {
      if (this._deliverablesCollapsed) {
        container.classList.remove('open');
      } else {
        container.classList.add('open');
      }
    }
    if (toggleBtn) {
      if (this._deliverablesCollapsed) {
        toggleBtn.classList.remove('active');
      } else {
        toggleBtn.classList.add('active');
      }
    }
    const currentLead = this.state.selectedLead;
    if (currentLead && !this._deliverablesCollapsed) {
      this.renderDeliverablesPipeline(currentLead);
    }
  },

  selectConversationThread(convId) {
    this._activeConversationId = convId;
    this.renderThreadsSidebar(this._projectConversations, convId);
    this.loadConversationTranscript(convId);
    this.toggleLeadAgentRunsDrawer(false);
  },

  async startNewAgentConversation(leadId) {
    this._activeConversationId = null;
    this.renderThreadsSidebar(this._projectConversations, null);
    
    // Clear feed to fresh ready state
    const feed = document.getElementById('agent-chat-feed');
    if (feed) {
      feed.innerHTML = `
        <div class="agent-empty-feed">
          <div style="width: 48px; height: 48px; border-radius: 12px; background: var(--color-surface-alt); border: 1px solid var(--color-hairline); display: flex; align-items: center; justify-content: center; margin-bottom: 12px; color: var(--color-ink);">
            ${Icons.bot(24)}
          </div>
          <h4 style="font-size: 15px; font-weight: 600; color: var(--color-ink); margin-bottom: 4px;">New Conversation Ready</h4>
          <p style="font-size: 12.5px; color: var(--color-mid-gray); max-width: 440px; margin: 0 0 16px 0;">
            Type your prompt below to start a brand new conversation thread in Antigravity for this project.
          </p>
        </div>
      `;
    }
    const input = document.getElementById('agent-prompt-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    API.showToast('Ready for new conversation thread', 'info');
  },

  _transcriptSyncRetries: 0,
  async loadConversationTranscript(convId) {
    const feed = document.getElementById('agent-chat-feed');
    if (!feed) return;

    try {
      const res = await API.get(`/api/agent/conversations/${convId}/transcript`);
      const msgs = (res && res.messages) || [];

      if (msgs.length === 0) {
        if (res && res.pending) {
          if ((this._transcriptSyncRetries = (this._transcriptSyncRetries || 0) + 1) <= 3) {
            feed.innerHTML = `
              <div style="text-align: center; padding: 40px 20px; color: var(--color-mid-gray); font-size: 13px;">
                <span style="display:inline-block; animation:spin 1s linear infinite; margin-right: 6px;">${Icons.loader(14)}</span>
                Syncing conversation transcript from Antigravity on host PC...
              </div>
            `;
            setTimeout(() => {
              if (this._activeConversationId === convId) {
                this.loadConversationTranscript(convId);
              }
            }, 1800);
            return;
          } else {
            this._transcriptSyncRetries = 0;
            feed.innerHTML = `
              <div style="text-align: center; padding: 36px 20px; color: var(--color-mid-gray); font-size: 12.5px;">
                Conversation thread initialized. Type your instruction below to proceed.
              </div>
            `;
            return;
          }
        }
      }

      this._transcriptSyncRetries = 0;
      this.renderTranscriptFeed(msgs, convId);
    } catch (e) {
      console.warn('Failed to load conversation transcript:', e);
    }
  },

  renderTranscriptFeed(messages, convId) {
    const feed = document.getElementById('agent-chat-feed');
    if (!feed) return;

    if (!messages || messages.length === 0) {
      return;
    }

    let html = '<div class="baby-grok-chat-container">';
    messages.forEach(msg => {
      const timeStr = msg.created_at ? this.formatDate(msg.created_at) : '';
      if (msg.role === 'user') {
        html += `
          <div class="baby-grok-turn-user">
            <div class="baby-grok-bubble-user">
              ${this.formatGrokPromptHtml(msg.content)}
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="baby-grok-turn-agent">
            <div class="baby-grok-agent-header">
              <div class="baby-grok-agent-identity">
                <div class="baby-grok-agent-avatar" style="background: #3b82f6; display: flex; align-items: center; justify-content: center;">
                  ${Icons.bot(14)}
                </div>
                <div class="baby-grok-agent-meta">
                  <span class="baby-grok-agent-name">Google Antigravity Agent</span>
                  <span class="baby-grok-agent-model-badge">Synced Local Thread</span>
                  <span class="baby-grok-status-badge success" style="display: inline-flex; align-items: center; gap: 3px;">${Icons.check(11)} Synced</span>
                </div>
              </div>
              <div class="baby-grok-agent-actions">
                <button type="button" class="baby-grok-action-btn" onclick="App.copyMessageText(this, decodeURIComponent('${encodeURIComponent(msg.content || '')}'))" title="Copy response markdown">
                  ${Icons.copy(12)} Copy
                </button>
              </div>
            </div>

            ${msg.thoughts ? `
              <div class="baby-grok-thinking-wrapper" style="margin-top: 8px;">
                <details class="baby-grok-thinking-details">
                  <summary class="baby-grok-thinking-summary">
                    <div style="display: flex; align-items: center;">
                      <span class="baby-grok-thinking-icon" style="display: inline-flex; align-items: center;">${Icons.brain(13)}</span>
                      <span class="baby-grok-thinking-label">Reasoning Trace &amp; Tool Executions (${msg.thoughts.length.toLocaleString()} chars)</span>
                    </div>
                    <span class="baby-grok-thinking-arrow" style="display: inline-flex; align-items: center;">${Icons.chevronDown(11)}</span>
                  </summary>
                  <div class="baby-grok-thinking-body">
                    <pre>${this.escapeHtml(msg.thoughts)}</pre>
                  </div>
                </details>
              </div>
            ` : ''}

            <div class="baby-grok-markdown-body" style="margin-top: 8px;">
              ${this.renderAgentMarkdown(msg.content)}
            </div>
          </div>
        `;
      }
    });
    html += '</div>';

    feed.innerHTML = html;
    feed.scrollTop = feed.scrollHeight;
  },

  openCreateProjectModal(leadId) {
    const lead = this.state.selectedLead || this.state.leads.find(l => l.id === leadId) || {};
    const defaultName = (lead.business_name || lead.name || 'New Project').trim();
    const defaultPath = `C:\\Users\\m_hit\\Desktop\\zero7 Consultancy\\Projects\\${defaultName}`;

    const modalHtml = `
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-hairline); padding: 14px 18px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-flex; align-items: center;">${Icons.plus(18)}</span>
          <div>
            <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--color-ink);">Create Antigravity Project</h3>
            <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--color-mid-gray);">Provision a new workspace repository on your Windows machine</p>
          </div>
        </div>
        <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
      </div>
      <div class="modal-body" style="padding: 18px 20px;">
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-size: 12.5px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px;">Project Name:</label>
          <input type="text" id="new-proj-name" value="${this.escapeHtml(defaultName)}" 
                 oninput="document.getElementById('new-proj-path').value = 'C:\\\\Users\\\\m_hit\\\\Desktop\\\\zero7 Consultancy\\\\Projects\\\\' + this.value.trim();"
                 style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; background: var(--color-paper); border: 1px solid var(--color-hairline); border-radius: var(--radius-input); color: var(--color-ink); outline: none;" />
        </div>
        <div style="margin-bottom: 20px;">
          <label style="display: block; font-size: 12.5px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px;">Folder Path on Windows PC:</label>
          <input type="text" id="new-proj-path" value="${this.escapeHtml(defaultPath)}" 
                 style="width: 100%; height: 36px; padding: 0 12px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; background: var(--color-paper); border: 1px solid var(--color-hairline); border-radius: var(--radius-input); color: var(--color-ink); outline: none;" />
          <p style="margin: 4px 0 0 0; font-size: 11px; color: var(--color-mid-gray);">This directory will be created and registered with Antigravity Turbo Mode.</p>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="button" class="btn btn-primary" onclick="App.submitCreateProject('${leadId}')">
            Create & Assign Project
          </button>
        </div>
      </div>
    `;

    this.openModal(modalHtml);
  },

  async submitCreateProject(leadId) {
    const nameInput = document.getElementById('new-proj-name');
    const pathInput = document.getElementById('new-proj-path');
    const name = nameInput ? nameInput.value.trim() : '';
    const path = pathInput ? pathInput.value.trim() : '';
    if (!name) {
      API.showToast('Please enter a project name', 'error');
      return;
    }

    try {
      API.showToast(`Creating Antigravity project '${name}'...`, 'info');
      await API.post('/api/agent/projects/create', {
        name: name,
        path: path,
        lead_id: leadId
      });

      this.closeModal();
      API.showToast(`Project '${name}' created and assigned!`, 'success');

      // Update local state
      if (this.state.selectedLead && this.state.selectedLead.id === leadId) {
        this.state.selectedLead.project_path = path;
        this.state.selectedLead.project_name = name;
      }
      this._activeProjectId = null;
      this._activeProjectName = name;
      this._activeConversationId = null;

      // Reload projects & conversations
      await this.loadAvailableAgentProjects(this.state.selectedLead || { id: leadId, project_path: path, project_name: name });
      await this.loadProjectConversations(this.state.selectedLead || { id: leadId, project_path: path, project_name: name });
    } catch (e) {
      console.error('Failed to create project:', e);
      API.showToast('Failed to create project: ' + (e.message || 'Error'), 'error');
    }
  },

  async renderPrototypeReadinessBanner(leadId, targetContainerId = 'lead-agent-preflight-banner') {
    const targetEl = document.getElementById(targetContainerId);
    if (!targetEl) return;

    // Check if Prototype Maker is the active agent in this context
    const isStudio = targetContainerId === 'grok-agent-preflight-banner';
    const activeSlug = isStudio ? (this._grokActiveAgentSlug || 'prototype_maker') : (this._leadActiveAgentSlug || 'chief');

    if (activeSlug !== 'prototype_maker') {
      targetEl.innerHTML = '';
      targetEl.style.display = 'none';
      return;
    }

    const actualLeadId = leadId || (isStudio ? this._grokSelectedLeadId : this.state.selectedLead?.id);
    if (!actualLeadId) {
      targetEl.innerHTML = '';
      targetEl.style.display = 'none';
      return;
    }

    targetEl.style.display = 'block';

    try {
      const data = await API.get(`/api/leads/${actualLeadId}/prototype-rep-context`);
      const readiness = data?.readiness || {};
      const repCtx = data?.rep_context || {};
      const bizName = data?.business_name || data?.lead_name || 'Client';

      const transcriptsOk = Boolean(readiness.has_transcripts);
      const transcriptCount = readiness.transcript_count || 0;
      const briefOk = Boolean(readiness.has_brief);
      const isBriefed = Boolean(readiness.is_briefed);

      const isReady = isBriefed;
      const bannerClass = isReady ? 'ready' : 'pending';

      const workflowLabel = repCtx.primary_workflow 
        ? (repCtx.primary_workflow.length > 32 ? repCtx.primary_workflow.substring(0, 32) + '...' : repCtx.primary_workflow)
        : null;

      targetEl.innerHTML = `
        <div class="lead-agent-preflight-banner ${bannerClass}">
          <div class="preflight-left">
            <div class="preflight-title">
              <span style="color: #f19d38; display: inline-flex;">${Icons.zap(15)}</span>
              <span>Prototype Pre-Flight Readiness:</span>
            </div>
            <div class="preflight-badges">
              <span class="preflight-badge ${transcriptsOk ? 'ok' : 'warn'}" title="${transcriptsOk ? `${transcriptCount} call recording(s) synced via Deepgram` : 'No discovery call transcripts logged yet'}">
                <span>${transcriptsOk ? '🟢' : '🟡'}</span>
                <span>${transcriptsOk ? `${transcriptCount} Call(s) Synced` : '0 Transcripts'}</span>
              </span>

              <span class="preflight-badge ${briefOk ? 'ok' : 'warn'}" title="${briefOk ? 'Company brief synthesized from discovery signals' : 'Company brief pending synthesis'}">
                <span>${briefOk ? '🟢' : '🟡'}</span>
                <span>${briefOk ? 'Brief Active' : 'Brief Pending'}</span>
              </span>

              <span class="preflight-badge ${isBriefed ? 'ok' : 'warn'}" title="${isBriefed ? `Tactical context injected by ${repCtx.briefed_by || 'Rep'}` : 'Sales Rep briefing needed to steer interactive screens'}">
                <span>${isBriefed ? '🟢' : '🟡'}</span>
                <span>${isBriefed ? `Rep Briefed${workflowLabel ? ': ' + this.escapeHtml(workflowLabel) : ''}` : 'Rep Context Pending'}</span>
              </span>
            </div>
          </div>

          <div class="preflight-actions">
            <button type="button" class="btn-preflight-brief" onclick="App.openPrototypeBriefingModal('${actualLeadId}')" title="Configure required screens and client conversation nuances">
              <span>🎯</span>
              <span>${isBriefed ? 'Edit Rep Briefing' : 'Brief Prototype Maker'}</span>
            </button>
            <button type="button" class="btn-preflight-deploy" onclick="App.deployPrototypeMakerFromBanner('${actualLeadId}')" title="Launch Prototype Maker with structured rep intelligence">
              <span>🚀</span>
              <span>Deploy Prototype</span>
            </button>
          </div>
        </div>
        ${!isBriefed ? `
          <div style="padding: 4px 14px 2px; font-size: 11px; color: #f59e0b; display: flex; align-items: center; gap: 5px;">
            <span>ℹ️</span>
            <span><strong>High Quality Recommended:</strong> Briefing the Prototype Maker prevents generic mockups and focuses directly on ${this.escapeHtml(bizName)}'s operational bottlenecks.</span>
          </div>
        ` : ''}
      `;
    } catch (e) {
      console.warn('Failed to load prototype readiness banner:', e);
      targetEl.innerHTML = '';
      targetEl.style.display = 'none';
    }
  },

  async openPrototypeBriefingModal(leadId) {
    const actualLeadId = leadId || this.state.selectedLead?.id || this._grokSelectedLeadId;
    if (!actualLeadId) {
      API.showToast('Please select a client first.', 'error');
      return;
    }

    try {
      API.showToast('Loading client intelligence & rep briefing...', 'info');
      const data = await API.get(`/api/leads/${actualLeadId}/prototype-rep-context`);
      this._currentPrototypeBriefData = data;

      const bizName = data.business_name || data.lead_name || 'Client';
      const readiness = data.readiness || {};
      const repCtx = data.rep_context || {};
      const suggestions = data.suggestions || {};

      const primaryWorkflow = repCtx.primary_workflow || suggestions.suggested_workflow || `${bizName} Operations & WhatsApp Flow`;
      const tacticalNotes = repCtx.tactical_notes || '';
      const targetViewport = repCtx.target_viewport || 'desktop';
      const visualStyle = repCtx.visual_style || 'zero7_dark';

      // Pre-select screens
      const defaultScreens = ['Dashboard', 'Orders Kanban', 'Driver Dispatch', 'WhatsApp Customer Share', '1-Click Invoice'];
      const selectedScreens = Array.isArray(repCtx.key_screens) && repCtx.key_screens.length > 0 
        ? repCtx.key_screens 
        : (suggestions.suggested_screens || defaultScreens);

      const allScreenChoices = Array.from(new Set([
        ...selectedScreens,
        ...defaultScreens,
        'Inventory Alert', 'Customer Portal', 'Barista Kitchen View', 'Analytics & Reports'
      ]));

      const painPoints = Array.isArray(suggestions.pain_points) ? suggestions.pain_points : [];
      const briefSummary = suggestions.brief_summary || '';

      const modalHtml = `
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-hairline); padding: 14px 20px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(241,157,56,0.18); color: #f19d38; display: flex; align-items: center; justify-content: center; font-size: 16px;">
              🎯
            </div>
            <div>
              <h3 style="margin: 0; font-size: 15.5px; font-weight: 700; color: var(--color-ink);">Sales Rep Prototype Briefing</h3>
              <p style="margin: 2px 0 0 0; font-size: 11.5px; color: var(--color-mid-gray);">Guide Prototype Maker on ${this.escapeHtml(bizName)}'s promised workflow &amp; closing angle</p>
            </div>
          </div>
          <button class="btn-icon" onclick="App.closeModal()">${Icons.close(16)}</button>
        </div>

        <div class="modal-body prototype-briefing-modal" style="padding: 18px 22px; max-height: calc(85vh - 120px); overflow-y: auto;">
          
          <!-- 1. Client Signals Snapshot -->
          <div class="brief-context-snapshot">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 600; font-size: 12px; color: hsl(var(--foreground)); display: flex; align-items: center; gap: 6px;">
                ${Icons.activity(13)} Client Discovery Intelligence
              </span>
              <span class="badge ${readiness.has_transcripts ? 'badge-confirmed' : 'badge-lost'}" style="font-size: 10.5px;">
                ${readiness.transcript_count || 0} Call Recording(s) Synced
              </span>
            </div>
            ${briefSummary ? `
              <p style="margin: 0 0 8px 0; font-size: 11.5px; line-height: 1.45; color: hsl(var(--muted-foreground));">
                ${this.escapeHtml(briefSummary)}
              </p>
            ` : ''}
            ${painPoints.length > 0 ? `
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span style="font-size: 11px; font-weight: 600; color: #f59e0b;">Key Operational Bottlenecks:</span>
                ${painPoints.map(p => `
                  <div style="font-size: 11.5px; color: hsl(var(--foreground)); display: flex; align-items: flex-start; gap: 6px;">
                    <span style="color: #f19d38; font-size: 10px; margin-top: 2px;">•</span>
                    <span>${this.escapeHtml(p)}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <!-- 2. Primary Workflow to Showcase -->
          <div style="margin-bottom: 18px;">
            <label style="display: block; font-size: 12.5px; font-weight: 600; color: var(--color-ink); margin-bottom: 4px;">
              1. Primary Workflow to Showcase <span style="color: #ef4444;">*</span>
            </label>
            <p style="margin: 0 0 6px 0; font-size: 11.5px; color: var(--color-mid-gray);">What core end-to-end operation will wow the client during the demo call?</p>
            <input type="text" id="brief-primary-workflow" class="input" value="${this.escapeHtml(primaryWorkflow)}" 
                   placeholder="e.g. WhatsApp Order Booking to Batch Dispatch Pipeline" 
                   style="width: 100%; height: 36px; font-size: 13px; font-weight: 500;" />
            <div class="workflow-chips-wrap">
              <span style="font-size: 10.5px; color: var(--color-mid-gray); align-self: center; margin-right: 2px;">Presets:</span>
              <button type="button" class="workflow-chip" onclick="App.applyWorkflowPreset('${this.escapeHtml(bizName)} WhatsApp Order to Dispatch')">WhatsApp Dispatch</button>
              <button type="button" class="workflow-chip" onclick="App.applyWorkflowPreset('${this.escapeHtml(bizName)} Live Inventory &amp; Stock Alerts')">Inventory &amp; Stock</button>
              <button type="button" class="workflow-chip" onclick="App.applyWorkflowPreset('${this.escapeHtml(bizName)} Client Self-Service Ordering Portal')">Client Self-Service</button>
              <button type="button" class="workflow-chip" onclick="App.applyWorkflowPreset('${this.escapeHtml(bizName)} Automated Quotation &amp; SOW Estimator')">Quotation &amp; Invoicing</button>
            </div>
          </div>

          <!-- 3. Critical Must-Have Interactive Screens -->
          <div style="margin-bottom: 18px;">
            <label style="display: block; font-size: 12.5px; font-weight: 600; color: var(--color-ink); margin-bottom: 4px;">
              2. Critical Interactive Screens to Build
            </label>
            <p style="margin: 0 0 8px 0; font-size: 11.5px; color: var(--color-mid-gray);">Select which screens the Prototype Maker must build with real clickable tab navigation:</p>
            <div id="brief-screen-pills-container" class="prototype-screen-pills-wrap">
              ${allScreenChoices.map(screen => {
                const isSelected = selectedScreens.includes(screen);
                return `
                  <button type="button" class="prototype-screen-pill ${isSelected ? 'selected' : ''}" 
                          data-screen="${this.escapeHtml(screen)}" 
                          onclick="App.togglePrototypeScreenPill(this)">
                    <span>${isSelected ? '✓' : '+'}</span>
                    <span>${this.escapeHtml(screen)}</span>
                  </button>
                `;
              }).join('')}
            </div>
            <!-- Custom screen adder input -->
            <div style="display: flex; gap: 8px;">
              <input type="text" id="brief-new-screen-input" class="input" placeholder="Add custom screen (e.g. Driver GPS Live Map)" 
                     onkeydown="if(event.key === 'Enter'){ event.preventDefault(); App.addCustomPrototypeScreen(); }"
                     style="height: 32px; font-size: 12px; flex: 1;" />
              <button type="button" class="btn btn-secondary btn-sm" onclick="App.addCustomPrototypeScreen()" style="height: 32px; padding: 0 12px; font-size: 11.5px;">
                + Add Screen
              </button>
            </div>
          </div>

          <!-- 4. Sales Rep Tactical Context & Secret Sauce -->
          <div style="margin-bottom: 18px;">
            <label style="display: block; font-size: 12.5px; font-weight: 600; color: var(--color-ink); margin-bottom: 4px;">
              3. Sales Rep Tactical Notes &amp; Closing Angle
            </label>
            <p style="margin: 0 0 6px 0; font-size: 11.5px; color: var(--color-mid-gray);">Client conversation nuances, specific numbers, feature promises, or psychological hooks:</p>
            <textarea id="brief-tactical-notes" class="input" rows="3" 
                      placeholder="e.g. During call, founder mentioned dispatch takes 4 hours and WhatsApp group has 200 chaos messages. Highlight a big green '1-Click Dispatch' button that saves 3 hours." 
                      style="width: 100%; font-size: 12.5px; line-height: 1.5; padding: 10px; resize: vertical;">${this.escapeHtml(tacticalNotes)}</textarea>
          </div>

          <!-- 5. Viewport & Visual Style -->
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 12.5px; font-weight: 600; color: var(--color-ink); margin-bottom: 8px;">
              4. Target Viewport &amp; Theme
            </label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div>
                <span style="display: block; font-size: 11px; color: var(--color-mid-gray); margin-bottom: 4px;">Target Viewport:</span>
                <div class="prototype-segmented-group">
                  <label class="prototype-segmented-label">
                    <input type="radio" name="brief_viewport" value="desktop" ${targetViewport !== 'mobile' ? 'checked' : ''} />
                    <div>
                      <div style="font-weight: 600; font-size: 12px;">🖥️ Desktop Dashboard</div>
                      <div style="font-size: 10px; color: hsl(var(--muted-foreground));">Full analytics &amp; kanban</div>
                    </div>
                  </label>
                  <label class="prototype-segmented-label">
                    <input type="radio" name="brief_viewport" value="mobile" ${targetViewport === 'mobile' ? 'checked' : ''} />
                    <div>
                      <div style="font-weight: 600; font-size: 12px;">📱 Mobile Web App</div>
                      <div style="font-size: 10px; color: hsl(var(--muted-foreground));">Field &amp; driver focused</div>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <span style="display: block; font-size: 11px; color: var(--color-mid-gray); margin-bottom: 4px;">Visual Style:</span>
                <div class="prototype-segmented-group">
                  <label class="prototype-segmented-label">
                    <input type="radio" name="brief_style" value="zero7_dark" ${visualStyle !== 'clean_light' ? 'checked' : ''} />
                    <div>
                      <div style="font-weight: 600; font-size: 12px;">🌙 Zero7 Dark Modern</div>
                      <div style="font-size: 10px; color: hsl(var(--muted-foreground));">Sleek obsidian &amp; amber</div>
                    </div>
                  </label>
                  <label class="prototype-segmented-label">
                    <input type="radio" name="brief_style" value="clean_light" ${visualStyle === 'clean_light' ? 'checked' : ''} />
                    <div>
                      <div style="font-weight: 600; font-size: 12px;">☀️ Clean Minimalist</div>
                      <div style="font-size: 10px; color: hsl(var(--muted-foreground));">Crisp white enterprise</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>

        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-hairline); padding: 14px 20px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <div style="display: flex; align-items: center; gap: 10px;">
            <button type="button" id="btn-save-prototype-draft" class="btn btn-secondary" onclick="App.submitPrototypeRepContext('${actualLeadId}', false)">
              💾 Save Draft
            </button>
            <button type="button" id="btn-deploy-prototype-now" class="btn btn-primary" onclick="App.submitPrototypeRepContext('${actualLeadId}', true)" style="background: #f19d38; border-color: #f19d38; color: #000; font-weight: 600;">
              🚀 Save &amp; Deploy Prototype Maker
            </button>
          </div>
        </div>
      `;

      this.openModal(modalHtml);
    } catch (e) {
      console.error('Error opening prototype briefing modal:', e);
      API.showToast('Failed to open prototype briefing: ' + e.message, 'error');
    }
  },

  togglePrototypeScreenPill(btn) {
    if (!btn) return;
    const isSel = btn.classList.toggle('selected');
    const iconSpan = btn.querySelector('span:first-child');
    if (iconSpan) iconSpan.textContent = isSel ? '✓' : '+';
  },

  addCustomPrototypeScreen() {
    const input = document.getElementById('brief-new-screen-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    const container = document.getElementById('brief-screen-pills-container');
    if (container) {
      const existing = container.querySelector(`[data-screen="${CSS.escape(val)}"]`);
      if (existing) {
        existing.classList.add('selected');
        const iconSpan = existing.querySelector('span:first-child');
        if (iconSpan) iconSpan.textContent = '✓';
      } else {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'prototype-screen-pill selected';
        pill.setAttribute('data-screen', val);
        pill.onclick = () => App.togglePrototypeScreenPill(pill);
        pill.innerHTML = `<span>✓</span> <span>${this.escapeHtml(val)}</span>`;
        container.appendChild(pill);
      }
    }
    input.value = '';
  },

  applyWorkflowPreset(presetText) {
    const input = document.getElementById('brief-primary-workflow');
    if (input) {
      input.value = presetText;
      input.focus();
    }
  },

  async submitPrototypeRepContext(leadId, deployNow = false) {
    const workflowInput = document.getElementById('brief-primary-workflow');
    const notesInput = document.getElementById('brief-tactical-notes');
    const viewportRadio = document.querySelector('input[name="brief_viewport"]:checked');
    const styleRadio = document.querySelector('input[name="brief_style"]:checked');

    const primaryWorkflow = workflowInput ? workflowInput.value.trim() : '';
    const tacticalNotes = notesInput ? notesInput.value.trim() : '';
    const targetViewport = viewportRadio ? viewportRadio.value : 'desktop';
    const visualStyle = styleRadio ? styleRadio.value : 'zero7_dark';

    const container = document.getElementById('brief-screen-pills-container');
    const selectedScreens = [];
    if (container) {
      container.querySelectorAll('.prototype-screen-pill.selected').forEach(pill => {
        const s = pill.getAttribute('data-screen');
        if (s) selectedScreens.push(s);
      });
    }

    if (!primaryWorkflow) {
      API.showToast('Please specify the primary workflow to showcase.', 'error');
      workflowInput?.focus();
      return;
    }

    const saveDraftBtn = document.getElementById('btn-save-prototype-draft');
    const deployBtn = document.getElementById('btn-deploy-prototype-now');
    if (saveDraftBtn) saveDraftBtn.disabled = true;
    if (deployBtn) {
      deployBtn.disabled = true;
      deployBtn.textContent = deployNow ? 'Deploying Prototype Maker...' : 'Saving...';
    }

    try {
      const payload = {
        primary_workflow: primaryWorkflow,
        key_screens: selectedScreens,
        tactical_notes: tacticalNotes,
        target_viewport: targetViewport,
        visual_style: visualStyle,
        deploy_agent_now: Boolean(deployNow)
      };

      const res = await API.post(`/api/leads/${leadId}/prototype-rep-context`, payload);

      if (deployNow) {
        API.showToast('🚀 Prototype Maker deployed with sales rep context!', 'success');
        this.closeModal();

        await this.loadAgentJobs(leadId);
        this.renderPrototypeReadinessBanner(leadId, 'lead-agent-preflight-banner');
        if (this._grokSelectedLeadId) {
          this.renderPrototypeReadinessBanner(this._grokSelectedLeadId, 'grok-agent-preflight-banner');
        }
      } else {
        API.showToast('Tactical rep context saved as draft.', 'success');
        this.closeModal();
        this.renderPrototypeReadinessBanner(leadId, 'lead-agent-preflight-banner');
        if (this._grokSelectedLeadId) {
          this.renderPrototypeReadinessBanner(this._grokSelectedLeadId, 'grok-agent-preflight-banner');
        }
      }
    } catch (e) {
      console.error('Failed to save prototype rep context:', e);
      API.showToast('Failed to save context: ' + e.message, 'error');
      if (saveDraftBtn) saveDraftBtn.disabled = false;
      if (deployBtn) {
        deployBtn.disabled = false;
        deployBtn.textContent = deployNow ? '🚀 Save & Deploy Prototype Maker' : '💾 Save Draft';
      }
    }
  },

  async deployPrototypeMakerFromBanner(leadId) {
    if (!leadId) return;

    try {
      const data = await API.get(`/api/leads/${leadId}/prototype-rep-context`);
      const isBriefed = data?.readiness?.is_briefed;

      if (!isBriefed) {
        this.openPrototypeBriefingModal(leadId);
        return;
      }

      API.showToast('🚀 Deploying Prototype Maker...', 'info');
      const repCtx = data.rep_context || {};
      const payload = {
        primary_workflow: repCtx.primary_workflow || 'Operations & Dispatch',
        key_screens: repCtx.key_screens || ['Dashboard', 'Orders Kanban', '1-Click Invoice'],
        tactical_notes: repCtx.tactical_notes || '',
        target_viewport: repCtx.target_viewport || 'desktop',
        visual_style: repCtx.visual_style || 'zero7_dark',
        deploy_agent_now: true
      };

      await API.post(`/api/leads/${leadId}/prototype-rep-context`, payload);
      API.showToast('🚀 Prototype Maker job started!', 'success');
      await this.loadAgentJobs(leadId);
      this.renderPrototypeReadinessBanner(leadId, 'lead-agent-preflight-banner');
    } catch (e) {
      console.error('Error deploying from banner:', e);
      API.showToast('Failed to deploy Prototype Maker: ' + e.message, 'error');
    }
  },

  toggleWorkspaceDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('workspace-dropdown-menu');
    const arrow = document.getElementById('workspace-dropdown-arrow');
    if (!menu) return;
    const isShown = menu.style.display === 'flex';
    menu.style.display = isShown ? 'none' : 'flex';
    if (arrow) arrow.style.transform = isShown ? 'rotate(0deg)' : 'rotate(180deg)';
    if (!isShown) {
      const search = document.getElementById('workspace-search-input');
      if (search) {
        search.value = '';
        this.filterWorkspaceList('');
        setTimeout(() => search.focus(), 50);
      }
    }
  },

  closeWorkspaceDropdown() {
    const menu = document.getElementById('workspace-dropdown-menu');
    const arrow = document.getElementById('workspace-dropdown-arrow');
    if (menu) menu.style.display = 'none';
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  },

  filterWorkspaceList(query) {
    const container = document.getElementById('workspace-items-container');
    if (!container) return;

    const projects = this._availableProjects || [];
    const q = (query || '').toLowerCase().trim();
    const lead = this.state.selectedLead || {};
    const currentPath = (lead.project_path || '').toLowerCase();

    const filtered = projects.filter(p => {
      const pPath = (p.path || '').toLowerCase();
      const pName = (p.name || pPath.split('\\').pop() || '').toLowerCase();
      return !q || pName.includes(q) || pPath.includes(q);
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 24px 16px; color: var(--color-mid-gray); font-size: 12px;">
          No matching projects found for "${this.escapeHtml(query)}"
        </div>
      `;
      return;
    }

    let html = '';
    filtered.forEach(p => {
      const pPath = p.path;
      const pName = p.name || pPath.split('\\').pop() || 'Project';
      const isSelected = currentPath && (currentPath === pPath.toLowerCase() || currentPath === pPath);
      const pPathEscaped = this.escapeHtml(pPath).replace(/'/g, "\\'");

      html += `
        <div class="workspace-project-item ${isSelected ? 'active' : ''}" 
             onclick="App.handleWorkspaceChange('${lead.id}', '${pPathEscaped}'); App.closeWorkspaceDropdown();">
          <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden; flex: 1;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="display: inline-flex; align-items: center;">${Icons.folder(13)}</span>
              <strong style="font-size: 12px; color: var(--color-ink);">${this.escapeHtml(pName)}</strong>
              ${isSelected ? `<span style="font-size: 9.5px; background: var(--color-success-light); color: var(--color-success); padding: 1px 6px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">${Icons.check(9)} Active</span>` : ''}
              ${p.is_antigravity ? `<span style="font-size: 9.5px; background: var(--color-primary-light); color: var(--color-primary); padding: 1px 6px; border-radius: 4px; font-weight: 500;">Antigravity</span>` : ''}
            </div>
            <div style="font-size: 10.5px; color: var(--color-mid-gray); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all;">
              ${this.escapeHtml(pPath)}
            </div>
          </div>
          ${isSelected ? `<span style="color: var(--color-primary); display: inline-flex; align-items: center;">${Icons.check(13)}</span>` : ''}
        </div>
      `;
    });

    container.innerHTML = html;
  },

  async loadAvailableAgentProjects(lead) {
    try {
      const res = await API.get('/api/agent/projects');
      const projects = (res && res.projects) || [];
      this._availableProjects = projects;

      const currentPath = (lead && lead.project_path) || '';
      const leadBizName = (lead && (lead.business_name || lead.name || '')).trim().toLowerCase();

      let currentDisplay = currentPath ? (currentPath.split('\\').pop() || currentPath) : '';
      let matchedPath = currentPath;

      if (!matchedPath && projects.length > 0 && leadBizName) {
        const found = projects.find(p => {
          const pName = (p.name || p.path.split('\\').pop() || '').toLowerCase();
          return pName.includes(leadBizName) || leadBizName.includes(pName);
        });
        if (found) {
          matchedPath = found.path;
          currentDisplay = found.name || found.path.split('\\').pop() || found.path;
          this._activeProjectId = found.id || null;
          this._activeProjectName = found.name || currentDisplay;
        }
      }

      if (matchedPath && !this._activeProjectId) {
        const foundByPath = projects.find(p => p.path && p.path.toLowerCase() === matchedPath.toLowerCase());
        if (foundByPath) {
          this._activeProjectId = foundByPath.id || null;
          this._activeProjectName = foundByPath.name || currentDisplay;
        }
      }

      if (!currentDisplay) {
        currentDisplay = (lead && (lead.business_name || lead.name)) || 'Select Workspace';
      }

      const labelEl = document.getElementById('agent-workspace-label');
      if (labelEl) labelEl.textContent = currentDisplay;

      const hiddenInput = document.getElementById('agent-workspace-select');
      if (hiddenInput && matchedPath) hiddenInput.value = matchedPath;

      const badge = document.getElementById('workspace-count-badge');
      if (badge) badge.textContent = `${projects.length} Projects`;

      this.filterWorkspaceList('');
    } catch (e) {
      console.warn('Could not load agent projects:', e);
    }
  },

  async handleWorkspaceChange(leadId, selectedValue) {
    let targetPath = selectedValue;

    if (selectedValue === '__custom__') {
      const customPath = prompt('Enter absolute folder path on your Windows PC (e.g., C:\\Projects\\MyClient):');
      if (!customPath || !customPath.trim()) return;
      targetPath = customPath.trim();
    }

    try {
      API.showToast('Saving workspace path...', 'info');
      await API.put(`/api/leads/${leadId}`, { project_path: targetPath });
      
      const foundProj = (this._availableProjects || []).find(p => p.path && p.path.toLowerCase() === targetPath.toLowerCase());
      this._activeProjectId = foundProj ? foundProj.id : null;
      this._activeProjectName = foundProj ? foundProj.name : (targetPath.split('\\').pop() || targetPath);
      this._activeConversationId = null;

      if (this.state.selectedLead && this.state.selectedLead.id === leadId) {
        this.state.selectedLead.project_path = targetPath;
        this.state.selectedLead.project_id = this._activeProjectId;
        this.state.selectedLead.project_name = this._activeProjectName;
      }
      const leadInState = this.state.leads.find(l => l.id === leadId);
      if (leadInState) {
        leadInState.project_path = targetPath;
        leadInState.project_id = this._activeProjectId;
        leadInState.project_name = this._activeProjectName;
      }

      const hiddenInput = document.getElementById('agent-workspace-select');
      if (hiddenInput) hiddenInput.value = targetPath;

      const labelEl = document.getElementById('agent-workspace-label');
      if (labelEl) labelEl.textContent = targetPath.split('\\').pop() || targetPath;

      await this.loadAvailableAgentProjects(this.state.selectedLead || { id: leadId, project_path: targetPath, project_id: this._activeProjectId, project_name: this._activeProjectName });
      await this.loadProjectConversations(this.state.selectedLead || { id: leadId, project_path: targetPath, project_id: this._activeProjectId, project_name: this._activeProjectName });
      API.showToast(`Workspace assigned: ${this._activeProjectName}`, 'success');
    } catch (err) {
      console.error('Failed to update workspace path:', err);
      API.showToast('Failed to update workspace path: ' + (err.message || 'Error'), 'error');
    }
  },

  async openAntigravityProjectsModal(leadId) {
    try {
      API.showToast('Loading Antigravity projects...', 'info');
      const res = await API.get('/api/agent/projects');
      const projects = (res && res.projects) || [];
      const currentLead = this.state.selectedLead || this.state.leads.find(l => l.id === leadId) || {};
      const currentPath = (currentLead.project_path || '').toLowerCase();

      let modalHtml = `
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-hairline); padding: 14px 18px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-flex; align-items: center;">${Icons.folder(20)}</span>
            <div>
              <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--color-ink);">Antigravity Projects Manager</h3>
              <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--color-mid-gray);">All projects detected from Google Antigravity on your Windows host</p>
            </div>
          </div>
          <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
        </div>
        <div class="modal-body" style="padding: 16px 18px; max-height: 520px; overflow-y: auto;">
          <div style="margin-bottom: 14px; font-size: 12.5px; color: var(--color-ink-muted);">
            Assigning a project gives the Antigravity agent direct access to read, write, and run commands inside that repository.
            Target lead: <strong style="color: var(--color-ink);">${this.escapeHtml(currentLead.business_name || currentLead.name || 'Current Lead')}</strong>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
      `;

      if (projects.length === 0) {
        modalHtml += `
          <div style="padding: 30px 20px; text-align: center; color: var(--color-mid-gray); font-size: 13px;">
            No Antigravity projects detected. Make sure the local Antigravity worker is running on your Windows PC.
          </div>
        `;
      } else {
        projects.forEach(p => {
          const isAssigned = currentPath && p.path && currentPath === p.path.toLowerCase();
          const pPathEscaped = this.escapeHtml(p.path).replace(/'/g, "\\'");
          modalHtml += `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: ${isAssigned ? '#f0fdf4' : 'var(--color-surface-alt, #f8fafc)'}; border: 1px solid ${isAssigned ? '#86efac' : 'var(--color-hairline, #e2e8f0)'}; border-radius: 8px; gap: 12px;">
              <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden; flex: 1;">
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  <span style="display: inline-flex; align-items: center;">${Icons.folder(14)}</span>
                  <strong style="font-size: 13px; color: var(--color-ink);">${this.escapeHtml(p.name)}</strong>
                  ${p.is_antigravity ? `<span style="font-size: 10.5px; background: #e0e7ff; color: #3730a3; padding: 1px 6px; border-radius: 4px; font-weight: 600;">Antigravity Project</span>` : `<span style="font-size: 10.5px; background: #f1f5f9; color: #475569; padding: 1px 6px; border-radius: 4px;">Local Folder</span>`}
                  ${isAssigned ? `<span style="font-size: 10.5px; background: #dcfce7; color: #166534; padding: 1px 6px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">${Icons.check(10)} Currently Assigned</span>` : ''}
                </div>
                <div style="font-size: 11px; color: var(--color-mid-gray); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-all;">
                  ${this.escapeHtml(p.path)}
                </div>
              </div>
              <div style="flex-shrink: 0;">
                ${isAssigned ? `
                  <button class="btn btn-secondary btn-sm" disabled style="font-size: 11px; padding: 4px 10px; opacity: 0.75;">Assigned</button>
                ` : `
                  <button type="button" class="btn btn-primary btn-sm" onclick="App.handleWorkspaceChange('${leadId}', '${pPathEscaped}'); App.closeModal();" style="font-size: 11px; padding: 4px 12px; white-space: nowrap;">
                    Assign to Lead
                  </button>
                `}
              </div>
            </div>
          `;
        });
      }

      modalHtml += `
          </div>
          <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--color-hairline); display: flex; justify-content: space-between; align-items: center;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="App.handleWorkspaceChange('${leadId}', '__custom__'); App.closeModal();" style="font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.plus(11)} Enter Custom Folder Path...
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="App.closeModal()">Close</button>
          </div>
        </div>
      `;

      this.openModal(modalHtml);
    } catch (e) {
      console.error('Failed to open Antigravity projects modal:', e);
      API.showToast('Could not load Antigravity projects', 'error');
    }
  },

  async checkAgentWorkerStatus() {
    try {
      const res = await API.get('/api/agent/worker/status');
      const badge = document.getElementById('agent-worker-status-badge');
      const text = document.getElementById('agent-worker-status-text');
      if (badge && text) {
        if (res && res.online) {
          badge.className = 'agent-status-badge online';
          const port = res.metadata && res.metadata.port ? `:${res.metadata.port}` : '';
          text.textContent = `Worker Online (Windows 11${port ? ' ' + port : ''})`;
          badge.title = `Host language_server running. Last seen ${Math.round(res.diff_seconds || 0)}s ago.`;
        } else {
          badge.className = 'agent-status-badge offline';
          text.textContent = 'Worker Offline';
          badge.title = 'Local worker on your Windows PC is not running. Launch agent_worker/run_worker.bat to connect.';
        }
      }
    } catch (e) {
      console.warn('Could not check agent worker status:', e);
    }
  },

  async loadAgentJobs(leadId) {
    const feed = document.getElementById('agent-chat-feed');
    if (!feed) return;

    try {
      const res = await API.get(`/api/leads/${leadId}/agent/jobs`);
      const jobs = (res && res.jobs) || [];
      this.renderAgentChatFeed(leadId, jobs);

      const activeJob = jobs.find(j => j.status === 'pending' || j.status === 'running');
      if (activeJob) {
        this.startAgentJobStreaming(leadId, activeJob.id);
      } else {
        this.stopAgentJobStreaming();
      }
    } catch (e) {
      console.error('Failed to load agent jobs:', e);
    }
  },

  refreshAgentJobs(leadId) {
    this.checkAgentWorkerStatus();
    this.loadAgentJobs(leadId);
  },

  renderAgentChatFeed(leadId, jobs) {
    this._currentLeadJobs = jobs || [];
    const feed = document.getElementById('agent-chat-feed');
    if (!feed) return;

    const activeSlug = this._leadActiveAgentSlug || 'chief';
    const agentMeta = {
      prototype_maker: { icon: Icons.zap(22), coat: '#f19d38', name: 'Prototype Maker' },
      sow_architect: { icon: Icons.target(22), coat: '#a855f7', name: 'SOW Architect' },
      lead_researcher: { icon: Icons.search(22), coat: '#3b82f6', name: 'Lead Researcher' },
      whatsapp_nudge: { icon: Icons.messageSquare(22), coat: '#10b981', name: 'WhatsApp Nudge' },
      chief: { icon: Icons.crown(22), coat: '#64748b', name: 'Chief Orchestrator' }
    };
    const activeMeta = agentMeta[activeSlug] || agentMeta.chief;

    // Filter jobs for the selected agent
    const filteredJobs = (jobs || []).filter(job => {
      const slug = job.agent_slug || 'prototype_maker';
      return slug === activeSlug;
    });

    if (filteredJobs.length === 0) {
      let suggestionsHtml = '';
      if (activeSlug === 'prototype_maker') {
        suggestionsHtml = `
          <button type="button" class="baby-grok-suggestion-card" onclick="App.openPrototypeBriefingModal('${leadId}')" style="border: 1px solid rgba(241,157,56,0.35); background: rgba(241,157,56,0.06);">
            <span style="display: inline-flex; align-items: center; color: #f19d38;">${Icons.zap(16)}</span>
            <div>
              <div style="font-size: 12px; font-weight: 600; color: #f19d38;">🎯 Brief Prototype Maker with Sales Rep Context</div>
              <div style="font-size: 11px; color: hsl(var(--muted-foreground));">Specify must-have screens, workflow, and client nuances before launch</div>
            </div>
          </button>
          <button type="button" class="baby-grok-suggestion-card" onclick="App.insertAgentPrompt('Build a high-fidelity interactive web prototype for @lead.profile featuring an ROI calculator, modern UI, and automated client onboarding flow.')">
            <span style="display: inline-flex; align-items: center; color: #f19d38;">${Icons.play(16)}</span>
            <div>
              <div style="font-size: 12px; font-weight: 600; color: hsl(var(--foreground));">Quick Launch with Default Profile</div>
              <div style="font-size: 11px; color: hsl(var(--muted-foreground));">Tailwind prototype with live subdomain routing</div>
            </div>
          </button>
        `;
      } else if (activeSlug === 'lead_researcher') {
        suggestionsHtml = `
          <button type="button" class="baby-grok-suggestion-card" onclick="App.insertAgentPrompt('Analyze all call recordings and transcripts @transcripts.all for @lead.profile. Identify core pain points, objections, and feature wishlists.')">
            <span style="display: inline-flex; align-items: center; color: #3b82f6;">${Icons.search(16)}</span>
            <div>
              <div style="font-size: 12px; font-weight: 600; color: hsl(var(--foreground));">Audit Call Recordings &amp; Transcripts</div>
              <div style="font-size: 11px; color: hsl(var(--muted-foreground));">Extract client requirements and objection insights</div>
            </div>
          </button>
        `;
      } else if (activeSlug === 'whatsapp_nudge') {
        suggestionsHtml = `
          <button type="button" class="baby-grok-suggestion-card" onclick="App.insertAgentPrompt('Review recent WhatsApp exchanges in @whatsapp.all for @lead.profile and compose a polite, high-converting re-engagement nudge.')">
            <span style="display: inline-flex; align-items: center; color: #10b981;">${Icons.messageSquare(16)}</span>
            <div>
              <div style="font-size: 12px; font-weight: 600; color: hsl(var(--foreground));">Draft WhatsApp Re-engagement Nudge</div>
              <div style="font-size: 11px; color: hsl(var(--muted-foreground));">Hyper-personalized follow-up citing past chats</div>
            </div>
          </button>
        `;
      } else if (activeSlug === 'sow_architect') {
        suggestionsHtml = `
          <button type="button" class="baby-grok-suggestion-card" onclick="App.insertAgentPrompt('Draft a full Client Scope of Work (SOW) for @lead.profile including technical deliverables, Phase 1 MVP sprint breakdown, timeline, and commercial terms.')">
            <span style="display: inline-flex; align-items: center; color: #a855f7;">${Icons.target(16)}</span>
            <div>
              <div style="font-size: 12px; font-weight: 600; color: hsl(var(--foreground));">Draft Client Scope of Work (SOW)</div>
              <div style="font-size: 11px; color: hsl(var(--muted-foreground));">Comprehensive roadmap and sprint breakdown</div>
            </div>
          </button>
        `;
      } else {
        suggestionsHtml = `
          <button type="button" class="baby-grok-suggestion-card" onclick="App.insertAgentPrompt('Analyze @lead.profile with @transcripts.all and @whatsapp.all. Formulate a 3-step action plan, delegate prototype creation and SOW estimation across teammates.')">
            <span style="display: inline-flex; align-items: center; color: #64748b;">${Icons.crown(16)}</span>
            <div>
              <div style="font-size: 12px; font-weight: 600; color: hsl(var(--foreground));">Formulate Client Action Plan &amp; Delegate</div>
              <div style="font-size: 11px; color: hsl(var(--muted-foreground));">Synthesize all client data and orchestrate teammates</div>
            </div>
          </button>
        `;
      }

      feed.innerHTML = `
        <div class="baby-grok-empty-state" style="padding: 40px 20px; text-align: center; max-width: 520px; margin: auto;">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: ${activeMeta.coat}; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; color: white;">
            ${activeMeta.icon}
          </div>
          <h4 style="font-size: 15px; font-weight: 600; color: hsl(var(--foreground)); margin: 0 0 6px 0;">${this.escapeHtml(activeMeta.name)} Ready</h4>
          <p style="font-size: 12.5px; color: hsl(var(--muted-foreground)); margin: 0 0 20px 0; line-height: 1.5;">
            Conversations and tasks for <strong>${this.escapeHtml(activeMeta.name)}</strong> on this client. Execute tasks directly or use data pills with @.
          </p>
          <div style="display: flex; flex-direction: column; gap: 8px; text-align: left;">
            ${suggestionsHtml}
          </div>
        </div>
      `;
      return;
    }

    let html = '<div class="baby-grok-chat-container">';
    filteredJobs.forEach(job => {
      const timeStr = job.created_at ? new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const dateStr = job.created_at ? new Date(job.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Today';

      // User prompt card (Antigravity Style)
      html += `
        <div class="antigravity-turn-user">
          <div class="antigravity-user-bubble">
            ${this.formatGrokPromptHtml(job.prompt)}
          </div>
        </div>
      `;

      // Assistant response turn (Antigravity Style)
      const isRunning = job.status === 'pending' || job.status === 'running';
      const isFailed = job.status === 'failed';
      const outputText = job.stream_output || '';

      // Calculate duration string e.g. "Worked for 5m" or "Worked for 14s"
      let durationStr = '5m';
      if (job.duration_seconds) {
        durationStr = job.duration_seconds >= 60 ? `${Math.floor(job.duration_seconds / 60)}m` : `${Math.round(job.duration_seconds)}s`;
      } else if (job.created_at && job.updated_at) {
        const diffSecs = Math.max(1, Math.round((new Date(job.updated_at) - new Date(job.created_at)) / 1000));
        durationStr = diffSecs >= 60 ? `${Math.floor(diffSecs / 60)}m` : `${diffSecs}s`;
      }

      html += `
        <div class="antigravity-turn-agent" id="agent-job-card-${job.id}">
          <!-- Minimal Antigravity Thought Trace (Worked for 5m >) -->
          <div class="antigravity-thinking-accordion agent-thinking-box" style="display: ${job.thoughts || isRunning ? 'block' : 'none'};">
            <details class="antigravity-thinking-details" ${isRunning ? 'open' : ''}>
              <summary class="antigravity-thinking-summary">
                <span class="antigravity-thinking-text agent-thinking-label">
                  ${isRunning ? `<span class="spin">${Icons.refresh(12)}</span> Thinking...` : `Worked for ${durationStr}`}
                </span>
                <span class="antigravity-thinking-arrow">${Icons.chevronRight(12)}</span>
              </summary>
              <div class="antigravity-thinking-drawer">
                <pre class="antigravity-thinking-code agent-thinking-content">${this.escapeHtml(job.thoughts || 'Agent active. Analyzing project files & workspace...')}</pre>
              </div>
            </details>
          </div>

          <!-- Markdown Response Body -->
          <div class="antigravity-markdown-body agent-output-markdown">
            ${job.stream_output && job.stream_output.trim() ? this.renderAgentMarkdown(job.stream_output) : (isRunning ? `
              <div class="agent-stream-placeholder" style="font-size: 13px; color: var(--color-mid-gray); font-style: italic; padding: 8px 0; display: flex; align-items: center; gap: 8px;">
                <span class="agent-pulse-dot" style="background:#2563eb; width:8px; height:8px; border-radius:50%; display:inline-block; animation:agentPulse 1.2s infinite;"></span>
                <span>Agent is analyzing workspace files and formulating response...</span>
              </div>
            ` : '')}
          </div>

          <!-- Subtle Response Action Buttons -->
          <div class="antigravity-response-actions">
            <button type="button" class="antigravity-action-btn" onclick="App.copyMessageText(this, decodeURIComponent('${encodeURIComponent(outputText)}'))" title="Copy response markdown">
              ${Icons.copy(12)} Copy
            </button>
          </div>

          <!-- Error message if any -->
          ${job.error_message ? `
            <div style="background: hsl(var(--destructive) / 0.15); border: 1px solid hsl(var(--destructive) / 0.4); border-radius: 6px; padding: 10px 12px; font-size: 12.5px; color: #f87171; margin-top: 8px;">
              <strong>Error:</strong> ${this.escapeHtml(job.error_message)}
            </div>
          ` : ''}

          <!-- Artifacts / Deliverables Card -->
          ${(job.artifacts && job.artifacts.length > 0) ? `
            <div class="antigravity-artifacts-card">
              <div class="antigravity-artifacts-header">
                <div style="display: flex; align-items: center; gap: 6px;">
                  ${Icons.fileText(14)}
                  <span style="font-weight: 600; font-size: 12px;">Generated Deliverables (${job.artifacts.length})</span>
                </div>
              </div>
              <div class="antigravity-artifacts-list">
                ${job.artifacts.map(art => `
                  <div class="antigravity-artifact-item">
                    <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                      ${Icons.fileText(14)}
                      <div style="min-width: 0;">
                        <div style="font-weight: 600; font-size: 12px; color: hsl(var(--foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(art.name || art.path || 'Artifact')}</div>
                        ${art.summary ? `<div style="font-size: 11px; color: hsl(var(--muted-foreground));">${this.escapeHtml(art.summary)}</div>` : ''}
                      </div>
                    </div>
                    ${art.path ? `
                      <button type="button" class="btn btn-secondary btn-xs" onclick="navigator.clipboard.writeText('${this.escapeHtml(art.path).replace(/\\/g, '\\\\')}'); API.showToast('Copied path!', 'success');">Copy Path</button>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    });
    html += '</div>';

    feed.innerHTML = html;
    feed.scrollTop = feed.scrollHeight;
  },

  insertAgentPrompt(text) {
    const input = document.getElementById('agent-prompt-input');
    if (input) {
      input.value = text;
      input.focus();
    }
  },

  async submitAgentJob(leadId) {
    const input = document.getElementById('agent-prompt-input');
    const submitBtn = document.getElementById('agent-submit-btn');
    const workspaceSelect = document.getElementById('agent-workspace-select');

    const prompt = input ? input.value.trim() : '';
    if (!prompt) return;

    const activeSlug = this._leadActiveAgentSlug || 'chief';
    const model = this._getLeadActiveModel(leadId);
    const role = 'engineer';
    const agentSlug = activeSlug;
    const projectPath = workspaceSelect && workspaceSelect.value !== '__custom__' ? workspaceSelect.value : null;

    if (submitBtn) submitBtn.disabled = true;
    if (input) input.disabled = true;

    try {
      const res = await API.post(`/api/leads/${leadId}/agent/jobs`, {
        prompt: prompt,
        model: model,
        role: role,
        agent_slug: agentSlug,
        project_path: projectPath,
        project_id: this._activeProjectId,
        project_name: this._activeProjectName,
        conversation_id: this._activeConversationId,
        execution_target: 'cloud'
      });

      if (input) {
        input.value = '';
        input.disabled = false;
      }
      API.showToast('Task submitted to Antigravity Agent!', 'success');

      if (res && res.conversation_id) {
        this._activeConversationId = res.conversation_id;
      }

      await this.loadAgentJobs(leadId);
      if (res && res.id) {
        this.startAgentJobStreaming(leadId, res.id);
      }

      // Schedule background refresh of conversations so new thread appears in sidebar
      setTimeout(() => {
        const lead = this.state.selectedLead || { id: leadId, project_path: projectPath, project_id: this._activeProjectId, project_name: this._activeProjectName };
        this.loadProjectConversations(lead);
      }, 3500);
    } catch (e) {
      API.showToast('Failed to submit agent task: ' + (e.message || 'Error'), 'error');
      if (input) input.disabled = false;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  },

  updateAgentJobCardDOM(job) {
    const card = document.getElementById(`agent-job-card-${job.id}`);
    if (!card) return false;

    // 1. Live status badge update
    const statusContainer = card.querySelector('.agent-job-status-badge');
    if (statusContainer) {
      if (job.status === 'running') {
        statusContainer.innerHTML = `<span class="baby-grok-status-badge running" style="display:inline-flex; align-items:center; gap:4px;"><span class="spin">${Icons.loader(11)}</span> Executing on Windows Host...</span>`;
      } else if (job.status === 'pending') {
        statusContainer.innerHTML = `<span class="baby-grok-status-badge pending" style="display:inline-flex; align-items:center; gap:4px;"><span class="spin">${Icons.loader(11)}</span> Queued (Waiting for worker)...</span>`;
      } else if (job.status === 'completed') {
        statusContainer.innerHTML = `<span class="baby-grok-status-badge success" style="display:inline-flex; align-items:center; gap:4px;">${Icons.check(11)} Completed</span>`;
      } else if (job.status === 'failed') {
        statusContainer.innerHTML = `<span class="baby-grok-status-badge error" style="display:inline-flex; align-items:center; gap:4px;">${Icons.close(11)} Failed</span>`;
      }
    }

    // 2. Live thoughts / tool call trace stream
    const thinkingBox = card.querySelector('.antigravity-thinking-accordion') || card.querySelector('.agent-thinking-box');
    const thoughtsEl = card.querySelector('.antigravity-thinking-code') || card.querySelector('.agent-thinking-content');
    const thinkingLabel = card.querySelector('.antigravity-thinking-text') || card.querySelector('.agent-thinking-label');
    if (job.thoughts) {
      if (thinkingBox) thinkingBox.style.display = 'block';
      if (thoughtsEl) thoughtsEl.textContent = job.thoughts;
      if (thinkingLabel) {
        if (job.status === 'running' || job.status === 'pending') {
          thinkingLabel.innerHTML = `<span class="spin" style="display:inline-flex; align-items:center; margin-right:4px;">${Icons.loader(11)}</span> Thinking (${job.thoughts.length.toLocaleString()} chars)...`;
        } else {
          const diffSecs = job.duration_seconds || (job.created_at && job.updated_at ? Math.max(1, Math.round((new Date(job.updated_at) - new Date(job.created_at)) / 1000)) : 15);
          const durationStr = diffSecs >= 60 ? `${Math.floor(diffSecs / 60)}m` : `${diffSecs}s`;
          thinkingLabel.textContent = `Worked for ${durationStr}`;
        }
      }
    }

    // 3. Live stream output markdown update
    const outputEl = card.querySelector('.agent-output-markdown');
    if (outputEl && job.stream_output && job.stream_output.trim()) {
      outputEl.innerHTML = this.renderAgentMarkdown(job.stream_output);
    }

    // 4. Smooth auto-scroll feed
    const feed = document.getElementById('agent-chat-feed');
    if (feed) {
      feed.scrollTop = feed.scrollHeight;
    }
    return true;
  },

  autoResizeComposer(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  },

  handleComposerKeyDown(event, leadId) {
    const popover = document.getElementById('pill-autocomplete-popover');
    if ((!popover || popover.style.display === 'none') && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submitAgentJob(leadId);
    }
  },

  scrollChatToBottom() {
    const feed = document.getElementById('agent-chat-feed');
    if (feed) {
      feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    }
  },

  _getLeadActiveModel(leadId) {
    if (this._leadSelectedModels && leadId && this._leadSelectedModels[leadId]) {
      return this._leadSelectedModels[leadId];
    }
    return 'antigravity/gemini-3.7-flash-tiered';
  },

  _getLeadAgentModelLabel(leadId) {
    const model = this._getLeadActiveModel(leadId);
    const map = {
      'antigravity/gemini-3.7-flash-tiered': 'Gemini 3.7 Flash (OAuth)',
      'antigravity/gemini-3.8-flash-tiered': 'Gemini 3.8 Flash (OAuth)',
      'antigravity/gpt-oss-120b-medium': 'GPT-OSS 120B (OAuth)',
      'pro': 'Gemini 3.7 Flash (OAuth)',
      'auto/best-fast': 'OmniRoute Fast Combo',
      'auto/best-reasoning': 'OmniRoute Reasoning',
      'auto/best-coding': 'OmniRoute Best Coding',
      'kimi-coding/k3': 'Kimi K3 (Moonshot)',
      'auto/deepseek': 'DeepSeek V4 Auto',
      'flash': 'Gemini 3.7 Flash (OAuth)',
      'flash_lite': 'Flash Lite',
      'claude-3-7-sonnet': 'Claude 3.7 Sonnet',
      'claude-3-5-sonnet': 'Claude 3.5 Sonnet'
    };
    return map[model] || model;
  },

  toggleModelSelectorDropdown(event, leadId) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('antigravity-model-dropdown');
    if (!dropdown) return;

    if (dropdown.style.display === 'block') {
      dropdown.style.display = 'none';
      return;
    }

    const currentModel = this._getLeadActiveModel(leadId);
    const models = [
      {
        id: 'antigravity/gemini-3.7-flash-tiered',
        name: 'Gemini 3.7 Flash (Antigravity OAuth)',
        engine: 'OmniRoute Dedicated 24/7 Engine',
        desc: 'Blazing fast, zero token cost, native Antigravity OAuth session',
        badge: 'OAUTH LIVE',
        badgeClass: 'fast',
        icon: Icons.zap(14),
        iconClass: 'flash'
      },
      {
        id: 'antigravity/gemini-3.8-flash-tiered',
        name: 'Gemini 3.8 Flash (Antigravity OAuth)',
        engine: 'OmniRoute Dedicated 24/7 Engine',
        desc: 'Latest high-speed reasoning via Antigravity OAuth session',
        badge: 'OAUTH',
        badgeClass: 'fast',
        icon: Icons.sparkles(14),
        iconClass: 'flash'
      },
      {
        id: 'auto/best-fast',
        name: 'OmniRoute Fast Combo',
        engine: 'Multi-Provider Cloud Cascade',
        desc: 'Sub-second lead qualification, WhatsApp triage & real-time failover',
        badge: 'FAST',
        badgeClass: 'fast',
        icon: Icons.zap(14),
        iconClass: 'flash'
      },
      {
        id: 'auto/best-reasoning',
        name: 'OmniRoute Deep Reasoning',
        engine: 'DeepSeek R1 / Claude Thinking Combo',
        desc: 'Deep company research, SOW architecture & complex pain-point analysis',
        badge: 'REASON',
        badgeClass: 'claude',
        icon: Icons.brain(14),
        iconClass: 'claude'
      },
      {
        id: 'auto/best-coding',
        name: 'OmniRoute Best Coding',
        engine: 'Kimi K3 / Claude 3.5 / DeepSeek Combo',
        desc: 'High-speed automated prototype code generation & UI synthesis',
        badge: 'CODE',
        badgeClass: 'fast',
        icon: Icons.code(14),
        iconClass: 'flash'
      },
      {
        id: 'kimi-coding/k3',
        name: 'Kimi K3 (Moonshot AI)',
        engine: 'Kimi K3 Coding 128k',
        desc: 'High-speed full-context coding & automated software architecture',
        badge: 'KIMI',
        badgeClass: 'lite',
        icon: Icons.sparkles(14),
        iconClass: 'lite'
      },
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        engine: 'Anthropic Claude via OmniRoute',
        desc: 'High precision UI design, component building & refactoring',
        badge: 'CLAUDE',
        badgeClass: 'claude',
        icon: Icons.code(14),
        iconClass: 'claude'
      }
    ];

    dropdown.innerHTML = `
      <div class="antigravity-model-dropdown-header">
        <div class="antigravity-model-dropdown-title">OmniRoute & Antigravity Models</div>
        <div class="antigravity-model-dropdown-sub">Select multi-tier model for agent execution</div>
      </div>
      <div class="antigravity-model-options-list">
        ${models.map(m => `
          <div class="antigravity-model-option ${m.id === currentModel ? 'active' : ''}" 
               onclick="App.selectAgentModel('${m.id}', '${leadId}')">
            <div class="antigravity-model-option-icon ${m.iconClass}">${m.icon}</div>
            <div class="antigravity-model-option-info">
              <div class="antigravity-model-option-head">
                <span class="antigravity-model-option-name">${m.name}</span>
                <span class="antigravity-model-badge ${m.badgeClass}">${m.badge}</span>
              </div>
              <div class="antigravity-model-option-desc">${m.desc}</div>
            </div>
            ${m.id === currentModel ? `<span class="antigravity-model-check" style="display:inline-flex; align-items:center;">${Icons.check(12)}</span>` : ''}
          </div>
        `).join('')}
      </div>
      <div class="antigravity-model-dropdown-footer">
        <span style="display:inline-flex; align-items:center; gap:5px;">${Icons.zap(11)} Connected to OmniRoute Gateway & Antigravity Workstation</span>
      </div>
    `;

    dropdown.style.display = 'block';

    if (!this._boundModelDropdownDismiss) {
      this._boundModelDropdownDismiss = true;
      document.addEventListener('click', (e) => {
        const dd = document.getElementById('antigravity-model-dropdown');
        if (dd && dd.style.display === 'block') {
          if (!dd.contains(e.target) && !e.target.closest('.antigravity-model-selector-pill')) {
            dd.style.display = 'none';
          }
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const dd = document.getElementById('antigravity-model-dropdown');
          if (dd) dd.style.display = 'none';
        }
      });
    }
  },

  selectAgentModel(modelId, leadId) {
    if (!this._leadSelectedModels) this._leadSelectedModels = {};
    if (leadId) {
      this._leadSelectedModels[leadId] = modelId;
    }
    this._activeAgentModel = modelId;

    const labelEl = document.querySelector('.antigravity-model-name');
    if (labelEl) {
      labelEl.textContent = this._getLeadAgentModelLabel(leadId);
    }

    const dd = document.getElementById('antigravity-model-dropdown');
    if (dd) dd.style.display = 'none';

    API.showToast('Switched model to ' + this._getLeadAgentModelLabel(leadId), 'success');
  },

  startAgentJobStreaming(leadId, jobId) {
    this.stopAgentJobStreaming();

    // Zero-Latency Server-Sent Events (SSE)
    if (window.EventSource) {
      try {
        const sseUrl = `/api/agent/jobs/${jobId}/events`;
        const es = new EventSource(sseUrl);
        this._agentEventSource = es;

        es.onmessage = async (e) => {
          try {
            const job = JSON.parse(e.data);
            if (!job) return;

            if (job.status === 'completed' || job.status === 'failed') {
              this.stopAgentJobStreaming();
              if (job.conversation_id) {
                this._activeConversationId = job.conversation_id;
              }
              await this.loadAgentJobs(leadId);
              const lead = this.state.selectedLead || { id: leadId };
              this.loadProjectConversations(lead);
              API.showToast(job.status === 'completed' ? 'Agent task finished!' : 'Agent task encountered an error', job.status === 'completed' ? 'success' : 'error');
              return;
            }

            const updated = this.updateAgentJobCardDOM(job);
            if (!updated) {
              await this.loadAgentJobs(leadId);
            }
          } catch (err) {
            console.error('SSE event parse error:', err);
          }
        };

        es.onerror = (err) => {
          console.warn('SSE stream closed or disconnected, using polling fallback...', err);
          this.stopAgentJobStreaming();
          this.startAgentJobPolling(leadId, jobId);
        };
        return;
      } catch (e) {
        console.warn('EventSource failed, using polling fallback:', e);
      }
    }

    // Fallback to polling
    this.startAgentJobPolling(leadId, jobId);
  },

  startAgentJobPolling(leadId, jobId) {
    this.stopAgentJobPolling();
    this._agentPollingTimer = setInterval(async () => {
      try {
        const job = await API.get(`/api/agent/jobs/${jobId}`);
        if (!job) return;

        if (job.status === 'completed' || job.status === 'failed') {
          this.stopAgentJobPolling();
          if (job.conversation_id) {
            this._activeConversationId = job.conversation_id;
          }
          await this.loadAgentJobs(leadId);
          const lead = this.state.selectedLead || { id: leadId };
          this.loadProjectConversations(lead);
          API.showToast(job.status === 'completed' ? 'Agent task finished!' : 'Agent task encountered an error', job.status === 'completed' ? 'success' : 'error');
          return;
        }

        const updated = this.updateAgentJobCardDOM(job);
        if (!updated) {
          await this.loadAgentJobs(leadId);
        }
      } catch (e) {
        console.warn('Agent job polling error:', e);
      }
    }, 1000);
  },

  stopAgentJobStreaming() {
    if (this._agentEventSource) {
      this._agentEventSource.close();
      this._agentEventSource = null;
    }
    this.stopAgentJobPolling();
  },

  stopAgentJobPolling() {
    if (this._agentPollingTimer) {
      clearInterval(this._agentPollingTimer);
      this._agentPollingTimer = null;
    }
  },

  toggleAgentVoiceDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice dictation is supported in Google Chrome, Microsoft Edge, Safari, and modern mobile browsers.');
      return;
    }

    const micBtn = document.getElementById('agent-mic-btn');
    const micLabel = document.getElementById('agent-mic-label');
    const input = document.getElementById('agent-prompt-input');

    if (this._isAgentDictating && this._agentSpeechRecognition) {
      try { this._agentSpeechRecognition.stop(); } catch(e) {}
      this._isAgentDictating = false;
      if (micBtn) micBtn.classList.remove('listening');
      if (micLabel) micLabel.textContent = 'Dictate';
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        this._isAgentDictating = true;
        if (micBtn) micBtn.classList.add('listening');
        if (micLabel) micLabel.textContent = 'Listening...';
        API.showToast('Listening... Speak your instructions now.', 'info');
      };

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (input && transcript) {
          if (!input._baseVoiceText) {
            input._baseVoiceText = input.value ? (input.value.trim() + ' ') : '';
          }
          input.value = input._baseVoiceText + transcript;
        }
      };

      recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        this._isAgentDictating = false;
        if (micBtn) micBtn.classList.remove('listening');
        if (micLabel) micLabel.textContent = 'Dictate';
      };

      recognition.onend = () => {
        this._isAgentDictating = false;
        if (input) input._baseVoiceText = null;
        if (micBtn) micBtn.classList.remove('listening');
        if (micLabel) micLabel.textContent = 'Dictate';
      };

      this._agentSpeechRecognition = recognition;
      recognition.start();
    } catch (e) {
      console.error('Error starting speech recognition:', e);
      alert('Could not access microphone: ' + e.message);
    }
  },

  renderAgentMarkdown(text) {
    if (!text) return '';
    let raw = (typeof text === 'string' ? text : JSON.stringify(text)).trim();

    // 1. If marked is available, use it with GFM options
    let html = '';
    const markedLib = window.marked || (typeof marked !== 'undefined' ? marked : null);
    if (markedLib && typeof markedLib.parse === 'function') {
      try {
        // Pre-process GitHub alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
        raw = raw.replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/gim, (m, type, title) => {
          return `> **[${type.toUpperCase()}]** ${title}`;
        });

        html = markedLib.parse(raw, {
          gfm: true,
          breaks: true
        });
      } catch (err) {
        console.warn('marked.parse error, using fallback:', err);
        html = this.renderAgentMarkdownFallback(raw);
      }
    } else {
      html = this.renderAgentMarkdownFallback(raw);
    }

    // 2. Wrap <pre><code class="language-xyz"> in .code-block-container with header and copy button
    html = html.replace(/<pre><code(?:\s+class="language-([a-zA-Z0-9_-]+)")?>([\s\S]*?)<\/code><\/pre>/g, (match, lang, code) => {
      const displayLang = (lang || 'code').toUpperCase();
      return `
        <div class="code-block-container">
          <div class="code-block-header">
            <span class="code-lang-label">${this.escapeHtml(displayLang)}</span>
            <button type="button" class="code-copy-btn" onclick="App.copyCodeBlock(this)" title="Copy code">
              ${Icons.copy(12)} Copy
            </button>
          </div>
          <pre><code class="language-${lang || 'text'}">${code}</code></pre>
        </div>
      `;
    });

    // 3. Transform GitHub alert blockquotes into styled alert cards
    html = html.replace(/<blockquote>\s*<p>\s*<strong>\[(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]<\/strong>\s*([\s\S]*?)<\/p>\s*<\/blockquote>/gi, (match, type, content) => {
      const alertType = type.toLowerCase();
      const icons = {
        note: Icons.info(16),
        tip: Icons.sparkles(16),
        important: Icons.pin(16),
        warning: Icons.alert(16),
        caution: Icons.xCircle(16)
      };
      return `
        <div class="markdown-alert markdown-alert-${alertType}">
          <span class="markdown-alert-icon" style="display:inline-flex; align-items:center;">${icons[alertType] || Icons.info(16)}</span>
          <div class="markdown-alert-content">
            <strong>${type.toUpperCase()}:</strong> ${content}
          </div>
        </div>
      `;
    });

    // 4. Transform file:/// links into clickable file pills
    html = html.replace(/<a\s+href="(file:\/\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi, (match, fileUrl, label) => {
      const cleanPath = decodeURIComponent(fileUrl.replace(/^file:\/\/\//, ''));
      return `<span class="markdown-file-pill" onclick="navigator.clipboard.writeText('${this.escapeHtml(cleanPath)}'); API.showToast('Copied file path: ${this.escapeHtml(cleanPath)}', 'info');" title="Click to copy path: ${this.escapeHtml(cleanPath)}" style="display:inline-flex; align-items:center; gap:4px;">${Icons.fileText(12)} <span>${label}</span></span>`;
    });

    // 5. Open external links in a new tab safely
    html = html.replace(/<a\s+(href="https?:\/\/[^"]+")/gi, '<a $1 target="_blank" rel="noopener noreferrer"');

    return html;
  },

  renderAgentMarkdownFallback(text) {
    if (!text) return '';
    let md = text;

    md = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code class="language-${lang}">${this.escapeHtml(code.trim())}</code></pre>`;
    });

    md = md.replace(/`([^`]+)`/g, (match, code) => `<code>${this.escapeHtml(code)}</code>`);
    md = md.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    md = md.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    md = md.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    md = md.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    md = md.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    md = md.replace(/^---$/gim, '<hr>');
    md = md.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');
    md = md.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
    md = md.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    const paras = md.split(/\n\n+/);
    md = paras.map(p => {
      p = p.trim();
      if (!p) return '';
      if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<ul') || p.startsWith('<block') || p.startsWith('<hr')) {
        return p;
      }
      return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
    }).join('');

    return md;
  },

  copyCodeBlock(btn) {
    const container = btn.closest('.code-block-container');
    const code = container ? container.querySelector('code') : null;
    if (!code) return;
    const text = code.innerText || code.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.innerHTML;
      btn.innerHTML = `${Icons.check(12)} Copied!`;
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }).catch(() => {
      API.showToast('Failed to copy code', 'error');
    });
  },

  copyMessageText(btn, text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.innerHTML;
      btn.innerHTML = `${Icons.check(12)} Copied!`;
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }).catch(() => {
      API.showToast('Failed to copy text', 'error');
    });
  },

  // ==================== CLIENT DELIVERABLES & PIPELINE METHODS ====================

  renderDeliverablesPipeline(lead) {
    const container = document.getElementById('agent-deliverables-pipeline-container');
    if (!container) return;
    const currentLead = lead || this.state.selectedLead;
    if (!currentLead) return;

    const leadId = currentLead.id;
    const protos = (this.state.leadPrototypes && this.state.leadPrototypes[leadId]) || [];
    const activeProto = protos.length > 0 ? protos[0] : null;

    // 1. Prototype details
    const protoUrl = currentLead.prototype_url || (activeProto?.share_token ? `${window.location.origin}/api/public/prototype/${activeProto.share_token}` : '');
    const protoStatus = currentLead.prototype_status || (protoUrl ? 'built' : 'pending');

    // 2. Subdomain details
    const cleanBizSlug = (currentLead.business_name || currentLead.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const subdomain = currentLead.subdomain || `${cleanBizSlug}.zero7.space`;
    const subdomainStatus = currentLead.subdomain_status || 'pending';
    const isSubdomainActive = subdomainStatus === 'active';

    // 3. Demo video details
    const demoVideoUrl = currentLead.demo_video_url || '';
    const demoVideoTitle = currentLead.demo_video_title || 'Client Prototype Walkthrough';
    const demoVideoStatus = currentLead.demo_video_status || (demoVideoUrl ? 'built' : 'pending');
    const isVideoBuilt = demoVideoStatus === 'built' && demoVideoUrl;

    // 4. SOW & Strategic Brief
    const brief = currentLead.company_brief || (this.state.companyBriefs && this.state.companyBriefs[leadId]) || null;

    // 5. Host Workspace Path
    const projectPath = currentLead.project_path || `C:\\Users\\m_hit\\Desktop\\zero7 Consultancy\\Projects\\${currentLead.business_name || currentLead.name || 'Lead'}`;

    let html = `
      <div class="baby-grok-inspector-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 13px; font-weight: 600; color: hsl(var(--foreground));">Client Intelligence &amp; Deliverables</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <button type="button" class="btn-icon" onclick="App.refreshDeliverablesPipeline('${leadId}')" title="Refresh Deliverables" style="padding: 4px;">${Icons.refresh(13)}</button>
          <button type="button" class="btn-icon" onclick="App.toggleDeliverablesPanel()" title="Close Inspector" style="padding: 4px;">${Icons.close(13)}</button>
        </div>
      </div>

      <div class="baby-grok-inspector-body">
        <!-- Card 1: Assigned Client Subdomain -->
        <div class="baby-grok-inspector-card">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; color: hsl(var(--foreground));">
              <span style="display: inline-flex; align-items: center; color: #38bdf8;">${Icons.globe(14)}</span>
              <span>Client Subdomain Routing</span>
            </div>
            <span class="baby-grok-card-badge ${isSubdomainActive ? 'baby-grok-badge-done' : 'baby-grok-badge-working'}">
              ${isSubdomainActive ? 'Live &amp; Routed' : 'Pending DNS'}
            </span>
          </div>

          <div class="baby-grok-url-pill">
            <span style="font-size: 11.5px; font-family: var(--font-mono); color: #38bdf8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">https://${this.escapeHtml(subdomain)}</span>
            <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
              <button type="button" class="btn-icon" style="padding: 2px 4px; font-size: 11px;" onclick="navigator.clipboard.writeText('https://${this.escapeHtml(subdomain)}'); API.showToast('Copied subdomain URL!', 'success');" title="Copy URL">${Icons.copy(12)}</button>
              <a href="https://${this.escapeHtml(subdomain)}" target="_blank" class="btn-icon" style="padding: 2px 4px; font-size: 11px; text-decoration: none;" title="Open Subdomain">${Icons.externalLink(12)}</a>
            </div>
          </div>

          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.openSubdomainModal('${leadId}')">
              ${Icons.settings(12)} Settings
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.insertAgentPrompt('Assign and configure Cloudflare DNS and SSL routing for subdomain https://${this.escapeHtml(subdomain)} for client ${this.escapeHtml(currentLead.business_name || currentLead.name)}.')">
              ${Icons.zap(12)} Configure via Agent
            </button>
          </div>
        </div>

        <!-- Card 2: Interactive Concept Prototype -->
        <div class="baby-grok-inspector-card">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; color: hsl(var(--foreground));">
              <span style="display: inline-flex; align-items: center; color: #34d399;">${Icons.monitor(14)}</span>
              <span>Concept Prototype</span>
            </div>
            <span class="baby-grok-card-badge ${protoStatus === 'built' && protoUrl ? 'baby-grok-badge-done' : 'baby-grok-badge-working'}">
              ${protoStatus === 'built' && protoUrl ? 'Built &amp; Deployed' : 'In Development'}
            </span>
          </div>

          ${protoUrl ? `
            <div class="baby-grok-url-pill">
              <span style="font-size: 11.5px; font-family: var(--font-mono); color: #34d399; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(protoUrl)}</span>
              <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                <button type="button" class="btn-icon" style="padding: 2px 4px; font-size: 11px;" onclick="navigator.clipboard.writeText('${this.escapeHtml(protoUrl)}'); API.showToast('Copied prototype link!', 'success');" title="Copy Link">${Icons.copy(12)}</button>
                <a href="${this.escapeHtml(protoUrl)}" target="_blank" class="btn-icon" style="padding: 2px 4px; font-size: 11px; text-decoration: none;" title="Open Prototype">${Icons.externalLink(12)}</a>
              </div>
            </div>

            <!-- Mini Interactive Preview Frame -->
            <div class="prototype-mini-preview" onclick="window.open('${this.escapeHtml(protoUrl)}', '_blank')" style="border-radius: 6px; border: 1px solid hsl(var(--border)); overflow: hidden; height: 130px; position: relative; cursor: pointer; background: #000;">
              <iframe src="${this.escapeHtml(protoUrl)}" loading="lazy" style="width: 100%; height: 100%; border: none; pointer-events: none; transform: scale(0.65); transform-origin: top left; width: 153%; height: 153%;"></iframe>
              <div class="prototype-mini-overlay" style="position: absolute; inset: 0; background: rgba(0,0,0,0.45); opacity: 0; transition: opacity 0.15s ease; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 500;">
                <span style="display: inline-flex; align-items: center; gap: 6px;">${Icons.externalLink(13)} Click to Open Live Prototype</span>
              </div>
            </div>

            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
              <a href="${this.escapeHtml(protoUrl)}" target="_blank" class="btn btn-primary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
                ${Icons.externalLink(12)} Open
              </a>
              <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.sharePrototypeOnWhatsApp('${leadId}', '${this.escapeHtml(protoUrl)}')">
                ${Icons.whatsapp(12)} WhatsApp
              </button>
              <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.insertAgentPrompt('Update and polish the interactive prototype for ${this.escapeHtml(currentLead.business_name || currentLead.name)} with new responsive modules and dynamic preview.')">
                ${Icons.refresh(12)} Rebuild
              </button>
              <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.openPrototypeUrlModal('${leadId}')">
                ${Icons.settings(12)} Settings
              </button>
            </div>
          ` : `
            <div style="padding: 12px; background: hsl(var(--card)); border-radius: 6px; border: 1px dashed hsl(var(--border)); text-align: center;">
              <div style="font-size: 12px; font-weight: 600; color: hsl(var(--foreground)); margin-bottom: 2px;">No Prototype Built Yet</div>
              <p style="font-size: 11px; color: hsl(var(--muted-foreground)); margin: 0 0 8px 0;">
                Let Antigravity generate a custom interactive client demo or link an existing URL.
              </p>
              <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                <button type="button" class="btn btn-primary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.insertAgentPrompt('Build a high-fidelity interactive web prototype for ${this.escapeHtml(currentLead.business_name || currentLead.name)} featuring an ROI calculator, modern UI, and automated client onboarding flow.')">
                  ${Icons.zap(12)} Build with Agent
                </button>
                <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.openPrototypeUrlModal('${leadId}')">
                  ${Icons.link(12)} Attach Link
                </button>
              </div>
            </div>
          `}
        </div>

        <!-- Card 3: Context Data Pills (Lead Vault) -->
        <div class="baby-grok-inspector-card">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; color: hsl(var(--foreground));">
              <span style="display: inline-flex; align-items: center; color: #a855f7;">${Icons.tag(14)}</span>
              <span>Context Data Pills</span>
            </div>
            <span class="baby-grok-card-badge" style="font-size: 10px; background: hsl(var(--muted));">Click to inject</span>
          </div>
          
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <div class="baby-grok-pill-badge" onclick="App.insertAgentPill('@lead.profile')" title="Inject lead profile, contact info, deal stage, and notes">
              <span class="baby-grok-pill-tag">@lead.profile</span>
              <span class="baby-grok-pill-desc">${this.escapeHtml(currentLead.business_name || currentLead.name || 'Lead')} Profile</span>
            </div>
            <div class="baby-grok-pill-badge" onclick="App.insertAgentPill('@transcripts.all')" title="Inject all Deepgram audio call transcripts">
              <span class="baby-grok-pill-tag">@transcripts.all</span>
              <span class="baby-grok-pill-desc">Call Recordings &amp; Transcripts</span>
            </div>
            <div class="baby-grok-pill-badge" onclick="App.insertAgentPill('@whatsapp.history')" title="Inject synchronized WhatsApp chat messages">
              <span class="baby-grok-pill-tag">@whatsapp.history</span>
              <span class="baby-grok-pill-desc">WhatsApp Chat Log</span>
            </div>
            <div class="baby-grok-pill-badge" onclick="App.insertAgentPill('@files.all')" title="Inject attached Google Drive files and briefs">
              <span class="baby-grok-pill-tag">@files.all</span>
              <span class="baby-grok-pill-desc">Google Drive Documents</span>
            </div>
          </div>
        </div>

        <!-- Card 4: Walkthrough Video -->
        <div class="baby-grok-inspector-card">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; color: hsl(var(--foreground));">
              <span style="display: inline-flex; align-items: center; color: #c084fc;">${Icons.video(14)}</span>
              <span>Walkthrough Video</span>
            </div>
            <span class="baby-grok-card-badge ${isVideoBuilt ? 'baby-grok-badge-done' : 'baby-grok-badge-working'}">
              ${isVideoBuilt ? 'Ready' : 'Pending'}
            </span>
          </div>

          ${isVideoBuilt ? `
            <div class="baby-grok-url-pill">
              <span style="font-size: 11.5px; font-family: var(--font-mono); color: #c084fc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(demoVideoTitle)}</span>
              <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                <button type="button" class="btn-icon" style="padding: 2px 4px; font-size: 11px;" onclick="navigator.clipboard.writeText('${this.escapeHtml(demoVideoUrl)}'); API.showToast('Copied video link!', 'success');" title="Copy Link">${Icons.copy(12)}</button>
                <a href="${this.escapeHtml(demoVideoUrl)}" target="_blank" class="btn-icon" style="padding: 2px 4px; font-size: 11px; text-decoration: none;" title="Watch Video">${Icons.externalLink(12)}</a>
              </div>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
              <a href="${this.escapeHtml(demoVideoUrl)}" target="_blank" class="btn btn-primary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
                ${Icons.play(12)} Watch Video
              </a>
              <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.openDemoVideoModal('${leadId}')">
                ${Icons.edit(12)} Edit
              </button>
              <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.insertAgentPrompt('Generate a comprehensive video pitch follow-up message with the demo video link ${this.escapeHtml(demoVideoUrl)} for ${this.escapeHtml(currentLead.business_name || currentLead.name)}.')">
                ${Icons.messageSquare(12)} Draft Pitch
              </button>
            </div>
          ` : `
            <div style="padding: 12px; background: hsl(var(--card)); border-radius: 6px; border: 1px dashed hsl(var(--border)); text-align: center;">
              <div style="font-size: 12px; font-weight: 600; color: hsl(var(--foreground)); margin-bottom: 2px;">No Video Attached</div>
              <p style="font-size: 11px; color: hsl(var(--muted-foreground)); margin: 0 0 8px 0;">
                Attach a Loom, Google Drive, or YouTube walkthrough video, or let the agent write a script.
              </p>
              <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.openDemoVideoModal('${leadId}')">
                  ${Icons.link(12)} Attach Video Link
                </button>
                <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.insertAgentPrompt('Write a punchy 2-minute Loom demo script walking through the custom AI solution prototype for ${this.escapeHtml(currentLead.business_name || currentLead.name)}. Highlight their pain points, the live demo, and clear call-to-action.')">
                  ${Icons.fileCode(12)} Script Walkthrough
                </button>
              </div>
            </div>
          `}
        </div>

        <!-- Card 5: Host Workspace & Code Repository -->
        <div class="baby-grok-inspector-card">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; color: hsl(var(--foreground));">
              <span style="display: inline-flex; align-items: center; color: #64748b;">${Icons.folder(14)}</span>
              <span>Local Workspace</span>
            </div>
            <span class="baby-grok-card-badge baby-grok-badge-done">Ready</span>
          </div>

          <div class="baby-grok-url-pill">
            <span style="font-size: 10.5px; font-family: var(--font-mono); color: hsl(var(--foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${this.escapeHtml(projectPath)}">${this.escapeHtml(projectPath)}</span>
            <button type="button" class="btn-icon" style="padding: 2px 4px; font-size: 11px; flex-shrink: 0;" onclick="navigator.clipboard.writeText('${this.escapeHtml(projectPath).replace(/\\/g, '\\\\')}'); API.showToast('Copied workspace path!', 'success');" title="Copy Path">${Icons.copy(12)}</button>
          </div>

          <div style="display: flex; gap: 6px; margin-top: 2px;">
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.openAntigravityProjectsModal('${leadId}')">
              ${Icons.folderOpen(12)} Change Project
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="App.insertAgentPrompt('Scan the local project workspace for ${this.escapeHtml(currentLead.business_name || currentLead.name)} and summarize existing files and status.')">
              ${Icons.search(12)} Scan Codebase
            </button>
          </div>
        </div>

        <!-- Card 6: Google Drive Multi-Asset Hierarchy & GitHub Vault -->
        <div class="baby-grok-inspector-card">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; color: hsl(var(--foreground));">
              <span style="display: inline-flex; align-items: center; color: #4285F4;">${Icons.database(14)}</span>
              <span>Drive &amp; GitHub Vault</span>
            </div>
            <span class="baby-grok-card-badge ${currentLead.github_repo_url ? 'baby-grok-badge-done' : 'baby-grok-badge-working'}">
              ${currentLead.github_repo_url ? 'Synced' : 'Ready'}
            </span>
          </div>

          <div style="font-size: 11px; color: hsl(var(--muted-foreground)); margin: 4px 0 8px 0; line-height: 1.4;">
            Heavy audio/video &amp; WhatsApp assets stay in Google Drive; code, markdown briefs &amp; transcripts sync to GitHub.
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px;">
            <a href="/api/leads/${leadId}/drive/open" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px; height: 28px; display: inline-flex; align-items: center; justify-content: space-between; text-decoration: none;">
              <span style="display: inline-flex; align-items: center; gap: 6px;">
                <span style="color: #4285F4;">${Icons.folder(13)}</span> Google Drive Hierarchy
              </span>
              <span>${Icons.externalLink(11)}</span>
            </a>

            ${currentLead.github_repo_url ? `
              <a href="${this.escapeHtml(currentLead.github_repo_url)}" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px; height: 28px; display: inline-flex; align-items: center; justify-content: space-between; text-decoration: none;">
                <span style="display: inline-flex; align-items: center; gap: 6px;">
                  <span style="color: #f19d38;">${Icons.github(13)}</span> GitHub Vault Repo
                </span>
                <span>${Icons.externalLink(11)}</span>
              </a>
              <div style="display: flex; gap: 6px; margin-top: 2px;">
                <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; height: 26px; display: inline-flex; align-items: center; gap: 4px; flex: 1; justify-content: center;" onclick="App.syncLeadVaultFiles('${leadId}')">
                  ${Icons.refresh(12)} Rescan Manifest
                </button>
              </div>
            ` : `
              <button type="button" class="btn btn-primary btn-sm" style="font-size: 11px; padding: 4px 8px; height: 28px; display: inline-flex; align-items: center; justify-content: center; gap: 5px;" onclick="App.provisionLeadVault('${leadId}')">
                ${Icons.sparkles(12)} Initialize Git Vault &amp; Drive Hierarchy
              </button>
            `}
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  },

  async refreshDeliverablesPipeline(leadId) {
    try {
      API.showToast('Refreshing deliverables pipeline...', 'info');
      const updatedLead = await API.get(`/api/leads/${leadId}`);
      if (updatedLead) {
        this.state.selectedLead = updatedLead;
        const idx = this.state.leads.findIndex(l => l.id === leadId);
        if (idx !== -1) this.state.leads[idx] = updatedLead;
      }
      await this.loadPrototypes(leadId);
      await this.loadCompanyBrief(leadId);
      this.renderDeliverablesPipeline(this.state.selectedLead || { id: leadId });
      API.showToast('Deliverables pipeline up to date!', 'success');
    } catch (e) {
      console.warn('Failed to refresh deliverables pipeline:', e);
      API.showToast('Could not refresh pipeline: ' + (e.message || 'Error'), 'error');
    }
  },

  async provisionLeadVault(leadId) {
    try {
      API.showToast('Provisioning universal GitHub Vault & Google Drive hierarchy...', 'info');
      const res = await API.post(`/api/leads/${leadId}/github/provision`);
      if (res && res.success) {
        API.showToast('Client Vault and Google Drive provisioned successfully!', 'success');
        await this.refreshDeliverablesPipeline(leadId);
      } else {
        API.showToast(res.error || 'Failed to provision vault', 'error');
      }
    } catch (e) {
      console.error(e);
      API.showToast('Provisioning error: ' + (e.message || e), 'error');
    }
  },

  async syncLeadVaultFiles(leadId) {
    try {
      API.showToast('Rescanning workspace files & manifest...', 'info');
      const res = await API.post(`/api/leads/${leadId}/vault-files/sync`, {});
      if (res && res.status === 'success') {
        API.showToast(`Catalog refreshed with ${res.files_count || 0} files!`, 'success');
      }
    } catch (e) {
      API.showToast('Sync error: ' + (e.message || e), 'error');
    }
  },

  openSubdomainModal(leadId) {
    const lead = this.state.selectedLead || this.state.leads.find(l => l.id === leadId) || {};
    const cleanBizSlug = (lead.business_name || lead.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const currentSubdomain = lead.subdomain || `proto-${cleanBizSlug}.zero7.space`;
    const currentStatus = lead.subdomain_status || 'pending';
    const isAllocated = Boolean(lead.subdomain);
    const dnsRecordId = lead.dns_record_id || '';

    const modalHtml = `
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="display: inline-flex; align-items: center; color: #38bdf8;">${Icons.globe(20)}</span>
          <div>
            <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--color-ink);">Configure Client Subdomain</h3>
            <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--color-mid-gray);">Automated DNS provisioning &amp; live prototype routing</p>
          </div>
        </div>
        <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
      </div>
      <div class="modal-body" style="display: flex; flex-direction: column; gap: 16px;">
        <div class="form-group">
          <label style="font-size: 12.5px; font-weight: 600; color: var(--color-ink); display: block; margin-bottom: 6px;">Client Subdomain (zero7.space):</label>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 12.5px; color: var(--color-mid-gray); font-family: ui-monospace, monospace; font-weight: 500;">https://</span>
            <input type="text" id="modal-subdomain-input" class="input" value="${this.escapeHtml(currentSubdomain)}" placeholder="e.g. proto-burosys.zero7.space" style="flex: 1; font-family: ui-monospace, monospace; font-size: 13px;">
          </div>
          <div style="margin-top: 6px; font-size: 11.5px; color: var(--color-mid-gray); line-height: 1.4;">
            💡 <strong>Smart DNS Scope</strong>: Changing this subdomain automatically deletes the previous DNS record and provisions the new one on <code>zero7.space</code>. Core records (<code>cos</code>, <code>@</code>, <code>mail</code>) are safeguarded.
          </div>
        </div>

        <div style="padding: 10px 12px; border-radius: 8px; background: hsl(var(--muted)/0.4); border: 1px solid hsl(var(--border)); font-size: 12px; display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--color-mid-gray); font-weight: 500;">DNS Lifecycle Status:</span>
            <span class="badge ${currentStatus === 'active' ? 'badge-success' : 'badge-warning'}" style="font-size: 11px;">
              ${currentStatus === 'active' ? '● Active &amp; Routed' : '○ Pending Resolution'}
            </span>
          </div>
          ${dnsRecordId ? `<div style="font-size: 11px; color: var(--color-mid-gray); font-family: ui-monospace, monospace;">Provider Record ID: ${this.escapeHtml(dnsRecordId)}</div>` : ''}
          <div style="font-size: 11px; color: var(--color-mid-gray);">Target Droplet IP: <code>68.183.92.215</code></div>
        </div>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
        ${isAllocated ? `
          <button type="button" class="btn btn-outline-danger btn-sm" onclick="App.deleteSubdomain('${leadId}')" style="color: var(--color-danger); border-color: rgba(239,68,68,0.3); font-size: 12px;">
            ${Icons.trash ? Icons.trash(12) : ''} Delete Subdomain
          </button>
        ` : '<div></div>'}
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="button" class="btn btn-primary" id="btn-save-subdomain" onclick="App.saveSubdomain('${leadId}')">Save &amp; Provision DNS</button>
        </div>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async saveSubdomain(leadId) {
    const input = document.getElementById('modal-subdomain-input');
    const saveBtn = document.getElementById('btn-save-subdomain');
    if (!input) return;

    let val = input.value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!val) {
      API.showToast('Please enter a valid subdomain name', 'warning');
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerText = 'Provisioning DNS...';
    }

    try {
      API.showToast('Provisioning client subdomain DNS on zero7.space...', 'info');
      const res = await API.post(`/api/leads/${leadId}/provision-subdomain`, {
        subdomain: val
      });

      // Handle collision warning
      if (res && res.collision) {
        const alt = res.suggested_subdomain;
        API.showToast(res.error, 'warning');
        if (input && alt) {
          input.value = alt;
          API.showToast(`Auto-suggested available slug: ${alt}. Click Save to apply.`, 'info');
        }
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerText = 'Save & Provision DNS';
        }
        return;
      }

      const updatedSub = res.subdomain || val;
      const updatedStatus = res.status || 'active';
      const dnsRecId = res.dns_record_id;

      if (this.state.selectedLead && this.state.selectedLead.id === leadId) {
        this.state.selectedLead.subdomain = updatedSub;
        this.state.selectedLead.subdomain_status = updatedStatus;
        if (dnsRecId) this.state.selectedLead.dns_record_id = dnsRecId;
      }
      const leadInState = this.state.leads.find(l => l.id === leadId);
      if (leadInState) {
        leadInState.subdomain = updatedSub;
        leadInState.subdomain_status = updatedStatus;
        if (dnsRecId) leadInState.dns_record_id = dnsRecId;
      }

      this.closeModal();
      this.renderDeliverablesPipeline(this.state.selectedLead);
      API.showToast(`Subdomain https://${updatedSub} provisioned successfully!`, 'success');
    } catch (e) {
      console.error('Failed to provision subdomain:', e);
      API.showToast('Subdomain error: ' + (e.message || 'Error'), 'error');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerText = 'Save & Provision DNS';
      }
    }
  },

  async deleteSubdomain(leadId) {
    if (!confirm('Are you sure you want to remove this client subdomain? The DNS record on zero7.space will be deleted.')) {
      return;
    }

    try {
      API.showToast('De-provisioning DNS record on zero7.space...', 'info');
      await API.delete(`/api/leads/${leadId}/provision-subdomain`);

      if (this.state.selectedLead && this.state.selectedLead.id === leadId) {
        this.state.selectedLead.subdomain = null;
        this.state.selectedLead.subdomain_status = 'pending';
        this.state.selectedLead.dns_record_id = null;
      }
      const leadInState = this.state.leads.find(l => l.id === leadId);
      if (leadInState) {
        leadInState.subdomain = null;
        leadInState.subdomain_status = 'pending';
        leadInState.dns_record_id = null;
      }

      this.closeModal();
      this.renderDeliverablesPipeline(this.state.selectedLead);
      API.showToast('Subdomain deleted and DNS record cleaned up!', 'success');
    } catch (e) {
      console.error('Failed to delete subdomain:', e);
      API.showToast('Failed to delete subdomain: ' + (e.message || 'Error'), 'error');
    }
  },

  openDemoVideoModal(leadId) {
    const lead = this.state.selectedLead || this.state.leads.find(l => l.id === leadId) || {};
    const currentUrl = lead.demo_video_url || '';
    const currentTitle = lead.demo_video_title || 'Client Prototype Walkthrough';
    const currentStatus = lead.demo_video_status || (currentUrl ? 'built' : 'pending');

    const modalHtml = `
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-hairline); padding: 14px 18px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-flex; align-items: center; color: #c084fc;">${Icons.video(20)}</span>
          <div>
            <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--color-ink);">Demo Video Walkthrough</h3>
            <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--color-mid-gray);">Attach Loom, Drive, or YouTube link of the prototype walkthrough</p>
          </div>
        </div>
        <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
      </div>
      <div class="modal-body" style="padding: 18px; display: flex; flex-direction: column; gap: 14px;">
        <div>
          <label style="font-size: 12.5px; font-weight: 500; color: var(--color-ink); display: block; margin-bottom: 6px;">Video URL (Loom / Drive / YouTube / MP4):</label>
          <input type="url" id="modal-video-url-input" class="input" value="${this.escapeHtml(currentUrl)}" placeholder="https://www.loom.com/share/... or Google Drive link" style="font-size: 13px;">
        </div>
        <div>
          <label style="font-size: 12.5px; font-weight: 500; color: var(--color-ink); display: block; margin-bottom: 6px;">Video Title / Description:</label>
          <input type="text" id="modal-video-title-input" class="input" value="${this.escapeHtml(currentTitle)}" placeholder="e.g. 2-Min Interactive Demo Walkthrough" style="font-size: 13px;">
        </div>
        <div>
          <label style="font-size: 12.5px; font-weight: 500; color: var(--color-ink); display: block; margin-bottom: 6px;">Status:</label>
          <select id="modal-video-status-select" class="select" style="font-size: 13px;">
            <option value="built" ${currentStatus === 'built' ? 'selected' : ''}>Video Ready</option>
            <option value="pending" ${currentStatus === 'pending' ? 'selected' : ''}>Pending Recording</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="App.saveDemoVideo('${leadId}')">Save Video</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async saveDemoVideo(leadId) {
    const urlInput = document.getElementById('modal-video-url-input');
    const titleInput = document.getElementById('modal-video-title-input');
    const statusSelect = document.getElementById('modal-video-status-select');
    if (!urlInput) return;

    const url = urlInput.value.trim();
    const title = (titleInput && titleInput.value.trim()) || 'Client Prototype Walkthrough';
    const status = statusSelect ? statusSelect.value : (url ? 'built' : 'pending');

    try {
      API.showToast('Saving demo video details...', 'info');
      await API.put(`/api/leads/${leadId}`, {
        demo_video_url: url,
        demo_video_title: title,
        demo_video_status: status
      });

      if (this.state.selectedLead && this.state.selectedLead.id === leadId) {
        this.state.selectedLead.demo_video_url = url;
        this.state.selectedLead.demo_video_title = title;
        this.state.selectedLead.demo_video_status = status;
      }
      const leadInState = this.state.leads.find(l => l.id === leadId);
      if (leadInState) {
        leadInState.demo_video_url = url;
        leadInState.demo_video_title = title;
        leadInState.demo_video_status = status;
      }

      this.closeModal();
      this.renderDeliverablesPipeline(this.state.selectedLead);
      API.showToast('Demo video details updated!', 'success');
    } catch (e) {
      console.error('Failed to save demo video:', e);
      API.showToast('Failed to save demo video: ' + (e.message || 'Error'), 'error');
    }
  },

  openPrototypeUrlModal(leadId) {
    const lead = this.state.selectedLead || this.state.leads.find(l => l.id === leadId) || {};
    const protos = (this.state.leadPrototypes && this.state.leadPrototypes[leadId]) || [];
    const activeProto = protos.length > 0 ? protos[0] : null;
    const currentUrl = lead.prototype_url || (activeProto?.share_token ? `${window.location.origin}/api/public/prototype/${activeProto.share_token}` : '');
    const currentStatus = lead.prototype_status || (currentUrl ? 'built' : 'pending');

    const modalHtml = `
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-hairline); padding: 14px 18px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-flex; align-items: center; color: #34d399;">${Icons.monitor(20)}</span>
          <div>
            <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--color-ink);">Link Prototype URL</h3>
            <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--color-mid-gray);">Set live link and deployment status for the client prototype</p>
          </div>
        </div>
        <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
      </div>
      <div class="modal-body" style="padding: 18px; display: flex; flex-direction: column; gap: 14px;">
        <div>
          <label style="font-size: 12.5px; font-weight: 500; color: var(--color-ink); display: block; margin-bottom: 6px;">Live Prototype URL:</label>
          <input type="url" id="modal-proto-url-input" class="input" value="${this.escapeHtml(currentUrl)}" placeholder="https://..." style="font-size: 13px;">
        </div>
        <div>
          <label style="font-size: 12.5px; font-weight: 500; color: var(--color-ink); display: block; margin-bottom: 6px;">Status:</label>
          <select id="modal-proto-status-select" class="select" style="font-size: 13px;">
            <option value="built" ${currentStatus === 'built' ? 'selected' : ''}>Built & Deployed</option>
            <option value="pending" ${currentStatus === 'pending' ? 'selected' : ''}>In Development / Pending</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="App.savePrototypeUrl('${leadId}')">Save Prototype</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async savePrototypeUrl(leadId) {
    const urlInput = document.getElementById('modal-proto-url-input');
    const statusSelect = document.getElementById('modal-proto-status-select');
    if (!urlInput) return;

    const url = urlInput.value.trim();
    const status = statusSelect ? statusSelect.value : (url ? 'built' : 'pending');

    try {
      API.showToast('Saving prototype details...', 'info');
      await API.put(`/api/leads/${leadId}`, {
        prototype_url: url,
        prototype_status: status
      });

      if (this.state.selectedLead && this.state.selectedLead.id === leadId) {
        this.state.selectedLead.prototype_url = url;
        this.state.selectedLead.prototype_status = status;
      }
      const leadInState = this.state.leads.find(l => l.id === leadId);
      if (leadInState) {
        leadInState.prototype_url = url;
        leadInState.prototype_status = status;
      }

      this.closeModal();
      this.renderDeliverablesPipeline(this.state.selectedLead);
      API.showToast('Prototype details updated!', 'success');
    } catch (e) {
      console.error('Failed to save prototype:', e);
      API.showToast('Failed to save prototype: ' + (e.message || 'Error'), 'error');
    }
  },

  sharePrototypeOnWhatsApp(leadId, url) {
    const lead = this.state.selectedLead || this.state.leads.find(l => l.id === leadId) || {};
    const cleanPhone = (lead.phone || '').replace(/[^0-9+]/g, '');
    const waPhone = cleanPhone.startsWith('+') ? cleanPhone.replace('+', '') : (cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone);
    const clientName = lead.name || 'there';
    const bizName = lead.business_name || 'your company';
    
    const msg = `Hi ${clientName}! We have created an interactive concept prototype for ${bizName}:\n\n${url}\n\nPlease test the interactive workflow and let us know what you think!`;

    if (!waPhone) {
      prompt('No phone number on lead. Here is the WhatsApp message to copy:', msg);
      return;
    }

    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  },


  switchCallLoggerMode(leadId, mode) {
    this._leadMeetingMode = mode;
    const audioForm = document.getElementById(`call-log-form-${leadId}`);
    const videoForm = document.getElementById(`video-meet-form-${leadId}`);
    const audioBtn = document.getElementById(`tab-btn-audio-${leadId}`);
    const videoBtn = document.getElementById(`tab-btn-video-${leadId}`);
    
    if (audioForm && videoForm) {
      if (mode === 'video') {
        audioForm.style.display = 'none';
        videoForm.style.display = 'block';
        if (audioBtn) { audioBtn.className = 'btn btn-sm btn-ghost'; }
        if (videoBtn) { videoBtn.className = 'btn btn-sm btn-primary'; }
      } else {
        audioForm.style.display = 'block';
        videoForm.style.display = 'none';
        if (audioBtn) { audioBtn.className = 'btn btn-sm btn-primary'; }
        if (videoBtn) { videoBtn.className = 'btn btn-sm btn-ghost'; }
      }
    }
  },

  async handleAttachDriveMeeting(e, leadId) {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn && submitBtn.disabled) return;

    const driveUrl = form.querySelector('[name="drive_url"]').value.trim();
    const title = form.querySelector('[name="title"]').value.trim() || 'Video Meeting';
    const outcome = form.querySelector('[name="outcome"]').value || 'Meeting Completed';
    const notes = form.querySelector('[name="notes"]').value.trim();
    const duration = parseInt(form.querySelector('[name="duration_minutes"]').value) || 30;

    if (!driveUrl) {
      API.showToast('Please enter a Google Drive link or File ID', 'error');
      return;
    }

    const origHtml = submitBtn.innerHTML;
    try {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span style="display:inline-block;animation:spin 1s linear infinite;">${Icons.loader(14)}</span> Linking Meet...`;
      
      await API.post(`/api/leads/${leadId}/meetings/attach-drive`, {
        drive_file_id_or_url: driveUrl,
        title: title,
        outcome: outcome,
        notes: notes,
        duration_minutes: duration,
        transcribe: true
      });

      // A meeting held means the lead was reached: move a New/Attempting lead to Connected.
      const metLead = this.findLead(leadId);
      if (metLead && ['new', 'attempting'].includes(this.getLeadFlowStep(metLead, this.hasDeal(metLead)))) {
        await API.put(`/api/leads/${leadId}`, { call_stage: 'connected', ...this.getFlowUpdate(metLead, this.CALL_OUTCOMES.Connected) });
      }

      API.showToast('Video Meeting attached! Drive streaming & Deepgram speech sync in progress.', 'success');
      await this.loadInitialData();
      await this.viewLead(leadId);
    } catch (err) {
      console.error(err);
      API.showToast(err.message || 'Failed to attach Drive meeting', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origHtml;
      }
    }
  },

  renderActivityItem(act) {
    const isCall = act.type === 'call';
    const isVideoMeeting = isCall && (act.is_video === 1 || act.is_video === true || (act.recording_mime_type || '').startsWith('video/'));
    const icon = isVideoMeeting ? Icons.video(13) : (isCall ? Icons.phone(13) : Icons.notepad(13));
    const author = act.user_name || 'Consultant';

    let recordingHtml = '';
    if (isCall && (act.recording_file_name || act.recording_drive_file_id || act.recording_drive_url)) {
      const isVideo = isVideoMeeting;
      const sizeMB = act.recording_size_bytes ? (act.recording_size_bytes / (1024 * 1024)).toFixed(1) : '';
      const durationStr = act.recording_duration_secs ? `${Math.floor(act.recording_duration_secs / 60)}:${String(act.recording_duration_secs % 60).padStart(2, '0')}` : (act.duration_minutes ? `${act.duration_minutes}m` : '');
      const ext = act.recording_file_name ? act.recording_file_name.split('.').pop().toUpperCase() : (isVideo ? 'MP4' : 'AUDIO');
      const hasDrive = !!act.recording_drive_file_id;
      
      const audioSrc = hasDrive 
        ? `/api/recordings/drive/${encodeURIComponent(act.recording_drive_file_id)}`
        : `/api/recordings/${encodeURIComponent(act.recording_file_name || '')}`;
      
      if (isVideo) {
        const streamSrc = act.recording_file_name ? `/api/recordings/${encodeURIComponent(act.recording_file_name)}` : '';
        recordingHtml = `
          <div style="margin-top: 8px; background: hsl(var(--muted) / 0.35); border-radius: var(--radius-sm); padding: 10px; border: 1px solid hsl(var(--border));">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-size: 11.5px; font-weight: 600; color: #10b981; display: inline-flex; align-items: center; gap: 5px;">
                ${Icons.video(12)} Video Meeting Recording
              </span>
              ${hasDrive ? `
                <a href="https://drive.google.com/file/d/${act.recording_drive_file_id}/view" target="_blank" rel="noopener noreferrer" style="color: hsl(var(--foreground)); text-decoration: underline; font-size: 11px; display: inline-flex; align-items: center; gap: 3px;">
                  ${Icons.folder(11)} Watch in Drive ↗
                </a>
              ` : ''}
            </div>
            ${streamSrc ? `
              <div style="position: relative; width: 100%; border-radius: 6px; overflow: hidden; background: #000;">
                <video controls preload="metadata" style="width: 100%; max-height: 280px; display: block; border-radius: 6px;">
                  <source src="${streamSrc}" type="${act.recording_mime_type || 'video/mp4'}">
                  Your browser does not support the video tag.
                </video>
              </div>
            ` : (hasDrive ? `
              <div style="position: relative; width: 100%; height: 260px; border-radius: 6px; overflow: hidden; background: #000;">
                <iframe src="https://drive.google.com/file/d/${act.recording_drive_file_id}/preview" width="100%" height="100%" style="border: none;" allow="autoplay" allowfullscreen></iframe>
              </div>
            ` : '')}
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; color: hsl(var(--muted-foreground)); margin-top: 6px;">
              <span>🎥 ${ext} ${sizeMB ? '· ' + sizeMB + ' MB' : ''} ${durationStr ? '· ' + durationStr : ''}</span>
              ${hasDrive ? `<span style="font-family: monospace; font-size: 10px;">Drive ID: ${act.recording_drive_file_id.slice(0, 12)}…</span>` : ''}
            </div>
          </div>`;
      } else {
        recordingHtml = `
          <div style="margin-top: 8px; background: var(--color-surface-alt); border-radius: var(--radius-sm); padding: 8px; border: 1px solid var(--color-hairline);">
            <audio controls preload="none" style="width: 100%; height: 36px;">
              <source src="${audioSrc}" type="${act.recording_mime_type || 'audio/mpeg'}">
            </audio>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--color-mid-gray); margin-top: 4px;">
              <span>🎙️ ${ext} ${sizeMB ? '· ' + sizeMB + ' MB' : ''} ${durationStr ? '· ' + durationStr : ''}</span>
              ${hasDrive ? `<a href="https://drive.google.com/file/d/${act.recording_drive_file_id}/view" target="_blank" style="color: var(--color-ink); text-decoration: underline; font-size: 10px;">Open in Drive ↗</a>` : ''}
            </div>
          </div>`;
      }
    }

    return `
      <div class="activity-item">
        <div class="activity-dot" style="${isVideoMeeting ? 'background: #10b981;' : (isCall ? 'background: var(--color-ink);' : 'background: var(--color-mid-gray);')}"></div>
        <div class="activity-header">
          <span class="activity-type" style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px;">
            ${icon} ${isVideoMeeting ? `<span style="background: rgba(16, 185, 129, 0.12); color: #10b981; padding: 1px 7px; border-radius: 8px; font-size: 11px; font-weight: 600;">Video Meeting</span> ${this.escapeHtml(act.outcome || 'Logged')}` : (isCall ? `Call: ${this.escapeHtml(act.outcome || 'Logged')}` : 'Internal Note')}
          </span>
          <span class="activity-date" style="font-size: 11.5px;">${this.formatDate(act.date)}</span>
        </div>
        <div style="font-size: 11px; color: var(--color-mid-gray); margin-bottom: 4px;">By ${this.escapeHtml(author)}${act.duration_minutes ? ` &bull; ${act.duration_minutes} mins` : ''}${isVideoMeeting ? ` · <span style="display:inline-flex; align-items:center; gap:3px;">${Icons.video(11)} Video Recording</span>` : (act.recording_file_name ? ` · <span style="display:inline-flex; align-items:center; gap:3px;">${Icons.paperclip(11)} Audio Recording</span>` : '')}</div>
        ${act.notes ? this.renderActivityNotes(act.notes) : ''}
        ${recordingHtml}
        ${isCall && act.transcription_text ? `
          <div style="margin-top: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" style="border-radius: var(--radius-pill); font-size: 11px; padding: 4px 12px; gap: 5px;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'; this.querySelector('span').textContent = this.nextElementSibling.style.display === 'none' ? 'View Transcript' : 'Hide Transcript'">
              ${Icons.fileText(12)} <span>View Transcript</span>
            </button>
            <div style="display: none; margin-top: 8px; background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: var(--radius-md); padding: 12px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; max-height: 220px; overflow-y: auto;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--color-hairline);">
                <span style="font-size: 10.5px; color: var(--color-mid-gray); font-weight: 500;">
                  ${Icons.target(12)} ${act.transcription_confidence ? (act.transcription_confidence * 100).toFixed(0) + '% confidence' : ''}
                  ${act.transcription_language ? ' · ' + (act.transcription_language === 'hi' ? 'Hindi' : act.transcription_language === 'en' ? 'English' : act.transcription_language) : ''}
                </span>
              </div>
              ${this.escapeHtml(act.transcription_text)}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  },

  async handleSaveLeadEdits(e, leadId) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    if (data.deal_value) data.deal_value = parseFloat(data.deal_value);
    if (!data.assigned_to) data.assigned_to = null;

    try {
      await API.put(`/api/leads/${leadId}`, data);
      API.showToast('Lead details saved successfully', 'success');
      await this.loadInitialData();
      await this.viewLead(leadId);
    } catch (err) {
      console.error(err);
    }
  },

  async handleQuickLogCall(e, leadId) {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn && submitBtn.disabled) return; // Prevent duplicate clicks during upload

    const outcome = form.querySelector('#selected-outcome').value;
    const notes = form.querySelector('[name="notes"]').value;
    const flow = this.CALL_OUTCOMES[outcome];
    if (!flow) {
      API.showToast('Pick what happened on the call first', 'error');
      return;
    }
    if (flow.connected && !notes.trim()) {
      API.showToast('Add a short note on what was discussed', 'error');
      form.querySelector('[name="notes"]')?.focus?.();
      return;
    }
    const leadBefore = this.findLead(leadId);
    const attempt = this.getCallAttempts(leadBefore) + 1;
    const enteredDuration = parseInt(form.querySelector('[name="duration_minutes"]').value, 10);
    // A call that did not connect has no talk time.
    const duration = !flow.connected ? 0 : (Number.isFinite(enteredDuration) && enteredDuration >= 0 ? enteredDuration : 5);
    const fileInput = form.querySelector('[name="recording"]');
    const hasFile = fileInput && fileInput.files && fileInput.files.length > 0;

    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'Record Call';

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
      }

      if (hasFile) {
        const file = fileInput.files[0];
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        if (submitBtn) {
          submitBtn.innerHTML = `<span style="display:inline-block;animation:spin 1s linear infinite;">${Icons.loader(14)}</span> Uploading ${sizeMB} MB...`;
        }
        API.showToast(`Uploading call recording (${sizeMB} MB)... Please wait.`, 'info');

        const fd = new FormData();
        fd.append('outcome', outcome);
        fd.append('notes', notes);
        fd.append('duration_minutes', duration.toString());
        fd.append('recording', file);
        
        const token = localStorage.getItem('zero7_token') || this.state.token;
        const res = await fetch(`/api/leads/${leadId}/calls`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || errData.message || `Upload failed (${res.status})`);
        }
      } else {
        if (submitBtn) {
          submitBtn.innerHTML = `<span style="display:inline-block;animation:spin 1s linear infinite;">${Icons.loader(14)}</span> Saving...`;
        }
        await API.post(`/api/leads/${leadId}/calls`, {
          outcome,
          notes,
          duration_minutes: duration
        });
      }

      // Move the lead along the flow: call stage from the outcome; status only forward (or to lost), never off a won lead.
      const outcomeMap = Object.fromEntries(Object.entries(this.CALL_OUTCOMES).map(([key, o]) => [key, o.stage]));
      if (outcomeMap[outcome]) {
        await API.put(`/api/leads/${leadId}`, { call_stage: outcomeMap[outcome] });
      }
      const flowUpdate = this.getFlowUpdate(leadBefore, flow);
      if (Object.keys(flowUpdate).length) {
        await API.put(`/api/leads/${leadId}`, flowUpdate);
      }

      // Logging a call completes a scheduled call that was due today or earlier; Not interested cancels any call.
      const loggedLead = this.findLead(leadId);
      const dueCall = loggedLead && this.getScheduledCall(loggedLead);
      const completedDueCall = !!dueCall && (!flow.next || ['overdue', 'today'].includes(this.getCallBucket(dueCall)));
      if (completedDueCall) {
        await API.put(`/api/leads/${leadId}`, { next_action: '', next_action_date: '' });
      }

      API.showToast(`Call logged: ${flow.label}`, 'success');
      await this.loadInitialData();
      await this.viewLead(leadId);
      if (flow.next && (!dueCall || completedDueCall)) {
        const preset = flow.next === 'retry' ? this.getRetryPreset(attempt) : flow.next;
        // A missed call's retry is mechanical, so it is scheduled straight away (up to 6 tries);
        // anything agreed with the client is pre-filled for the user to confirm.
        const autoRetry = flow.next === 'retry' && attempt < 6;
        const message = flow.next === 'retry'
          ? (autoRetry ? `No answer (attempt ${attempt}). Retry scheduled, change it in Next call if needed.`
                       : `No answer ${attempt} times. Schedule a last try or mark Not interested.`)
          : 'Set the next call so this follow-up is not missed';
        this.promptNextCall(leadId, preset, flow.next === 'retry' ? `Retry after no answer (attempt ${attempt})` : (flow.purpose || ''), message, autoRetry);
      }
    } catch (err) {
      console.error(err);
      API.showToast(err.message || 'Error logging call', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  handleRecordingSelect(input) {
    const preview = document.getElementById('recording-preview');
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      if (file.size > 200 * 1024 * 1024) {
        API.showToast('File too large. Max 200MB.', 'error');
        input.value = '';
        return;
      }
      const icon = file.type.startsWith('video/') ? Icons.video(14) : Icons.mic(14);
      preview.innerHTML = `<span style="display:inline-flex; align-items:center; gap:4px;">${icon} <strong>${this.escapeHtml(file.name)}</strong></span> · ${sizeMB} MB <button type="button" onclick="App.clearRecording(event)" style="margin-left: 8px; background: none; border: none; color: var(--color-mid-gray); cursor: pointer; display: inline-flex; align-items: center;" title="Remove recording">${Icons.close(13)}</button>`;
      preview.style.color = 'var(--color-ink)';
    }
  },

  handleRecordingDrop(e) {
    e.preventDefault();
    e.currentTarget.style.borderColor = 'var(--color-hairline)';
    const fileInput = document.getElementById('recording-file-input');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      fileInput.files = e.dataTransfer.files;
      this.handleRecordingSelect(fileInput);
    }
  },

  clearRecording(e) {
    e.stopPropagation();
    const fileInput = document.getElementById('recording-file-input');
    if (fileInput) fileInput.value = '';
    const preview = document.getElementById('recording-preview');
    if (preview) {
      preview.innerHTML = `<span style="display:inline-flex; align-items:center; gap:4px;">${Icons.paperclip(13)} Attach call recording (MP3, M4A, WAV, MP4) · Max 200MB</span>`;
      preview.style.color = 'var(--color-mid-gray)';
    }
  },

  async handleQuickAddNote(e, leadId) {
    e.preventDefault();
    const content = new FormData(e.target).get('content');

    try {
      await API.post(`/api/leads/${leadId}/notes`, { content });
      API.showToast('Note added', 'success');
      await this.loadInitialData();
      await this.viewLead(leadId);
    } catch (err) {
      console.error(err);
    }
  },

  async convertToDeal(leadId) {
    if (!confirm('Promote this lead to an active deal in the pipeline?')) return;
    try {
      const deal = await API.post(`/api/leads/${leadId}/convert`, {});
      API.showToast('Lead promoted to Deal!', 'success');
      await this.loadInitialData();
      this.viewDeal(deal.id);
    } catch (e) {
      console.error(e);
    }
  },

  async revertDealToLead(dealId) {
    if (!confirm('Are you sure you want to revert this deal back to a lead? The deal will be removed from the pipeline and the lead will be restored.')) return;
    try {
      const res = await API.post(`/api/deals/${dealId}/revert`, {});
      API.showToast('Deal reverted back to lead!', 'success');
      await this.loadInitialData();
      if (res && res.lead_id) {
        await this.viewLead(res.lead_id);
      } else {
        this.renderDealsView();
      }
    } catch (e) {
      console.error(e);
      API.showToast('Failed to revert deal', 'error');
    }
  },

  // ---------------- 3. CLIENT ENGAGEMENT & DELIVERY HUB (DEALS) ----------------

  _dealsDeliveryStageFilter: 'all',
  _dealsViewMode: 'grid',

  setDealsDeliveryStage(stage) {
    this._dealsDeliveryStageFilter = stage;
    this.renderDealsView();
  },

  setDealsViewMode(mode) {
    this._dealsViewMode = mode;
    this.renderDealsView();
  },

  renderDealsView() {
    const container = document.getElementById('page-content');
    if (!container) return;

    const allDeals = this.state.deals || [];

    // Financial & Delivery Aggregations
    const totalBooked = allDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);
    const totalReceived = allDeals.reduce((sum, d) => sum + (parseFloat(d.amount_received) || 0), 0);
    const totalPending = Math.max(0, totalBooked - totalReceived);
    const collectionRate = totalBooked > 0 ? Math.round((totalReceived / totalBooked) * 100) : 0;
    const activeEngagements = allDeals.filter(d => (d.delivery_stage || d.stage || '') !== 'completed').length;

    // Delivery Stage Definitions
    const stages = [
      { key: 'all', label: 'All Deals', icon: Icons.folder(14) },
      { key: 'kickoff', label: 'Kickoff & Scope', icon: Icons.rocket(14) },
      { key: 'in_development', label: 'In Engineering', icon: Icons.zap(14) },
      { key: 'staging_uat', label: 'Staging & UAT', icon: Icons.flaskConical(14) },
      { key: 'completed', label: 'Delivered & Live', icon: Icons.checkCircle(14) },
      { key: 'maintenance', label: 'Retainer & AMC', icon: Icons.refresh(14) }
    ];

    // Filter deals
    const activeFilter = this._dealsDeliveryStageFilter || 'all';
    const filteredDeals = activeFilter === 'all' 
      ? allDeals 
      : allDeals.filter(d => (d.delivery_stage || d.stage || 'in_development') === activeFilter);

    container.innerHTML = `
      <!-- Top Title & Action Bar -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 16px; flex-wrap: wrap;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display:inline-flex; align-items:center; color: var(--color-ink);">${Icons.briefcase(22)}</span>
            <h1 style="font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: var(--color-ink); margin: 0;">
              Client Engagements & Delivery Hub
            </h1>
          </div>
          <p style="font-size: 13px; color: var(--color-mid-gray); margin-top: 4px; margin-bottom: 0;">
            Active closed contracts, milestone payments, deliverables & GitHub repositories
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button class="btn btn-secondary btn-sm" onclick="App.loadInitialData().then(() => App.renderDealsView())" title="Refresh Deals" style="display: inline-flex; align-items: center; gap: 5px;">
            ${Icons.refresh(13)} Refresh
          </button>
          <button class="btn btn-primary" onclick="App.openAddDealModal()" style="display: inline-flex; align-items: center; gap: 5px;">
            ${Icons.plus(14)} New Client Deal
          </button>
        </div>
      </div>

      <!-- Executive Commercial & Delivery KPI Strip -->
      <div class="deals-kpi-grid">
        <div class="deals-kpi-card">
          <div class="deals-kpi-header">
            <span class="deals-kpi-title">Total Booked Value</span>
            <span class="deals-kpi-icon">${Icons.indianRupee(18)}</span>
          </div>
          <div class="deals-kpi-value">${this.formatCurrency(totalBooked)}</div>
          <div class="deals-kpi-sub">
            <span>Across <strong>${allDeals.length}</strong> closed contracts</span>
          </div>
        </div>

        <div class="deals-kpi-card">
          <div class="deals-kpi-header">
            <span class="deals-kpi-title">Cash Collected</span>
            <span class="deals-kpi-icon">${Icons.creditCard(18)}</span>
          </div>
          <div class="deals-kpi-value" style="color: #16a34a;">${this.formatCurrency(totalReceived)}</div>
          <div class="deals-kpi-sub">
            <span style="font-weight: 600; color: #16a34a;">${collectionRate}%</span>
            <span>of booked contract value</span>
          </div>
        </div>

        <div class="deals-kpi-card">
          <div class="deals-kpi-header">
            <span class="deals-kpi-title">Pending Receivables</span>
            <span class="deals-kpi-icon">${Icons.clock(18)}</span>
          </div>
          <div class="deals-kpi-value" style="color: ${totalPending > 0 ? '#d97706' : 'var(--color-ink)'};">${this.formatCurrency(totalPending)}</div>
          <div class="deals-kpi-sub">
            <span>Milestone balances to be collected</span>
          </div>
        </div>

        <div class="deals-kpi-card">
          <div class="deals-kpi-header">
            <span class="deals-kpi-title">Active Engagements</span>
            <span class="deals-kpi-icon">${Icons.wrench(18)}</span>
          </div>
          <div class="deals-kpi-value" style="color: #2563eb;">${activeEngagements}</div>
          <div class="deals-kpi-sub">
            <span>Projects actively in engineering/UAT</span>
          </div>
        </div>
      </div>

      <!-- Stage Filters & View Switcher -->
      <div class="deals-filter-bar">
        <div class="deals-stage-pills">
          ${stages.map(st => {
            const count = st.key === 'all' 
              ? allDeals.length 
              : allDeals.filter(d => (d.delivery_stage || d.stage || 'in_development') === st.key).length;
            const isActive = activeFilter === st.key;
            return `
              <button type="button" class="stage-filter-btn ${isActive ? 'active' : ''}" 
                      onclick="App.setDealsDeliveryStage('${st.key}')">
                <span>${st.icon}</span>
                <span>${st.label}</span>
                <span class="badge-count">${count}</span>
              </button>
            `;
          }).join('')}
        </div>

        <div class="deals-view-switch">
          <button type="button" class="deals-view-btn ${this._dealsViewMode === 'grid' ? 'active' : ''}" 
                  onclick="App.setDealsViewMode('grid')" style="display: inline-flex; align-items: center; gap: 5px;">
            ${Icons.layoutDashboard(13)} Cards
          </button>
          <button type="button" class="deals-view-btn ${this._dealsViewMode === 'table' ? 'active' : ''}" 
                  onclick="App.setDealsViewMode('table')" style="display: inline-flex; align-items: center; gap: 5px;">
            ${Icons.table(13)} Table
          </button>
        </div>
      </div>

      <!-- Deals Content -->
      ${filteredDeals.length === 0 ? `
        <div style="background: var(--color-paper); border: 1px dashed var(--color-hairline); border-radius: var(--radius-card); padding: 48px 24px; text-align: center; margin-top: 10px;">
          <div style="font-size: 36px; margin-bottom: 10px; display:inline-flex; align-items:center; justify-content:center; color: var(--color-mid-gray);">${Icons.package(36)}</div>
          <h3 style="font-size: 16px; font-weight: 600; color: var(--color-ink); margin: 0 0 6px 0;">No deals in this stage</h3>
          <p style="font-size: 13px; color: var(--color-mid-gray); max-width: 420px; margin: 0 auto 18px auto; line-height: 1.5;">
            Deals represent your won client engagements. Promote a converted lead from the Leads page or click below to record a new client contract.
          </p>
          <button class="btn btn-primary" onclick="App.openAddDealModal()" style="display: inline-flex; align-items: center; gap: 5px;">
            ${Icons.plus(14)} Record New Client Deal
          </button>
        </div>
      ` : (this._dealsViewMode === 'table' ? this.renderDealsTableView(filteredDeals) : this.renderDealsGridView(filteredDeals))}
    `;
  },

  renderDealsGridView(deals) {
    return `
      <div class="deals-grid">
        ${deals.map(deal => this.renderDealDeliveryCard(deal)).join('')}
      </div>
    `;
  },

  renderDealDeliveryCard(deal) {
    const lead = this.state.leads.find(l => l.id === deal.lead_id) || {};
    const clientName = deal.lead_business_name || lead.business_name || deal.lead_name || lead.name || deal.title || 'Client Project';
    const dealTitle = deal.title || 'Client Engagement';
    const city = deal.city || deal.lead_city || lead.city || '';
    const stage = deal.delivery_stage || deal.stage || 'in_development';

    const val = parseFloat(deal.value) || 0;
    const rec = parseFloat(deal.amount_received) || 0;
    const pending = Math.max(0, val - rec);
    const pct = val > 0 ? Math.round((rec / val) * 100) : 0;
    const pstatus = deal.payment_status || (val > 0 && rec >= val ? 'paid' : (rec > 0 ? 'partially_paid' : 'pending'));

    const pstatusLabels = {
      'paid': { label: 'Fully Paid', bg: '#f0fdf4', color: '#16a34a', bar: '#16a34a' },
      'partially_paid': { label: 'Partially Paid', bg: '#eff6ff', color: '#2563eb', bar: '#2563eb' },
      'pending': { label: 'Payment Due', bg: '#fef3c7', color: '#b45309', bar: '#f59e0b' },
      'overdue': { label: 'Overdue', bg: '#fef2f2', color: '#dc2626', bar: '#dc2626' }
    };
    const ps = pstatusLabels[pstatus] || pstatusLabels['pending'];

    // Stage labels
    const stageLabels = {
      'kickoff': { label: 'Kickoff & Scope', cls: 'stage-kickoff' },
      'in_development': { label: 'In Engineering', cls: 'stage-in_development' },
      'staging_uat': { label: 'Staging & UAT', cls: 'stage-staging_uat' },
      'completed': { label: 'Delivered & Live', cls: 'stage-completed' },
      'maintenance': { label: 'Retainer & AMC', cls: 'stage-maintenance' }
    };
    const stg = stageLabels[stage] || stageLabels['in_development'];

    // Deliverables stats
    const delList = this.normalizeDealDeliverables(deal.deliverables);
    const delTotal = delList.length;
    const delCompleted = delList.filter(d => (d && (d.status === 'completed' || d.completed === true))).length;
    const delPct = delTotal > 0 ? Math.round((delCompleted / delTotal) * 100) : 0;

    // Links
    const ghUrl = deal.github_repo_url || '';
    const prodUrl = deal.production_url || '';
    const demoUrl = deal.demo_url || deal.prototype_url || lead.prototype_url || '';
    const docUrl = deal.proposal_url || '';

    // Assigned consultant
    const assigned = this.state.users.find(u => u.id === deal.assigned_to);
    const initials = assigned ? assigned.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : null;

    return `
      <div class="deal-delivery-card" onclick="App.viewDeal('${deal.id}')">
        <!-- Card Header -->
        <div class="deal-card-header">
          <div>
            <div class="deal-client-name">${this.escapeHtml(clientName)}</div>
            <div class="deal-project-title">
              ${this.escapeHtml(dealTitle)}
              ${city ? `&bull; <span>${this.escapeHtml(city)}</span>` : ''}
            </div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
            <span class="deal-stage-pill ${stg.cls}">${stg.label}</span>
            <span style="font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: ${ps.bg}; color: ${ps.color};">
              ${ps.label}
            </span>
          </div>
        </div>

        <!-- Financial Health Meter -->
        <div class="deal-meter-box">
          <div class="deal-meter-header">
            <span style="font-weight: 600; color: var(--color-ink);">Commercials & Payment</span>
            <span style="font-weight: 700; color: var(--color-ink);">${this.formatCurrency(val)}</span>
          </div>
          <div class="deal-meter-bar">
            <div class="deal-meter-fill" style="width: ${Math.min(pct, 100)}%; background: ${ps.bar};"></div>
          </div>
          <div class="deal-meter-footer">
            <span style="color: #16a34a; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;">${Icons.check(11)} Rec: ${this.formatCurrency(rec)} (${pct}%)</span>
            <span style="color: ${pending > 0 ? '#d97706' : '#16a34a'}; font-weight: 500;">
              ${pending > 0 ? `Pending: ${this.formatCurrency(pending)}` : 'Cleared'}
            </span>
          </div>
        </div>

        <!-- Deliverables Checklist Progress -->
        <div style="background: var(--color-surface-alt); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--color-hairline);">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; margin-bottom: 5px;">
            <span style="font-weight: 600; color: var(--color-ink);">Deliverables Checklist</span>
            <span style="font-weight: 600; color: var(--color-ink-soft);">
              ${delTotal > 0 ? `${delCompleted}/${delTotal} Complete (${delPct}%)` : 'Scope Pending'}
            </span>
          </div>
          <div class="deal-deliverables-bar">
            <div class="deal-deliverables-fill" style="width: ${delPct}%;"></div>
          </div>
        </div>

        <!-- Integrated Links Dock -->
        <div class="deal-links-dock" onclick="event.stopPropagation()">
          ${ghUrl ? `
            <a href="${this.escapeHtml(ghUrl)}" target="_blank" class="deal-link-chip chip-gh" title="Open GitHub Repository" style="display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.github(13)} GitHub
            </a>
          ` : `
            <button type="button" class="deal-link-chip" onclick="App.viewDeal('${deal.id}', 'links')" title="Link GitHub Repository" style="opacity: 0.65; display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.plus(11)} GitHub
            </button>
          `}

          ${prodUrl ? `
            <a href="${this.escapeHtml(prodUrl.startsWith('http') ? prodUrl : 'https://' + prodUrl)}" target="_blank" class="deal-link-chip chip-live" title="Open Live Production URL" style="display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.globe(13)} Live App
            </a>
          ` : `
            <button type="button" class="deal-link-chip" onclick="App.viewDeal('${deal.id}', 'links')" title="Set Production Domain" style="opacity: 0.65; display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.plus(11)} Live URL
            </button>
          `}

          ${demoUrl ? `
            <a href="${this.escapeHtml(demoUrl)}" target="_blank" class="deal-link-chip chip-demo" title="Open Staging Demo / Prototype" style="display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.monitor(13)} Staging Demo
            </a>
          ` : ''}

          ${docUrl ? `
            <a href="${this.escapeHtml(docUrl)}" target="_blank" class="deal-link-chip chip-doc" title="View SOW / Quotation Document" style="display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.fileText(13)} SOW Proposal
            </a>
          ` : ''}

          ${deal.lead_id ? `
            <button type="button" class="deal-link-chip chip-agent" onclick="App.viewLead('${deal.lead_id}')" title="Open Local Antigravity Agent for this project" style="display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.bot(13)} Antigravity
            </button>
          ` : ''}
        </div>

        <!-- Footer Strip -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 10px; border-top: 1px solid var(--color-hairline); font-size: 11.5px; color: var(--color-mid-gray);" onclick="event.stopPropagation()">
          <div style="display: flex; align-items: center; gap: 6px;">
            ${assigned ? `
              <div class="user-avatar" style="width: 20px; height: 20px; font-size: 9.5px;" title="${assigned.name}">${initials}</div>
              <span style="color: var(--color-ink); font-weight: 500;">${assigned.name}</span>
            ` : '<span style="color: var(--color-mid-gray);">Unassigned</span>'}
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            ${deal.target_delivery_date || deal.expected_close ? `
              <span title="Target Delivery Date" style="display:inline-flex; align-items:center; gap:4px;">${Icons.calendar(12)} ${this.escapeHtml(deal.target_delivery_date || deal.expected_close)}</span>
            ` : ''}
            <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="App.viewDeal('${deal.id}')">
              Manage Hub &rarr;
            </button>
          </div>
        </div>
      </div>
    `;
  },

  renderDealsTableView(deals) {
    const stageIcons = {
      'kickoff': Icons.rocket(12),
      'in_development': Icons.zap(12),
      'staging_uat': Icons.flaskConical(12),
      'completed': Icons.checkCircle(12),
      'maintenance': Icons.refresh(12)
    };
    const stageNames = {
      'kickoff': 'Kickoff',
      'in_development': 'Engineering',
      'staging_uat': 'Staging/UAT',
      'completed': 'Delivered',
      'maintenance': 'Retainer'
    };

    return `
      <div class="deals-table-card">
        <table class="deals-table">
          <thead>
            <tr>
              <th>Client / Project</th>
              <th>Stage</th>
              <th>Contract Value</th>
              <th>Collected</th>
              <th>Pending</th>
              <th>Status</th>
              <th>Deliverables</th>
              <th>Environment Links</th>
              <th>Target Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${deals.map(d => {
              const lead = this.state.leads.find(l => l.id === d.lead_id) || {};
              const clientName = d.lead_business_name || lead.business_name || d.lead_name || lead.name || d.title;
              const val = parseFloat(d.value) || 0;
              const rec = parseFloat(d.amount_received) || 0;
              const pend = Math.max(0, val - rec);
              const delList = d.deliverables || [];
              const delTotal = delList.length;
              const delComp = delList.filter(item => item && (item.status === 'completed' || item.completed === true)).length;
              const stgKey = d.delivery_stage || d.stage || 'in_development';
              const stageIcon = stageIcons[stgKey] || Icons.zap(12);
              const stageText = stageNames[stgKey] || 'Engineering';

              return `
                <tr onclick="App.viewDeal('${d.id}')">
                  <td>
                    <div style="font-weight: 600; color: var(--color-ink);">${this.escapeHtml(clientName)}</div>
                    <div style="font-size: 11.5px; color: var(--color-mid-gray);">${this.escapeHtml(d.title || '')}</div>
                  </td>
                  <td>
                    <span class="deal-stage-pill stage-${stgKey}" style="display:inline-flex; align-items:center; gap:4px;">${stageIcon} ${stageText}</span>
                  </td>
                  <td style="font-weight: 600;">${this.formatCurrency(val)}</td>
                  <td style="color: #16a34a; font-weight: 600;">${this.formatCurrency(rec)}</td>
                  <td style="color: ${pend > 0 ? '#d97706' : 'var(--color-ink)'};">${this.formatCurrency(pend)}</td>
                  <td>
                    <span class="badge" style="font-size: 10.5px; text-transform: uppercase;">
                      ${this.escapeHtml(d.payment_status || 'pending')}
                    </span>
                  </td>
                  <td>
                    <span style="font-size: 11.5px; font-weight: 500;">
                      ${delTotal > 0 ? `${delComp}/${delTotal} Done` : '—'}
                    </span>
                  </td>
                  <td onclick="event.stopPropagation()">
                    <div style="display: flex; gap: 5px;">
                      ${d.github_repo_url ? `<a href="${this.escapeHtml(d.github_repo_url)}" target="_blank" class="deal-link-chip chip-gh" title="GitHub" style="display:inline-flex; align-items:center;">${Icons.github(12)}</a>` : ''}
                      ${d.production_url ? `<a href="${this.escapeHtml(d.production_url)}" target="_blank" class="deal-link-chip chip-live" title="Live" style="display:inline-flex; align-items:center;">${Icons.globe(12)}</a>` : ''}
                      ${d.demo_url ? `<a href="${this.escapeHtml(d.demo_url)}" target="_blank" class="deal-link-chip chip-demo" title="Demo" style="display:inline-flex; align-items:center;">${Icons.monitor(12)}</a>` : ''}
                      ${d.proposal_url ? `<a href="${this.escapeHtml(d.proposal_url)}" target="_blank" class="deal-link-chip chip-doc" title="SOW" style="display:inline-flex; align-items:center;">${Icons.fileText(12)}</a>` : ''}
                    </div>
                  </td>
                  <td style="font-size: 11.5px; color: var(--color-mid-gray);">
                    ${this.escapeHtml(d.target_delivery_date || d.expected_close || '—')}
                  </td>
                  <td onclick="event.stopPropagation()">
                    <button class="btn btn-secondary btn-sm" onclick="App.viewDeal('${d.id}')">Manage</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  async viewDeal(dealId, defaultTab = 'deliverables', pushRoute = true) {
    if (pushRoute) {
      const targetHash = `#/deals/${dealId}`;
      if (window.location.hash !== targetHash && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', targetHash);
      }
    }
    this.state.selectedDealId = dealId;
    try {
      const deal = await API.get(`/api/deals/${dealId}`);
      if (!deal) return;
      this.state.selectedDeal = deal;
      this.openDealManagementModal(deal, defaultTab);
    } catch (e) {
      console.error(e);
      API.showToast('Could not load deal details', 'error');
    }
  },

  formatCurrency(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return '₹0';
    const magnitude = Math.abs(value);
    const [scale, suffix] = magnitude >= 10000000 ? [10000000, 'Cr']
      : magnitude >= 100000 ? [100000, 'L'] : magnitude >= 1000 ? [1000, 'K'] : [1, ''];
    return `${value < 0 ? '-' : ''}₹${(magnitude / scale).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${suffix}`;
  },

  normalizeDealDeliverables(items) {
    if (!Array.isArray(items)) return [];
    return items.map(item => typeof item === 'string'
      ? { title: item, status: 'pending' }
      : { ...item, title: item?.title || item?.name || 'Untitled deliverable' });
  },

  openDealManagementModal(deal, activeTab = 'deliverables') {
    const lead = this.state.leads.find(l => l.id === deal.lead_id) || {};
    const clientName = deal.lead_business_name || lead.business_name || deal.lead_name || lead.name || deal.title;
    const val = parseFloat(deal.value) || 0;
    const rec = parseFloat(deal.amount_received) || 0;
    const pending = Math.max(0, val - rec);

    const deliverables = this.normalizeDealDeliverables(deal.deliverables);
    const milestones = deal.payment_milestones || [];

    const modalHtml = `
      <div class="modal-header" style="padding: 16px 20px; border-bottom: 1px solid var(--color-hairline); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display:inline-flex; align-items:center; color: var(--color-ink);">${Icons.briefcase(20)}</span>
            <h3 style="font-size: 17px; font-weight: 700; color: var(--color-ink); margin: 0;">${this.escapeHtml(clientName)}</h3>
            <span class="deal-stage-pill stage-${deal.delivery_stage || 'in_development'}">
              ${(deal.delivery_stage || 'in_development').toUpperCase()}
            </span>
          </div>
          <p style="font-size: 12px; color: var(--color-mid-gray); margin: 2px 0 0 0;">
            ${this.escapeHtml(deal.title)} &bull; Contract Value: <strong style="color: var(--color-ink);">${this.formatCurrency(val)}</strong>
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${deal.lead_id ? `
            <button class="btn btn-secondary btn-sm" onclick="App.closeModal(); App.viewLead('${deal.lead_id}');" style="display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.user(12)} Open Lead Record
            </button>
          ` : ''}
          <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="deal-modal-tabs" role="tablist" aria-label="Deal management">
        <button type="button" class="deal-modal-tab-btn ${activeTab === 'deliverables' ? 'active' : ''}" 
                data-deal-tab="deliverables" role="tab" aria-selected="${activeTab === 'deliverables'}" aria-controls="deal-tab-deliverables" onclick="App.switchDealModalTab('deliverables')" style="display: inline-flex; align-items: center; gap: 5px;">
          ${Icons.clipboardList(14)} Scope & Deliverables (${deliverables.length})
        </button>
        <button type="button" class="deal-modal-tab-btn ${activeTab === 'payments' ? 'active' : ''}" 
                data-deal-tab="payments" role="tab" aria-selected="${activeTab === 'payments'}" aria-controls="deal-tab-payments" onclick="App.switchDealModalTab('payments')" style="display: inline-flex; align-items: center; gap: 5px;">
          ${Icons.creditCard(14)} Payments & Milestones
        </button>
        <button type="button" class="deal-modal-tab-btn ${activeTab === 'links' ? 'active' : ''}" 
                data-deal-tab="links" role="tab" aria-selected="${activeTab === 'links'}" aria-controls="deal-tab-links" onclick="App.switchDealModalTab('links')" style="display: inline-flex; align-items: center; gap: 5px;">
          ${Icons.wrench(14)} Engineering & Environments
        </button>
        <button type="button" class="deal-modal-tab-btn ${activeTab === 'details' ? 'active' : ''}" 
                data-deal-tab="details" role="tab" aria-selected="${activeTab === 'details'}" aria-controls="deal-tab-details" onclick="App.switchDealModalTab('details')" style="display: inline-flex; align-items: center; gap: 5px;">
          ${Icons.fileText(14)} Commercials & Contract
        </button>
      </div>

      <div class="modal-body" style="padding: 20px;">
        <!-- TAB 1: DELIVERABLES -->
        <div id="deal-tab-deliverables" style="${activeTab === 'deliverables' ? '' : 'display: none;'}">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <div>
              <h4 style="font-size: 14px; font-weight: 600; color: var(--color-ink); margin: 0;">Client Scope of Work & Deliverables</h4>
              <p style="font-size: 12px; color: var(--color-mid-gray); margin: 2px 0 0 0;">Check off completed items as they are delivered to the client</p>
            </div>
            <span style="font-size: 12px; font-weight: 600; color: var(--color-ink);">
              ${deliverables.filter(d => (d && (d.status === 'completed' || d.completed === true))).length} of ${deliverables.length} Completed
            </span>
          </div>

          <!-- Add Deliverable Form -->
          <div style="display: flex; gap: 8px; margin-bottom: 16px;">
            <input type="text" id="new-deliverable-title" class="input" placeholder="e.g. Warehouse Inventory Tracking Module, WhatsApp OTP..." style="flex: 1; height: 36px;" />
            <button type="button" class="btn btn-primary btn-sm" onclick="App.addDealDeliverable('${deal.id}')" style="display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.plus(13)} Add Deliverable
            </button>
          </div>

          <!-- Deliverables List -->
          <div id="deal-deliverables-list" style="display: flex; flex-direction: column; gap: 8px;">
            ${deliverables.length === 0 ? `
              <div style="padding: 24px; text-align: center; color: var(--color-mid-gray); font-size: 12.5px; border: 1px dashed var(--color-hairline); border-radius: var(--radius-sm);">
                No deliverables defined yet. Add the key modules or milestones you are contracted to build.
              </div>
            ` : deliverables.map((del, idx) => {
              const isDone = (del.status === 'completed' || del.completed === true);
              return `
              <div class="ui-deliverable">
                <div class="ui-deliverable-content">
                  <input type="checkbox" ${isDone ? 'checked' : ''} 
                         onchange="App.toggleDealDeliverable('${deal.id}', ${idx})" 
                         style="width: 17px; height: 17px; cursor: pointer; accent-color: #10b981;" />
                  <span style="font-size: 13px; color: var(--color-ink); ${isDone ? 'text-decoration: line-through; opacity: 0.6;' : 'font-weight: 500;'}">
                    ${this.escapeHtml(del.title)}
                  </span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="badge ${isDone ? 'badge-success' : 'badge-default'}" style="font-size: 11px;">
                    ${isDone ? `<span style="display:inline-flex; align-items:center; gap:3px;">${Icons.check(11)} Completed</span>` : 'In Progress'}
                  </span>
                  <button type="button" class="btn-icon" style="color: var(--color-critical); padding: 4px;" onclick="App.deleteDealDeliverable('${deal.id}', ${idx})" title="Remove Deliverable">
                    ${Icons.trash(13)}
                  </button>
                </div>
              </div>
            `;
            }).join('')}
          </div>
        </div>

        <!-- TAB 2: PAYMENTS & MILESTONES -->
        <div id="deal-tab-payments" style="${activeTab === 'payments' ? '' : 'display: none;'}">
          <!-- Financial Snapshot -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px;">
            <div style="background: var(--color-surface-alt); padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--color-hairline);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--color-mid-gray); font-weight: 600;">Total Contract</div>
              <div style="font-size: 20px; font-weight: 700; color: var(--color-ink); margin-top: 4px;">${this.formatCurrency(val)}</div>
            </div>
            <div style="background: var(--color-surface-alt); padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--color-hairline);">
              <div style="font-size: 11px; text-transform: uppercase; color: #16a34a; font-weight: 600;">Amount Received</div>
              <div style="font-size: 20px; font-weight: 700; color: #16a34a; margin-top: 4px;">${this.formatCurrency(rec)}</div>
            </div>
            <div style="background: var(--color-surface-alt); padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--color-hairline);">
              <div style="font-size: 11px; text-transform: uppercase; color: ${pending > 0 ? '#d97706' : '#16a34a'}; font-weight: 600;">Pending Balance</div>
              <div style="font-size: 20px; font-weight: 700; color: ${pending > 0 ? '#d97706' : 'var(--color-ink)'}; margin-top: 4px;">${this.formatCurrency(pending)}</div>
            </div>
          </div>

          <!-- Quick Record Payment Form -->
          <div style="background: var(--color-paper); border: 1px solid var(--color-hairline); border-radius: var(--radius-sm); padding: 16px; margin-bottom: 20px;">
            <h4 style="font-size: 13.5px; font-weight: 600; color: var(--color-ink); margin: 0 0 10px 0;">Record Payment Received</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 10px; align-items: flex-end;">
              <div>
                <label style="font-size: 11.5px; font-weight: 500; color: var(--color-mid-gray); display: block; margin-bottom: 4px;">Payment Amount (₹):</label>
                <input type="number" id="pay-record-amount" class="input" placeholder="e.g. 50000" style="height: 36px;" />
              </div>
              <div>
                <label style="font-size: 11.5px; font-weight: 500; color: var(--color-mid-gray); display: block; margin-bottom: 4px;">Note / Transaction Ref:</label>
                <input type="text" id="pay-record-note" class="input" placeholder="e.g. Advance paid via NEFT/Cheque" style="height: 36px;" />
              </div>
              <button type="button" class="btn btn-primary" onclick="App.recordDealPayment('${deal.id}')" style="height: 36px; display: inline-flex; align-items: center; gap: 4px;">
                ${Icons.check(13)} Record Payment
              </button>
            </div>
          </div>

          <!-- Milestones Breakdown -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="font-size: 13.5px; font-weight: 600; color: var(--color-ink); margin: 0;">Payment Milestones Schedule</h4>
            <span style="font-size: 11.5px; color: var(--color-mid-gray);">Break contract into stages</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
            ${milestones.length === 0 ? `
              <div style="padding: 18px; text-align: center; color: var(--color-mid-gray); font-size: 12px; border: 1px dashed var(--color-hairline); border-radius: var(--radius-sm);">
                No milestones added. Add milestones (e.g. 50% Advance, 25% UAT Release, 25% Production Handover).
              </div>
            ` : milestones.map((m, idx) => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: var(--radius-sm); font-size: 12.5px;">
                <div style="font-weight: 600; color: var(--color-ink);">${this.escapeHtml(m.title)}</div>
                <div style="display: flex; align-items: center; gap: 14px;">
                  <span style="font-weight: 600;">${this.formatCurrency((parseFloat(m.amount) || 0))}</span>
                  <span class="badge ${m.status === 'paid' ? 'badge-success' : 'badge-warning'}">
                    ${m.status === 'paid' ? `<span style="display:inline-flex; align-items:center; gap:3px;">${Icons.check(11)} Paid</span>` : (m.status === 'due' ? 'Due' : 'Pending')}
                  </span>
                  <button type="button" class="btn-icon" style="color: var(--color-critical); padding: 2px;" onclick="App.deleteDealMilestone('${deal.id}', ${idx})" title="Remove Milestone">${Icons.trash(13)}</button>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Add Milestone Form -->
          <div style="display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 8px; align-items: flex-end;">
            <div>
              <label style="font-size: 11px; color: var(--color-mid-gray); display: block; margin-bottom: 3px;">Milestone Title:</label>
              <input type="text" id="new-milestone-title" class="input" placeholder="e.g. UAT Release" style="height: 34px;" />
            </div>
            <div>
              <label style="font-size: 11px; color: var(--color-mid-gray); display: block; margin-bottom: 3px;">Amount (₹):</label>
              <input type="number" id="new-milestone-amount" class="input" placeholder="75000" style="height: 34px;" />
            </div>
            <div>
              <label style="font-size: 11px; color: var(--color-mid-gray); display: block; margin-bottom: 3px;">Status:</label>
              <select id="new-milestone-status" class="select" style="height: 34px;">
                <option value="pending">Pending</option>
                <option value="due">Due</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="App.addDealMilestone('${deal.id}')" style="height: 34px;">
              + Add
            </button>
          </div>
        </div>

        <!-- TAB 3: ENGINEERING & LINKS HUB -->
        <div id="deal-tab-links" style="${activeTab === 'links' ? '' : 'display: none;'}">
          <form onsubmit="App.handleSaveDealLinks(event, '${deal.id}')">
            <div style="margin-bottom: 14px;">
              <label style="display: block; font-size: 12px; font-weight: 600; color: var(--color-ink); margin-bottom: 5px;">
                <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.github(13)} GitHub Repository URL:</span>
              </label>
              <div style="display: flex; gap: 8px;">
                <input type="url" name="github_repo_url" class="input" value="${this.escapeHtml(deal.github_repo_url || '')}" placeholder="https://github.com/organization/project-repo" style="flex: 1;" />
                ${deal.github_repo_url ? `
                  <a href="${this.escapeHtml(deal.github_repo_url)}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px;">
                    Open &rarr;
                  </a>
                ` : ''}
              </div>
            </div>

            <div style="margin-bottom: 14px;">
              <label style="display: block; font-size: 12px; font-weight: 600; color: var(--color-ink); margin-bottom: 5px;">
                <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.globe(13)} Production Domain URL:</span>
              </label>
              <div style="display: flex; gap: 8px;">
                <input type="text" name="production_url" class="input" value="${this.escapeHtml(deal.production_url || '')}" placeholder="https://admin.clientdomain.com" style="flex: 1;" />
                ${deal.production_url ? `
                  <a href="${this.escapeHtml(deal.production_url.startsWith('http') ? deal.production_url : 'https://' + deal.production_url)}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px;">
                    Launch &rarr;
                  </a>
                ` : ''}
              </div>
            </div>

            <div style="margin-bottom: 14px;">
              <label style="display: block; font-size: 12px; font-weight: 600; color: var(--color-ink); margin-bottom: 5px;">
                <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.monitor(13)} Staging / Interactive Demo URL:</span>
              </label>
              <div style="display: flex; gap: 8px;">
                <input type="text" name="demo_url" class="input" value="${this.escapeHtml(deal.demo_url || '')}" placeholder="https://cos.zero7.space/p/token or https://preview.vercel.app" style="flex: 1;" />
                ${deal.demo_url ? `
                  <a href="${this.escapeHtml(deal.demo_url)}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px;">
                    Preview &rarr;
                  </a>
                ` : ''}
              </div>
            </div>

            <div style="margin-bottom: 18px;">
              <label style="display: block; font-size: 12px; font-weight: 600; color: var(--color-ink); margin-bottom: 5px;">
                <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.fileText(13)} Proposal / SOW Document Link or File:</span>
              </label>
              <div style="display: flex; gap: 8px;">
                <input type="text" name="proposal_url" class="input" value="${this.escapeHtml(deal.proposal_url || '')}" placeholder="Google Drive link or PDF document path" style="flex: 1;" />
                ${deal.proposal_url ? `
                  <a href="${this.escapeHtml(deal.proposal_url)}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px;">
                    View &rarr;
                  </a>
                ` : ''}
              </div>
            </div>

            ${deal.project_path ? `
              <div style="background: var(--color-surface-alt); padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--color-hairline); margin-bottom: 18px; font-size: 12px;">
                <div style="font-weight: 600; color: var(--color-ink); margin-bottom: 4px; display:inline-flex; align-items:center; gap:4px;">${Icons.bot(13)} Local Antigravity Workspace:</div>
                <code style="font-size: 11px; word-break: break-all; color: var(--color-ink);">${this.escapeHtml(deal.project_path)}</code>
              </div>
            ` : ''}

            <div style="display: flex; justify-content: flex-end;">
              <button type="submit" class="btn btn-primary">Save Environments & Links</button>
            </div>
          </form>
        </div>

        <!-- TAB 4: COMMERCIALS & CONTRACT DETAILS -->
        <div id="deal-tab-details" style="${activeTab === 'details' ? '' : 'display: none;'}">
          <form onsubmit="App.handleSaveDealCommercials(event, '${deal.id}')">
            <div class="form-group" style="margin-bottom: 14px;">
              <label>Deal / Project Title *</label>
              <input type="text" name="title" class="input" value="${this.escapeHtml(deal.title)}" required />
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
              <div class="form-group">
                <label>Total Contract Value (₹) *</label>
                <input type="number" name="value" class="input" value="${deal.value || 0}" required />
              </div>
              <div class="form-group">
                <label>Delivery Stage</label>
                <select name="delivery_stage" class="select">
                  <option value="kickoff" ${deal.delivery_stage === 'kickoff' ? 'selected' : ''}>Kickoff & Scope</option>
                  <option value="in_development" ${deal.delivery_stage === 'in_development' ? 'selected' : ''}>In Engineering</option>
                  <option value="staging_uat" ${deal.delivery_stage === 'staging_uat' ? 'selected' : ''}>Staging & UAT</option>
                  <option value="completed" ${deal.delivery_stage === 'completed' ? 'selected' : ''}>Delivered & Live</option>
                  <option value="maintenance" ${deal.delivery_stage === 'maintenance' ? 'selected' : ''}>Retainer & AMC</option>
                </select>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
              <div class="form-group">
                <label>Target Delivery Date</label>
                <input type="date" name="target_delivery_date" class="input" value="${deal.target_delivery_date || deal.expected_close || ''}" />
              </div>
              <div class="form-group">
                <label>Assigned Consultant</label>
                <select name="assigned_to" class="select">
                  ${this.state.users.map(u => `<option value="${u.id}" ${deal.assigned_to === u.id ? 'selected' : ''}>${u.name} (${u.role})</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 18px;">
              <label>Deal Scope & Commercial Notes</label>
              <textarea name="notes" class="input" rows="4">${this.escapeHtml(deal.notes || '')}</textarea>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
              <button type="button" class="btn btn-secondary" style="color: var(--color-critical); border-color: var(--color-hairline); display: inline-flex; align-items: center; gap: 4px;" onclick="App.revertDealToLead('${deal.id}')">
                ${Icons.rotateCcw(12)} Revert Deal to Lead
              </button>
              <button type="submit" class="btn btn-primary">Update Contract</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.openModal(modalHtml, { size: 'xl' });
  },

  switchDealModalTab(tabName) {
    const tabs = ['deliverables', 'payments', 'links', 'details'];
    tabs.forEach(t => {
      const el = document.getElementById(`deal-tab-${t}`);
      if (el) el.style.display = (t === tabName ? '' : 'none');
    });
    document.querySelectorAll('.deal-modal-tab-btn').forEach(btn => {
      const selected = btn.dataset.dealTab === tabName;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
  },

  async addDealDeliverable(dealId) {
    const input = document.getElementById('new-deliverable-title');
    const title = input ? input.value.trim() : '';
    if (!title) return;

    try {
      const deal = this.state.selectedDeal;
      const deliverables = this.normalizeDealDeliverables(deal.deliverables);
      deliverables.push({ id: 'del_' + Date.now().toString(36), title: title, status: 'pending' });
      await API.post(`/api/deals/${dealId}/deliverables`, { deliverables });
      API.showToast('Deliverable added', 'success');
      await this.loadInitialData();
      await this.viewDeal(dealId, 'deliverables');
    } catch (e) {
      console.error(e);
      API.showToast('Failed to add deliverable', 'error');
    }
  },

  async toggleDealDeliverable(dealId, index) {
    try {
      const deal = this.state.selectedDeal;
      const deliverables = this.normalizeDealDeliverables(deal.deliverables);
      if (deliverables[index]) {
        const isDone = (deliverables[index].status === 'completed' || deliverables[index].completed === true);
        deliverables[index].status = isDone ? 'in_progress' : 'completed';
        deliverables[index].completed = !isDone;
      }
      await API.post(`/api/deals/${dealId}/deliverables`, { deliverables });
      await this.loadInitialData();
      await this.viewDeal(dealId, 'deliverables');
    } catch (e) {
      console.error(e);
    }
  },

  async deleteDealDeliverable(dealId, index) {
    try {
      const deal = this.state.selectedDeal;
      const deliverables = this.normalizeDealDeliverables(deal.deliverables);
      deliverables.splice(index, 1);
      await API.post(`/api/deals/${dealId}/deliverables`, { deliverables });
      await this.loadInitialData();
      await this.viewDeal(dealId, 'deliverables');
    } catch (e) {
      console.error(e);
    }
  },

  async recordDealPayment(dealId) {
    const amtInput = document.getElementById('pay-record-amount');
    const noteInput = document.getElementById('pay-record-note');
    const amount = parseFloat(amtInput ? amtInput.value : 0);
    const note = noteInput ? noteInput.value.trim() : '';

    if (!amount || amount <= 0) {
      API.showToast('Please enter a valid payment amount', 'error');
      return;
    }

    try {
      const deal = this.state.selectedDeal;
      const currentRec = parseFloat(deal.amount_received) || 0;
      const newRec = currentRec + amount;
      const val = parseFloat(deal.value) || 0;
      const pstatus = (val > 0 && newRec >= val) ? 'paid' : 'partially_paid';

      const milestones = deal.payment_milestones || [];
      if (note) {
        milestones.push({
          title: note,
          amount: amount,
          status: 'paid',
          due_date: new Date().toISOString().split('T')[0]
        });
      }

      await API.post(`/api/deals/${dealId}/milestones`, {
        amount_received: newRec,
        payment_status: pstatus,
        payment_milestones: milestones
      });

      API.showToast(`Payment of ${this.formatCurrency(amount)} recorded!`, 'success');
      await this.loadInitialData();
      await this.viewDeal(dealId, 'payments');
    } catch (e) {
      console.error(e);
      API.showToast('Failed to record payment', 'error');
    }
  },

  async addDealMilestone(dealId) {
    const tInput = document.getElementById('new-milestone-title');
    const aInput = document.getElementById('new-milestone-amount');
    const sInput = document.getElementById('new-milestone-status');
    const title = tInput ? tInput.value.trim() : '';
    const amount = parseFloat(aInput ? aInput.value : 0) || 0;
    const status = sInput ? sInput.value : 'pending';

    if (!title) return;

    try {
      const deal = this.state.selectedDeal;
      const milestones = deal.payment_milestones || [];
      milestones.push({ title, amount, status, due_date: '' });
      await API.post(`/api/deals/${dealId}/milestones`, { payment_milestones: milestones });
      API.showToast('Milestone added', 'success');
      await this.loadInitialData();
      await this.viewDeal(dealId, 'payments');
    } catch (e) {
      console.error(e);
    }
  },

  async deleteDealMilestone(dealId, index) {
    try {
      const deal = this.state.selectedDeal;
      const milestones = deal.payment_milestones || [];
      milestones.splice(index, 1);
      await API.post(`/api/deals/${dealId}/milestones`, { payment_milestones: milestones });
      await this.loadInitialData();
      await this.viewDeal(dealId, 'payments');
    } catch (e) {
      console.error(e);
    }
  },

  async handleSaveDealLinks(e, dealId) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());

    try {
      await API.put(`/api/deals/${dealId}`, data);
      API.showToast('Environments & Links saved', 'success');
      await this.loadInitialData();
      await this.viewDeal(dealId, 'links');
    } catch (e) {
      console.error(e);
      API.showToast('Failed to save links', 'error');
    }
  },

  async handleSaveDealCommercials(e, dealId) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    if (data.value) data.value = parseFloat(data.value);

    try {
      await API.put(`/api/deals/${dealId}`, data);
      API.showToast('Contract details updated', 'success');
      await this.loadInitialData();
      await this.viewDeal(dealId, 'details');
    } catch (e) {
      console.error(e);
      API.showToast('Failed to update deal', 'error');
    }
  },

  // ---------------- 4. INTEGRATIONS HUB ----------------

  async renderIntegrationsPage() {
    const container = document.getElementById('page-content');
    if (!container) return;

    container.innerHTML = `<div style="padding: 32px; text-align: center; color: var(--color-mid-gray);">Loading integrations status...</div>`;

    const isAdmin = this.state.currentUser?.role === 'admin';

    try {
      const [intStatus, gtasksStatus, waAdminStatus, workersRes] = await Promise.all([
        API.get('/api/integrations/status').catch(() => ({})),
        API.get('/api/integrations/google-tasks/status').catch(() => ({ connected: false })),
        isAdmin ? API.get('/api/admin/whatsapp/status').catch(() => null) : Promise.resolve(null),
        API.get('/api/agent/workers').catch(() => ({ workers: [] }))
      ]);
      this.state.integrationsStatus = intStatus;
      this.state.gtasksStatus = gtasksStatus;
      this.state.waAdminStatus = waAdminStatus;
      this.state.desktopWorkers = workersRes?.workers || [];
    } catch (e) {
      console.error(e);
    }

    const int = this.state.integrationsStatus || {};
    const gtasks = this.state.gtasksStatus || {};
    const wa = this.state.waAdminStatus || {};
    const workers = this.state.desktopWorkers || [];
    const onlineWorkers = workers.filter(w => w.status === 'online');

    const pAcc = wa.accounts?.personal || {
      id: 'personal',
      label: 'Abhijeet Personal',
      phone: '9993202900',
      status: 'disconnected',
      messagesSynced: int.whatsapp?.messages_synced || 0
    };

    const cAcc = wa.accounts?.central || {
      id: 'central',
      label: 'Zero7 Central',
      phone: '9479007951',
      status: 'disconnected',
      messagesSynced: 0
    };

    const isPConnected = pAcc.status === 'connected';
    const isCConnected = cAcc.status === 'connected';

    container.innerHTML = `
      <div style="max-width: 1100px; margin: 0 auto; padding: 24px 16px;">
        <div style="margin-bottom: 24px;">
          <h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.5px;">Integrations & Webhooks</h1>
          <p style="font-size: 13.5px; color: var(--color-mid-gray); margin-top: 4px;">
            Manage connections for Meta Lead Ads, WhatsApp multi-account sync, B2B lead scraping, Google Drive, and Google Tasks.
          </p>
        </div>

        <div class="integrations-grid">
          <!-- WhatsApp Multi-Account 24/7 Daemon Sync Hub (Full Width) -->
          <div class="integration-card" style="grid-column: 1 / -1;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 12px;">
                <div>
                  <h3 style="font-size: 17px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                    ${Icons.whatsapp(18)} WhatsApp 24/7 Multi-Account Sync
                  </h3>
                  <p style="font-size: 13px; color: var(--color-mid-gray); margin-top: 4px;">
                    Always-on background sync running on droplet. Manages two separate accounts—<strong>Abhijeet Personal</strong> and <strong>Zero7 Central</strong>—with completely isolated tokens.
                  </p>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="status-indicator">
                    <span class="status-dot ${wa.daemon_online !== false ? 'active' : ''}" style="${wa.daemon_online === false ? 'background:#ef4444;' : ''}"></span> ${wa.daemon_online !== false ? '24/7 Host Daemon Active' : 'Daemon Offline'}
                  </span>
                  ${isAdmin ? `
                    <button class="btn btn-secondary btn-sm" onclick="App.renderIntegrationsPage()" title="Refresh live status">
                      ${Icons.refresh(12)} Refresh Status
                    </button>
                  ` : ''}
                </div>
              </div>

              <!-- Two-Account Grid -->
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin: 16px 0 8px 0;">

                <!-- Account 1: Personal (Abhijeet) -->
                <div style="background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: var(--radius-sm); padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                      <div style="font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                        <span style="display:inline-flex; align-items:center;">${Icons.smartphone(15)}</span> ${this.escapeHtml(pAcc.label || 'Abhijeet Personal')}
                      </div>
                      <span class="status-indicator" style="font-size: 11.5px;">
                        <span class="status-dot ${isPConnected ? 'active' : ''}" style="${!isPConnected ? 'background:#ef4444;' : ''}"></span>
                        ${isPConnected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>

                    <div style="font-size: 12px; color: var(--color-mid-gray); line-height: 1.7; margin-bottom: 12px;">
                      <div>Linked Phone: <strong style="color: var(--color-ink);">${isPConnected ? '+91 ' + this.escapeHtml(pAcc.phone || '9993202900') : '+91 ' + this.escapeHtml(pAcc.phone || '9993202900') + ' (Unlinked)'}</strong></div>
                      <div>Droplet Token Store: <code>auth_personal/</code> (Isolated)</div>
                      <div>Messages Synced: <strong style="color: var(--color-ink);">${pAcc.messagesSynced || 0} messages</strong></div>
                    </div>
                  </div>

                  <div>
                    ${isAdmin ? `
                      <div style="display: flex; gap: 8px; margin-top: 6px;">
                        ${isPConnected ? `
                          <button class="btn btn-secondary btn-sm" style="flex: 1; justify-content: center;" onclick="App.openWhatsAppQRModal('personal')">
                            ${Icons.qrcode(12)} Re-link / Scan QR
                          </button>
                          <button class="btn btn-secondary btn-sm" style="color: #ef4444;" onclick="App.disconnectWhatsAppAccount('personal')" title="Reset companion session">
                            Disconnect
                          </button>
                        ` : `
                          <button class="btn btn-primary btn-sm" style="flex: 1; justify-content: center; background: #00a884; border-color: #00a884; font-weight: 600; padding: 7px 12px;" onclick="App.openWhatsAppQRModal('personal')">
                            ${Icons.qrcode(14)} This number is disconnected &bull; Tap to connect
                          </button>
                        `}
                      </div>
                    ` : `
                      <div style="font-size: 11.5px; color: var(--color-mid-gray); font-style: italic;">
                        ${isPConnected ? 'Connected companion session (Admin managed)' : 'Disconnected (Admin connection required)'}
                      </div>
                    `}
                  </div>
                </div>

                <!-- Account 2: Zero7 Central (Company) -->
                <div style="background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: var(--radius-sm); padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                      <div style="font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                        <span style="display:inline-flex; align-items:center;">${Icons.building(15)}</span> ${this.escapeHtml(cAcc.label || 'Zero7 Central')}
                      </div>
                      <span class="status-indicator" style="font-size: 11.5px;">
                        <span class="status-dot ${isCConnected ? 'active' : ''}" style="${!isCConnected ? 'background:#ef4444;' : ''}"></span>
                        ${isCConnected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>

                    <div style="font-size: 12px; color: var(--color-mid-gray); line-height: 1.7; margin-bottom: 12px;">
                      <div>Linked Phone: <strong style="color: var(--color-ink);">${isCConnected ? '+91 ' + this.escapeHtml(cAcc.phone || '9479007951') : '+91 ' + this.escapeHtml(cAcc.phone || '9479007951') + ' (Unlinked)'}</strong></div>
                      <div>Droplet Token Store: <code>auth_central/</code> (Isolated)</div>
                      <div>Messages Synced: <strong style="color: var(--color-ink);">${cAcc.messagesSynced || 0} messages</strong></div>
                    </div>
                  </div>

                  <div>
                    ${isAdmin ? `
                      <div style="display: flex; gap: 8px; margin-top: 6px;">
                        ${isCConnected ? `
                          <button class="btn btn-secondary btn-sm" style="flex: 1; justify-content: center;" onclick="App.openWhatsAppQRModal('central')">
                            ${Icons.qrcode(12)} Re-link / Scan QR
                          </button>
                          <button class="btn btn-secondary btn-sm" style="color: #ef4444;" onclick="App.disconnectWhatsAppAccount('central')" title="Reset companion session">
                            Disconnect
                          </button>
                        ` : `
                          <button class="btn btn-primary btn-sm" style="flex: 1; justify-content: center; background: #00a884; border-color: #00a884; font-weight: 600; padding: 7px 12px;" onclick="App.openWhatsAppQRModal('central')">
                            ${Icons.qrcode(14)} This number is disconnected &bull; Tap to connect
                          </button>
                        `}
                      </div>
                    ` : `
                      <div style="font-size: 11.5px; color: var(--color-mid-gray); font-style: italic;">
                        ${isCConnected ? 'Connected companion session (Admin managed)' : 'Disconnected (Admin connection required)'}
                      </div>
                    `}
                  </div>
                </div>

              </div>

              <div style="font-size: 11.5px; color: var(--color-mid-gray); margin-top: 6px;">
                <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.lock(12)} Both accounts are hosted independently on your droplet with separate encryption keys. Scanning either QR directly creates the token on the droplet.</span>
              </div>
            </div>
          </div>

          <!-- Zero7 Desktop Agent Bridge & Antigravity Workstations (Full Width) -->
          <div class="integration-card" style="grid-column: 1 / -1;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
                <div>
                  <h3 style="font-size: 17px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                    ${Icons.monitor(18)} Zero7 Desktop Agent Bridge &amp; Workstation Engine
                  </h3>
                  <p style="font-size: 13px; color: var(--color-mid-gray); margin-top: 4px;">
                    Companion app running on founder/engineer workstations. Connects Cloud CRM to local Google Antigravity engines at <strong>zero token cost</strong>, syncs client GitHub repos, and resolves local file data pills.
                  </p>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="status-indicator">
                    <span class="status-dot ${onlineWorkers.length > 0 ? 'active' : ''}" style="${onlineWorkers.length === 0 ? 'background:#ef4444;' : ''}"></span>
                    ${onlineWorkers.length > 0 ? `${onlineWorkers.length} Workstation${onlineWorkers.length > 1 ? 's' : ''} Online` : 'No Workstations Active'}
                  </span>
                  <button class="btn btn-secondary btn-sm" onclick="App.renderIntegrationsPage()" title="Refresh live status">
                    ${Icons.refresh(12)} Refresh
                  </button>
                </div>
              </div>

              <!-- Active Workstations Grid -->
              <div style="margin: 16px 0 12px 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                  <div style="font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-mid-gray);">
                    Connected Workstations &amp; Linked Accounts
                  </div>
                  <div style="display: flex; align-items: center; gap: 10px; font-size: 11.5px; color: var(--color-mid-gray);">
                    <span>Total Registered: <strong style="color: var(--color-ink);">${workers.length}</strong></span>
                    ${workers.length > 1 ? `
                      <button class="btn btn-ghost btn-xs" onclick="App.pruneWorkers()" style="font-size: 11px; padding: 2px 8px; color: var(--color-mid-gray);" title="Clean up stale or duplicate workstations">
                        🧹 Prune Inactive
                      </button>
                    ` : ''}
                  </div>
                </div>

                ${workers.length > 0 ? `
                  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px;">
                    ${workers.map(w => {
                      const isOnline = w.status === 'online';
                      const lsAddr = w.metadata?.ls_address || 'Unreachable';
                      const pid = w.metadata?.pid || '—';
                      const jobsCount = w.metadata?.projects?.length || 0;
                      return `
                        <div style="background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: var(--radius-sm); padding: 14px; display: flex; flex-direction: column; justify-content: space-between;">
                          <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                              <div style="font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
                                <span style="display:inline-flex; align-items:center;">${Icons.monitor(14)}</span> ${this.escapeHtml(w.machine_name || w.worker_id)}
                              </div>
                              <span class="status-indicator" style="font-size: 11px;">
                                <span class="status-dot ${isOnline ? 'active' : ''}" style="${!isOnline ? 'background:#ef4444;' : ''}"></span>
                                ${isOnline ? 'Online' : 'Offline'}
                              </span>
                            </div>

                            <div style="font-size: 12px; color: var(--color-mid-gray); line-height: 1.7; margin-bottom: 8px;">
                              <div>Linked Account: <strong style="color: var(--color-ink);">${this.escapeHtml(w.user_name || 'Founder')}</strong> <code style="font-size: 11px;">(${this.escapeHtml(w.user_email || 'Zero7 Team')})</code></div>
                              <div>OS Platform: <code>${this.escapeHtml(w.os_info || 'Windows')}</code></div>
                              ${w.install_path ? `<div style="font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${this.escapeHtml(w.install_path)}">📁 Installed: <code style="font-size: 10.5px;">${this.escapeHtml(w.install_path)}</code></div>` : ''}
                              ${w.projects_root ? `<div style="font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${this.escapeHtml(w.projects_root)}">📂 Vault Root: <code style="font-size: 10.5px;">${this.escapeHtml(w.projects_root)}</code></div>` : ''}
                              <div>Antigravity Engine: <strong style="color: ${isOnline ? '#10b981' : 'var(--color-mid-gray)'};">${isOnline ? `Connected (${lsAddr}, PID ${pid})` : 'Offline'}</strong></div>
                              <div>Local Projects: <strong style="color: var(--color-ink);">${jobsCount} projects indexed</strong></div>
                              <div>Last Heartbeat: <strong style="color: var(--color-ink);">${w.diff_seconds !== null ? (w.diff_seconds < 15 ? 'Just now (live)' : `${w.diff_seconds}s ago`) : 'Unknown'}</strong></div>
                            </div>
                          </div>

                          <div style="border-top: 1px solid var(--color-hairline); padding-top: 8px; margin-top: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--color-mid-gray);">
                            <span>ID: <code>${this.escapeHtml(w.worker_id)}</code></span>
                            <div style="display: flex; align-items: center; gap: 8px;">
                              <span class="badge ${isOnline ? 'badge-active' : 'badge-neutral'}" style="font-size: 10px;">${isOnline ? 'Ready for Agent Jobs' : 'Disconnected'}</span>
                              ${!isOnline ? `
                                <button class="btn btn-ghost btn-xs" style="color: #ef4444; padding: 1px 6px; font-size: 10.5px;" onclick="App.deleteWorker('${this.escapeHtml(w.worker_id)}')" title="Remove this stale workstation connector">
                                  Remove
                                </button>
                              ` : ''}
                            </div>
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                ` : `
                  <div style="background: var(--color-surface-alt); border: 1px dashed var(--color-hairline); border-radius: var(--radius-sm); padding: 24px; text-align: center; color: var(--color-mid-gray); font-size: 13px;">
                    <div style="font-size: 24px; margin-bottom: 6px; display:inline-flex; align-items:center; justify-content:center; color: var(--color-mid-gray);">${Icons.monitor(24)}</div>
                    <div style="font-weight: 500; color: var(--color-ink); margin-bottom: 4px;">No desktop workstations currently connected</div>
                    <div>Download the Zero7 Agent Bridge below and run it on your Windows machine to enable local Antigravity AI execution and GitHub sync.</div>
                  </div>
                `}
              </div>

              <!-- Download & 1-Click Setup Box -->
              <div style="background: hsl(var(--card) / 0.5); border: 1px solid var(--color-hairline); border-radius: var(--radius-sm); padding: 16px; margin-top: 14px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
                  <div style="flex: 1; min-width: 280px;">
                    <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                      <span style="display:inline-flex; align-items:center;">${Icons.download(15)}</span> Download &amp; Install Desktop Connector
                    </div>
                    <p style="font-size: 12.5px; color: var(--color-mid-gray); line-height: 1.5;">
                      Extract the package on your PC and run <code>run_worker.bat</code> or <code>install_desktop_app.py</code>. It creates desktop and system tray shortcuts and automatically launches on Windows startup.
                    </p>
                  </div>
                  <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <a href="/api/agent/connector/download?token=${encodeURIComponent(localStorage.getItem('zero7_token') || '')}" download="zero7-agent-bridge-installer.zip" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none; padding: 8px 16px; font-weight: 500;">
                      ${Icons.download(14)} Download Windows Bridge (.zip)
                    </a>
                    <button class="btn btn-secondary" onclick="App.copyText('powershell -ExecutionPolicy Bypass -Command \\\"Invoke-WebRequest -Uri \\\'https://cos.zero7.space/api/agent/connector/download\\\' -OutFile \\\'$env:USERPROFILE\\\\Desktop\\\\zero7-bridge.zip\\\'\\\"')" title="Copy 1-line PowerShell installer">
                      ${Icons.copy(13)} Copy PowerShell Command
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Lead Scraping Ingestion Card -->
          <div class="integration-card">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <h3 style="font-size: 16px; font-weight: 600;">B2B Lead Scraping</h3>
                <span class="status-indicator">
                  <span class="status-dot active"></span> Ready
                </span>
              </div>
              <p style="font-size: 13px; color: var(--color-mid-gray); margin-bottom: 16px;">
                Bulk ingestion pipeline for external lead scraping datasets (Google Maps, Apollo, LinkedIn, directories).
              </p>

              <div style="background: var(--color-surface-alt); padding: 12px; border-radius: var(--radius-sm); font-size: 12px; margin-bottom: 16px; border: 1px solid var(--color-hairline);">
                <div style="color: var(--color-mid-gray); margin-bottom: 4px;">REST API Import Endpoint:</div>
                <div><code>POST /api/leads/import-csv</code></div>
                <div style="color: var(--color-mid-gray); margin-top: 8px; margin-bottom: 4px;">Supported:</div>
                <div><strong>JSON Payload &amp; CSV format</strong></div>
              </div>

              <div style="font-size: 12.5px; color: var(--color-mid-gray); margin-bottom: 16px;">
                Scraped Leads Ingested: <strong>${int.scraping?.leads_ingested || 0}</strong>
              </div>
            </div>

            <div>
              <button class="btn btn-secondary" style="width: 100%; justify-content: center;" onclick="App.openBulkImportModal()">
                ${Icons.plus(14)} Bulk Import Scraped Leads
              </button>
            </div>
          </div>

          <!-- Meta Ads Lead Webhook Card -->
          <div class="integration-card">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <h3 style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                  <span style="display:inline-flex; align-items:center;">${Icons.megaphone(15)}</span> Meta Ads Lead Ingestion
                </h3>
                <span class="status-indicator">
                  <span class="status-dot active"></span> Active
                </span>
              </div>
              <p style="font-size: 13px; color: var(--color-mid-gray); margin-bottom: 16px;">
                Real-time webhook receiving Instant Forms and Lead Ads directly from Facebook &amp; Instagram campaigns.
              </p>

              <div style="background: var(--color-surface-alt); padding: 12px; border-radius: var(--radius-sm); font-size: 12px; margin-bottom: 16px; border: 1px solid var(--color-hairline); font-family: ui-monospace, SFMono-Regular, monospace;">
                <div style="color: var(--color-mid-gray); margin-bottom: 4px; font-family: var(--font-sans);">Webhook Endpoint:</div>
                <div style="color: var(--color-primary); word-break: break-all;">https://cos.zero7.space/api/webhooks/meta-leads</div>
                <div style="color: var(--color-mid-gray); margin-top: 8px; margin-bottom: 4px; font-family: var(--font-sans);">Verify Secret:</div>
                <div style="color: var(--color-ink);">zero7_meta_lead_ads_secret</div>
              </div>
            </div>

            <div>
              <button class="btn btn-primary" style="width: 100%; justify-content: center; display: inline-flex; align-items: center; gap: 5px;" onclick="App.triggerWebhookTest()">
                ${Icons.zap(14)} Simulate Inbound Meta Lead
              </button>
            </div>
          </div>

          <!-- Google Drive Call Recordings Card -->
          <div class="integration-card">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <h3 style="font-size: 16px; font-weight: 600;">Google Drive Call Recordings</h3>
                <span class="status-indicator">
                  <span class="status-dot staged"></span> Staged
                </span>
              </div>
              <p style="font-size: 13px; color: var(--color-mid-gray); margin-bottom: 16px;">
                Storage connector to archive audio call recordings directly to Google Drive folders as requested.
              </p>

              <div style="background: var(--color-surface-alt); padding: 12px; border-radius: var(--radius-sm); font-size: 12px; margin-bottom: 16px; border: 1px solid var(--color-hairline);">
                <div style="color: var(--color-mid-gray); margin-bottom: 4px;">Integration Mode:</div>
                <div>Google Service Account OAuth2</div>
                <div style="color: var(--color-mid-gray); margin-top: 8px; margin-bottom: 4px;">Target Vault:</div>
                <div>Dedicated CRM Audio Recordings Folder</div>
              </div>
            </div>

            <div>
              <button class="btn btn-secondary" style="width: 100%; justify-content: center;" disabled>
                Pending Service Account Setup
              </button>
            </div>
          </div>

          <!-- Google Tasks (Mobile Widget) Card -->
          <div class="integration-card">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <h3 style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                  <span style="display:inline-flex; align-items:center; gap:6px;">${Icons.clipboardList(16)} Google Tasks (Mobile Widget)</span>
                </h3>
                <span class="status-indicator">
                  <span class="status-dot ${gtasks.connected ? 'active' : 'staged'}"></span> 
                  ${gtasks.connected ? 'Active' : 'Setup Required'}
                </span>
              </div>
              <p style="font-size: 13px; color: var(--color-mid-gray); margin-bottom: 16px;">
                Direct sync with Google Tasks app &amp; home screen widget. AI-scheduled tasks and deadlines appear instantly on your Android / iOS phone.
              </p>

              ${gtasks.connected ? `
                <div style="background: var(--color-surface-alt); padding: 12px; border-radius: var(--radius-sm); font-size: 12px; margin-bottom: 16px; border: 1px solid var(--color-hairline);">
                  <div style="color: var(--color-mid-gray); margin-bottom: 4px;">Target Task List:</div>
                  <div style="font-weight: 600; color: var(--color-ink); font-size: 13px;">${this.escapeHtml(gtasks.task_list_title || 'Zero7 CRM Leads')}</div>
                  <div style="color: var(--color-mid-gray); margin-top: 8px; margin-bottom: 4px;">Sync Status:</div>
                  <div style="color: #16a34a; font-weight: 500; display:inline-flex; align-items:center; gap:4px;">${Icons.check(12)} Connected &amp; Real-time auto-sync active</div>
                  <div style="font-size: 11px; color: var(--color-mid-gray); margin-top: 6px;">
                    Select <strong>${this.escapeHtml(gtasks.task_list_title || 'Zero7 CRM Leads')}</strong> in your phone's Google Tasks widget.
                  </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <button class="btn btn-primary" style="width: 100%; justify-content: center; display: inline-flex; align-items: center; gap: 5px;" onclick="App.syncAllToGoogleTasks()">
                    ${Icons.refresh(14)} Sync All Leads to Phone Widget
                  </button>
                  <button class="btn btn-secondary" style="width: 100%; justify-content: center; font-size: 12px;" onclick="App.disconnectGoogleTasks()">
                    Disconnect Google Tasks
                  </button>
                </div>
              ` : `
                <div style="background: var(--color-surface-alt); padding: 12px; border-radius: var(--radius-sm); font-size: 12px; margin-bottom: 14px; border: 1px solid var(--color-hairline);">
                  <div style="font-weight: 500; margin-bottom: 8px;">OAuth 2.0 Credentials (Google Cloud Console):</div>
                  <div class="form-group" style="margin-bottom: 8px;">
                    <label style="font-size: 11px; margin-bottom: 3px;">Client ID</label>
                    <input type="text" id="gtasks-client-id" class="input" style="height: 32px; font-size: 12px; border-radius: 6px;" placeholder="xxxx.apps.googleusercontent.com" value="${this.escapeHtml(gtasks.client_id || '')}">
                  </div>
                  <div class="form-group" style="margin-bottom: 4px;">
                    <label style="font-size: 11px; margin-bottom: 3px;">Client Secret</label>
                    <input type="password" id="gtasks-client-secret" class="input" style="height: 32px; font-size: 12px; border-radius: 6px;" placeholder="GOCSPX-xxxx">
                  </div>
                  <div style="font-size: 10.5px; color: var(--color-mid-gray); margin-top: 6px;">
                    Redirect URI: <code>https://cos.zero7.space/api/integrations/google-tasks/callback</code>
                  </div>
                </div>

                <div>
                  <button class="btn btn-primary" style="width: 100%; justify-content: center; display: inline-flex; align-items: center; gap: 5px;" onclick="App.connectGoogleTasks()">
                    ${Icons.link(14)} Connect Google Tasks
                  </button>
                </div>
              `}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  openBulkImportModal() {
    const html = `
      <div class="modal-header">
        <h3 style="font-size: 16px; font-weight: 600;">Bulk Import Scraped Leads</h3>
        <button class="modal-close" onclick="App.closeModal()" title="Close">${Icons.close(16)}</button>
      </div>
      <form onsubmit="App.handleBulkImport(event)">
        <div class="modal-body">
          <p style="font-size: 13px; color: var(--color-mid-gray); margin-bottom: 12px;">
            Paste your JSON array of scraped leads. Each lead can contain <code>name</code>, <code>business_name</code>, <code>phone</code>, <code>email</code>, <code>city</code>.
          </p>
          <div class="form-group">
            <textarea id="import-leads-json" class="input" rows="8" required placeholder='[
  { "name": "Rajesh Varma", "business_name": "Varma Textiles", "phone": "+91 9823456789", "city": "Surat" },
  { "name": "Anita Desai", "business_name": "Desai Media", "phone": "+91 9912345678", "city": "Bengaluru" }
]'></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Import Leads</button>
        </div>
      </form>
    `;
    this.openModal(html, { size: 'md' });
  },

  async handleBulkImport(e) {
    e.preventDefault();
    const raw = document.getElementById('import-leads-json').value.trim();
    try {
      const parsed = JSON.parse(raw);
      const leads = Array.isArray(parsed) ? parsed : [parsed];
      const res = await API.post('/api/leads/import-csv', { leads });
      API.showToast(`Imported ${res.imported} leads successfully!`, 'success');
      this.closeModal();
      await this.loadInitialData();
      this.setView('leads');
    } catch (err) {
      API.showToast('Invalid JSON format: ' + err.message, 'error');
    }
  },

  copyText(text) {
    navigator.clipboard.writeText(text);
    API.showToast('Copied to clipboard!', 'info');
  },

  // ---------------- GOOGLE TASKS INTEGRATION METHODS ----------------
  async connectGoogleTasks() {
    const clientId = document.getElementById('gtasks-client-id')?.value?.trim();
    const clientSecret = document.getElementById('gtasks-client-secret')?.value?.trim();

    if (!clientId) {
      API.showToast('Please enter your Google OAuth Client ID', 'error');
      return;
    }

    try {
      API.showToast('Initiating Google authorization...', 'info');
      const res = await API.get(`/api/integrations/google-tasks/auth-url?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret || '')}`);
      if (res.auth_url) {
        window.location.href = res.auth_url;
      }
    } catch (e) {
      API.showToast(e.message || 'Error initiating Google Tasks authorization', 'error');
    }
  },

  async syncAllToGoogleTasks() {
    try {
      API.showToast('Syncing all lead tasks to Google Tasks...', 'info');
      const res = await API.post('/api/integrations/google-tasks/sync-all', {});
      API.showToast(res.message || 'Synced to Google Tasks!', 'success');
      await this.loadInitialData();
    } catch (e) {
      API.showToast(e.message || 'Failed to sync to Google Tasks', 'error');
    }
  },

  async disconnectGoogleTasks() {
    if (!confirm('Are you sure you want to disconnect Google Tasks? Tasks already on your phone will remain.')) return;
    try {
      await API.post('/api/integrations/google-tasks/disconnect', {});
      API.showToast('Google Tasks disconnected', 'info');
      await this.renderIntegrationsPage();
    } catch (e) {
      API.showToast(e.message || 'Failed to disconnect', 'error');
    }
  },

  async syncLeadGoogleTask(leadId) {
    try {
      const res = await API.post(`/api/leads/${leadId}/sync-google-task`, {});
      API.showToast(res.message || 'Synced to Google Tasks!', 'success');
    } catch (e) {
      API.showToast(e.message || 'Failed to sync to Google Tasks', 'error');
    }
  },

  async deleteWorker(workerId) {
    if (!confirm(`Are you sure you want to remove disconnected workstation '${workerId}'?`)) return;
    try {
      await API.delete(`/api/agent/workers/${encodeURIComponent(workerId)}`);
      API.showToast('Workstation connector removed', 'success');
      await this.renderIntegrationsPage();
    } catch (e) {
      API.showToast(e.message || 'Failed to remove workstation', 'error');
    }
  },

  async pruneWorkers() {
    try {
      const res = await API.post('/api/agent/workers/prune', {});
      const count = res?.pruned_count ?? 0;
      API.showToast(`Cleaned up ${count} stale or duplicate workstation${count === 1 ? '' : 's'}`, 'success');
      await this.renderIntegrationsPage();
    } catch (e) {
      API.showToast(e.message || 'Failed to prune workstations', 'error');
    }
  },

  // ─── WhatsApp Multi-Account Admin Methods ──────────────────

  async openWhatsAppQRModal(accountId) {
    if (this._waPollInterval) {
      clearInterval(this._waPollInterval);
      this._waPollInterval = null;
    }

    const accLabel = accountId === 'personal' ? 'Abhijeet Personal (+91 9993202900)' : 'Zero7 Central';
    const html = `
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          ${Icons.whatsapp(18)} Link WhatsApp — ${accLabel}
        </h3>
        <button class="btn-icon" onclick="App.closeWhatsAppQRModal()">${Icons.close(18)}</button>
      </div>
      <div class="modal-body" style="padding: 20px 24px; text-align: center;">
        <div id="wa-qr-status-box" style="margin-bottom: 16px;">
          <div id="wa-qr-loading" style="padding: 36px 16px; color: var(--color-mid-gray); font-size: 13px;">
            <div style="font-size: 28px; margin-bottom: 8px; display:inline-flex; align-items:center; justify-content:center; color: var(--color-mid-gray);">${Icons.loader(28)}</div>
            Connecting to droplet daemon &amp; preparing live QR...
          </div>
          <div id="wa-qr-img-wrap" style="display: none;">
            <div style="background: #ffffff; padding: 14px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 14px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
              <img id="wa-qr-img" src="" alt="WhatsApp QR Code" style="width: 240px; height: 240px; display: block; border-radius: 6px;" />
            </div>
            <div style="margin-top: 10px; font-size: 12px; color: #16a34a; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span class="status-dot active"></span> Live QR Active • Point your WhatsApp camera
            </div>
          </div>
        </div>

        <div style="background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: var(--radius-sm); padding: 14px; text-align: left; font-size: 12.5px; line-height: 1.5; color: var(--color-mid-gray); margin-bottom: 16px;">
          <div style="font-weight: 600; color: var(--color-ink); margin-bottom: 6px;">How to link:</div>
          <ol style="margin: 0; padding-left: 18px;">
            <li>Open WhatsApp on the device for <strong>${accLabel}</strong></li>
            <li>Tap <strong>Settings</strong> (iPhone) or <strong>⋮ (Three dots)</strong> (Android) &gt; <strong>Linked Devices</strong></li>
            <li>Tap <strong>Link a Device</strong> and scan the QR code above</li>
          </ol>
          <div style="margin-top: 8px; font-size: 11.5px; color: #64748b;">
            <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.lock(12)} Tokens are saved directly to droplet storage (<code>auth_${accountId}/</code>). Completely isolated.</span>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.refreshWhatsAppQR('${accountId}')">
            ${Icons.refresh(12)} Refresh QR
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.closeWhatsAppQRModal()">
            Done / Close
          </button>
        </div>
      </div>
    `;
    this.openModal(html);

    // Initial QR fetch
    await this.fetchAndRenderQR(accountId);

    // Poll status every 2.5s while modal is open
    this._waPollInterval = setInterval(async () => {
      await this.checkWAStatusInModal(accountId);
    }, 2500);
  },

  async fetchAndRenderQR(accountId) {
    try {
      const res = await API.get(`/api/admin/whatsapp/qr/${accountId}`);
      if (res.status === 'connected') {
        this.showWAConnectedSuccess(res.phone || accountId);
        return;
      }
      if (res.hasQr && res.qrDataUrl) {
        const loading = document.getElementById('wa-qr-loading');
        const imgWrap = document.getElementById('wa-qr-img-wrap');
        const img = document.getElementById('wa-qr-img');
        if (img && imgWrap && loading) {
          img.src = res.qrDataUrl;
          loading.style.display = 'none';
          imgWrap.style.display = 'block';
        }
      } else {
        // Not connected and no active QR yet: request reconnect on server to generate fresh QR
        const loading = document.getElementById('wa-qr-loading');
        if (loading) {
          loading.innerHTML = `<div style="font-size: 28px; margin-bottom: 8px; display:inline-flex; align-items:center; justify-content:center; color: var(--color-mid-gray);">${Icons.loader(28)}</div>Preparing live QR pairing on droplet...`;
        }
        await API.post(`/api/admin/whatsapp/reconnect/${accountId}`).catch(() => {});
        setTimeout(() => this.fetchAndRenderQR(accountId), 1500);
      }
    } catch (e) {
      console.warn('QR fetch error:', e);
      const loading = document.getElementById('wa-qr-loading');
      if (loading) {
        loading.innerHTML = `<div style="color: #ef4444; padding: 20px;">Failed to fetch QR: ${this.escapeHtml(e.message || 'Daemon offline')}.<br><button class="btn btn-secondary btn-sm" style="margin-top:10px;" onclick="App.fetchAndRenderQR('${accountId}')">Retry</button></div>`;
      }
    }
  },

  async checkWAStatusInModal(accountId) {
    try {
      const qrRes = await API.get(`/api/admin/whatsapp/qr/${accountId}`);
      if (qrRes.status === 'connected') {
        if (this._waPollInterval) {
          clearInterval(this._waPollInterval);
          this._waPollInterval = null;
        }
        this.showWAConnectedSuccess(qrRes.phone || accountId);
        return;
      }
      if (qrRes.hasQr && qrRes.qrDataUrl) {
        const img = document.getElementById('wa-qr-img');
        const imgWrap = document.getElementById('wa-qr-img-wrap');
        const loading = document.getElementById('wa-qr-loading');
        if (img && imgWrap && loading) {
          if (img.src !== qrRes.qrDataUrl) {
            img.src = qrRes.qrDataUrl;
          }
          loading.style.display = 'none';
          imgWrap.style.display = 'block';
        }
      }
    } catch (e) {
      // transient network poll
    }
  },

  showWAConnectedSuccess(phoneOrLabel) {
    const box = document.getElementById('wa-qr-status-box');
    if (box) {
      box.innerHTML = `
        <div style="padding: 24px 10px; text-align: center;">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: #dcfce7; color: #16a34a; font-size: 28px; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto;">
            ${Icons.check(28)}
          </div>
          <h3 style="font-size: 17px; font-weight: 600; color: #16a34a; margin-bottom: 6px;">WhatsApp Connected!</h3>
          <p style="font-size: 13px; color: var(--color-mid-gray); margin: 0;">
            Successfully authenticated as <strong>+91 ${this.escapeHtml(phoneOrLabel)}</strong>. Token saved on droplet.
          </p>
        </div>
      `;
    }
    API.showToast(`Connected to WhatsApp (+91 ${phoneOrLabel})!`, 'success');
    setTimeout(() => {
      this.closeWhatsAppQRModal();
      if (this.state.currentView === 'integrations') {
        this.renderIntegrationsPage();
      }
    }, 2000);
  },

  closeWhatsAppQRModal() {
    if (this._waPollInterval) {
      clearInterval(this._waPollInterval);
      this._waPollInterval = null;
    }
    this.closeModal();
  },

  async refreshWhatsAppQR(accountId) {
    API.showToast('Requesting fresh QR from daemon...', 'info');
    const loading = document.getElementById('wa-qr-loading');
    const imgWrap = document.getElementById('wa-qr-img-wrap');
    if (loading && imgWrap) {
      loading.style.display = 'block';
      loading.innerHTML = '<div style="font-size: 28px; margin-bottom: 8px; display:inline-flex; align-items:center; justify-content:center; color: var(--color-mid-gray);">${Icons.loader(28)}</div>Generating fresh QR code...';
      imgWrap.style.display = 'none';
    }
    try {
      await API.post(`/api/admin/whatsapp/reconnect/${accountId}`, {});
      setTimeout(() => this.fetchAndRenderQR(accountId), 1500);
    } catch (e) {
      API.showToast('Failed to refresh QR: ' + (e.message || ''), 'error');
    }
  },

  async disconnectWhatsAppAccount(accountId) {
    const accLabel = accountId === 'personal' ? 'Abhijeet Personal (+91 9993202900)' : 'Zero7 Central';
    if (!confirm(`Are you sure you want to disconnect ${accLabel}?\n\nThe companion token on droplet will be wiped and a fresh QR code will be generated.`)) {
      return;
    }
    try {
      API.showToast(`Disconnecting ${accLabel}...`, 'info');
      await API.post(`/api/admin/whatsapp/disconnect/${accountId}`, {});
      API.showToast(`Session reset for ${accLabel}. You can scan again anytime.`, 'success');
      await this.renderIntegrationsPage();
    } catch (e) {
      API.showToast('Failed to disconnect: ' + (e.message || ''), 'error');
    }
  },

  // ---------------- 5. TEAM & EXECUTIONERS (RBAC) ----------------

  renderTeamPage() {
    const container = document.getElementById('page-content');
    if (!container) return;

    const isAdmin = this.state.currentUser?.role === 'admin';
    const users = this.state.users || [];
    const totalMembers = users.length;
    const adminsCount = users.filter(u => u.role === 'admin').length;
    const closersCount = users.filter(u => u.role === 'member').length;
    const totalPipeline = this.state.deals.reduce((sum, d) => sum + (d.value || 0), 0);

    container.innerHTML = `
      <div style="max-width: 1100px; margin: 0 auto; padding: 24px 16px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
          <div>
            <h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.5px;">Team & Executioners</h1>
            <p style="font-size: 13.5px; color: var(--color-mid-gray); margin-top: 4px;">
              Manage team members, configure Role-Based Access Control (RBAC), and monitor consultant workloads.
            </p>
          </div>
          ${isAdmin ? `
            <button class="btn btn-primary" onclick="App.openAddMemberModal()">
              ${Icons.plus(15)} Add Team Member
            </button>
          ` : ''}
        </div>

        <!-- Metric Summary Cards -->
        <div class="stat-row">
          <div class="stat-card">
            <div class="stat-label">Total Executioners</div>
            <div class="stat-value">${totalMembers}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Administrators</div>
            <div class="stat-value">${adminsCount}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Consultants / Closers</div>
            <div class="stat-value">${closersCount}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active Team Pipeline</div>
            <div class="stat-value">${this.formatCurrency(totalPipeline)}</div>
          </div>
        </div>

        <!-- Team Table -->
        <div class="table-container" style="margin-top: 24px;">
          <table class="table">
            <thead>
              <tr>
                <th>Consultant / Person</th>
                <th>System Role & Permissions</th>
                <th>Assigned Leads</th>
                <th>Active Deals</th>
                <th>Managed Pipeline Value</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => {
                const initials = (u.name || 'User').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                const isSelf = this.state.currentUser?.id === u.id;
                return `
                  <tr>
                    <td>
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="user-avatar">${initials}</div>
                        <div>
                          <div style="font-weight: 600; color: var(--color-ink);">${this.escapeHtml(u.name)} ${isSelf ? '<span style="font-size: 11px; color: var(--color-mid-gray); font-weight: 400;">(You)</span>' : ''}</div>
                          <div style="font-size: 12px; color: var(--color-mid-gray);">${this.escapeHtml(u.email)}</div>
                          ${u.phone ? `
                            <div class="team-phone-badge has-phone" title="Configured for call recordings & internal discussions">
                              ${Icons.phone(11)} ${this.escapeHtml(u.phone)}
                            </div>
                          ` : `
                            <div class="team-phone-badge" style="cursor: pointer;" onclick="App.openEditUserModal('${u.id}')" title="Click to attach phone number">
                              ${Icons.phone(11)} No phone attached
                            </div>
                          `}
                        </div>
                      </div>
                    </td>
                    <td>
                      ${isAdmin && !isSelf ? `
                        <select class="select" style="width: 150px; height: 32px; font-size: 12px;" onchange="App.handleUpdateUserRole('${u.id}', this.value)">
                          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option>
                          <option value="member" ${u.role === 'member' ? 'selected' : ''}>Consultant / Closer</option>
                        </select>
                      ` : `
                        <span class="role-badge ${u.role}">${u.role === 'admin' ? 'Administrator' : 'Consultant / Closer'}</span>
                      `}
                    </td>
                    <td>
                      <span class="workload-metric" style="cursor: pointer;" onclick="App.filterLeadsByRep('${u.id}')" title="Click to view leads for ${this.escapeHtml(u.name)}">
                        <strong>${u.assigned_leads_count || 0}</strong> leads &rarr;
                      </span>
                    </td>
                    <td>
                      <span class="workload-metric">
                        <strong>${u.assigned_deals_count || 0}</strong> deals
                      </span>
                    </td>
                    <td>
                      <span style="font-weight: 600; color: var(--color-ink);">${this.formatCurrency((u.pipeline_value || 0))}</span>
                    </td>
                    <td style="text-align: right;">
                      <div style="display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end;">
                        <button class="btn btn-secondary btn-sm" onclick="App.openInternalDiscussionsModal('${u.id}')" title="View recorded internal team discussions, audio & transcripts">
                          ${Icons.mic(12)} Discussions
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="App.openChangePasswordModal('${u.id}')" title="Change or Reset Login Password" style="color: #2563eb;">
                          ${Icons.key(12)} Password
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="App.openEditUserModal('${u.id}')" title="Edit name, phone, email, role, or password">
                          ${Icons.edit(12)} Edit
                        </button>
                        ${isAdmin && !isSelf ? `
                          <button class="btn btn-secondary btn-sm" style="color: var(--color-error);" onclick="App.handleDeleteUser('${u.id}', '${this.escapeHtml(u.name)}')">
                            ${Icons.trash(12)} Remove
                          </button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // ==================== GROK BOT AGENT STUDIO & MISSION CONTROL ====================

  _grokActiveAgentSlug: 'prototype_maker',
  _grokActiveRunId: null,
  _grokRuns: [],
  _grokInspectorOpen: false,
  _grokRunsDrawerOpen: false,
  _grokSelectedLeadId: null,
  _cachedAgentDefinitions: [],
  _cachedSkills: [],
  _cachedMcpServers: [],

  openAgentCatalog() {
    this._grokActiveRunId = null;
    this._grokRunsDrawerOpen = false;
    this.renderAgentStudioPage();
  },

  openAgentDetail(slug) {
    if (slug) this._grokActiveAgentSlug = slug;
    this._grokActiveRunId = null;
    this._grokRunsDrawerOpen = false;
    const targetHash = `#/agents/${this._grokActiveAgentSlug}`;
    if (window.location.hash !== targetHash) {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', targetHash);
      } else {
        window.location.hash = targetHash;
      }
    }
    this.renderAgentStudioPage();
  },

  selectGrokAgent(slug) {
    this._grokActiveAgentSlug = slug;
    // Find the latest run for this agent if available
    const runsList = Array.isArray(this._grokRuns) ? this._grokRuns : [];
    const agentRuns = runsList.filter(r => (r.agent_slug || 'prototype_maker') === slug);
    this._grokActiveRunId = agentRuns.length > 0 ? agentRuns[0].id : null;
    this._grokRunsDrawerOpen = false;

    const targetHash = `#/agents/${slug}`;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', targetHash);
    }

    const container = document.getElementById('page-content');
    if (container) {
      this.renderGrokBotInterface(container);
    }
  },

  toggleGrokRunsDrawer() {
    this._grokRunsDrawerOpen = !this._grokRunsDrawerOpen;
    const drawer = document.getElementById('grok-runs-drawer');
    if (drawer) {
      drawer.classList.toggle('open', this._grokRunsDrawerOpen);
    }
  },

  selectGrokRun(runId) {
    this._grokActiveRunId = runId;
    this._grokRunsDrawerOpen = false;
    const drawer = document.getElementById('grok-runs-drawer');
    if (drawer) drawer.classList.remove('open');

    // Update lead context for the selected run
    const runsList = Array.isArray(this._grokRuns) ? this._grokRuns : [];
    const run = runsList.find(r => r.id === runId);
    if (run && run.lead_id) {
      this._grokSelectedLeadId = run.lead_id;
    }

    // Chat is cumulative — just close the drawer
    this.renderGrokTranscriptContent();
  },

  newGrokRun() {
    this._grokActiveRunId = null;
    this._grokRunsDrawerOpen = false;
    const drawer = document.getElementById('grok-runs-drawer');
    if (drawer) drawer.classList.remove('open');

    this.renderGrokTranscriptContent();
    const input = document.getElementById('grok-prompt-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  },

  toggleGrokInspector() {
    this._grokInspectorOpen = !this._grokInspectorOpen;
    const inspector = document.getElementById('grok-inspector-drawer');
    const toggleBtn = document.getElementById('grok-inspector-toggle-btn');
    if (inspector) {
      inspector.classList.toggle('open', this._grokInspectorOpen);
    }
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', this._grokInspectorOpen);
    }
  },

  toggleGrokInspectorExpand() {
    const current = this._grokInspectorWidth || 360;
    this._grokInspectorWidth = current >= 520 ? 360 : 580;
    localStorage.setItem('grok_inspector_width', String(this._grokInspectorWidth));
    const inspEl = document.getElementById('grok-inspector-drawer');
    if (inspEl) inspEl.style.width = `${this._grokInspectorWidth}px`;
  },

  initGrokResize(e, type) {
    e.preventDefault();
    const startX = e.clientX;
    const initialWidth = type === 'sidebar' ? (this._grokSidebarWidth || 240) : (this._grokInspectorWidth || 360);
    const resizer = e.target;
    resizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent) => {
      if (type === 'sidebar') {
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.min(Math.max(180, initialWidth + delta), 460);
        this._grokSidebarWidth = newWidth;
        const sidebarEl = document.querySelector('.baby-grok-bot-sidebar');
        if (sidebarEl) sidebarEl.style.width = `${newWidth}px`;
      } else if (type === 'inspector') {
        const delta = startX - moveEvent.clientX;
        const newWidth = Math.min(Math.max(300, initialWidth + delta), 750);
        this._grokInspectorWidth = newWidth;
        const inspEl = document.getElementById('grok-inspector-drawer');
        if (inspEl) inspEl.style.width = `${newWidth}px`;
      }
    };

    const onMouseUp = () => {
      resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (type === 'sidebar') {
        localStorage.setItem('grok_sidebar_width', String(this._grokSidebarWidth));
      } else {
        localStorage.setItem('grok_inspector_width', String(this._grokInspectorWidth));
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  },

  openPromptEditorModal() {
    const promptEl = document.getElementById('grok-inspector-prompt');
    const currentText = promptEl ? promptEl.value : '';
    const activeSlug = this._grokActiveAgentSlug || 'prototype_maker';
    const activeAgent = (this._cachedAgentDefinitions || []).find(a => a.slug === activeSlug) || {};

    const modalHtml = `
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display:inline-flex; align-items:center;">${Icons.settings(15)}</span>
          <h3 style="margin: 0; font-size: 15px; font-weight: 600;">System Instructions: ${this.escapeHtml(activeAgent.name || 'Agent')}</h3>
        </div>
        <button class="modal-close" onclick="App.closeModal()">${Icons.close(16)}</button>
      </div>
      <div class="modal-body" style="padding: 16px;">
        <textarea id="modal-expanded-prompt" class="baby-grok-prompt-textarea" style="height: 380px; font-size: 13px; line-height: 1.6;">${this.escapeHtml(currentText)}</textarea>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 12px; color: hsl(var(--muted-foreground));">Tip: Reference dynamic context pills like @lead.profile and @transcripts.all</span>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary btn-sm" onclick="App.closeModal()">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="
            const val = document.getElementById('modal-expanded-prompt').value;
            const target = document.getElementById('grok-inspector-prompt');
            if (target) target.value = val;
            App.closeModal();
            API.showToast('Prompt updated in configuration', 'success');
          ">Apply Changes</button>
        </div>
      </div>
    `;
    this.openModal(modalHtml, { size: 'lg' });
  },

  openCreateDataPillModal() {
    const modalHtml = `
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 15px; color: #8b5cf6;">@</span>
          <h3 style="margin: 0; font-size: 15px; font-weight: 600;">Create Custom Data Pill</h3>
        </div>
        <button class="modal-close" onclick="App.closeModal()">${Icons.close(16)}</button>
      </div>
      <div class="modal-body" style="display: flex; flex-direction: column; gap: 12px; padding: 18px 22px;">
        <div class="form-group">
          <label>Pill Mention Tag (starts with @):</label>
          <input type="text" id="new-pill-tag" class="input" placeholder="@financials.summary" value="@custom." style="width: 100%; font-family: var(--font-mono); font-size: 12.5px; height: 34px;" />
        </div>
        <div class="form-group">
          <label>Display Label:</label>
          <input type="text" id="new-pill-label" class="input" placeholder="e.g. Financial Overview & Balance" style="width: 100%; font-size: 12.5px; height: 34px;" />
        </div>
        <div class="form-group">
          <label>Category:</label>
          <input type="text" id="new-pill-category" class="input" placeholder="e.g. Financials, Operations, Legal" value="Client Vault" style="width: 100%; font-size: 12.5px; height: 34px;" />
        </div>
        <div class="form-group">
          <label>Description (Shows in autocomplete):</label>
          <input type="text" id="new-pill-desc" class="input" placeholder="Extracts P&L, balance statements, and revenue metrics" style="width: 100%; font-size: 12px; height: 34px;" />
        </div>
        <div class="form-group">
          <label>Source / Resolver Instructions:</label>
          <textarea id="new-pill-payload" class="baby-grok-prompt-textarea" style="height: 80px;" placeholder="Prompt context or query instructions on how to resolve this pill..."></textarea>
        </div>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-secondary btn-sm" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="App.submitCreateDataPill()">Create Pill</button>
      </div>
    `;
    this.openModal(modalHtml, { size: 'md' });
    setTimeout(() => document.getElementById('new-pill-tag')?.focus(), 50);
  },

  async submitCreateDataPill() {
    const tag = document.getElementById('new-pill-tag')?.value.trim();
    const label = document.getElementById('new-pill-label')?.value.trim();
    const category = document.getElementById('new-pill-category')?.value.trim() || 'Client Vault';
    const desc = document.getElementById('new-pill-desc')?.value.trim();
    const payload = document.getElementById('new-pill-payload')?.value.trim();

    if (!tag || !label) {
      API.showToast('Please provide both a tag and label for the pill', 'error');
      return;
    }

    try {
      API.showToast('Creating data pill...', 'info');
      await API.post('/api/data-pills', {
        tag, label, category, description: desc, resolver_payload: payload
      });
      API.showToast(`Data pill ${tag} registered!`, 'success');
      this.closeModal();
      this.renderAgentStudioPage();
    } catch (err) {
      API.showToast('Failed to create pill: ' + err.message, 'error');
    }
  },

  async deleteCustomDataPill(id, e) {
    if (e) e.stopPropagation();
    if (!confirm('Are you sure you want to remove this data pill?')) return;
    try {
      await API.delete(`/api/data-pills/${id}`);
      API.showToast('Data pill removed', 'info');
      this.renderAgentStudioPage();
    } catch (err) {
      API.showToast('Failed to delete data pill: ' + err.message, 'error');
    }
  },

  openCreateSkillModal() {
    const modalHtml = `
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display:inline-flex; align-items:center; color: #f19d38;">${Icons.zap(15)}</span>
          <h3 style="margin: 0; font-size: 15px; font-weight: 600;">Create Custom Agent Skill</h3>
        </div>
        <button class="modal-close" onclick="App.closeModal()">${Icons.close(16)}</button>
      </div>
      <div class="modal-body" style="display: flex; flex-direction: column; gap: 12px; padding: 18px 22px;">
        <div class="form-group">
          <label>Skill Name:</label>
          <input type="text" id="new-skill-name" class="input" placeholder="e.g. PDF Proposal Generator" style="width: 100%; font-size: 12.5px; height: 34px;" oninput="document.getElementById('new-skill-slug').value = this.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')" />
        </div>
        <div class="form-group">
          <label>Skill Slug (Command: /slug):</label>
          <input type="text" id="new-skill-slug" class="input" placeholder="e.g. pdf-proposal-generator" style="width: 100%; font-family: var(--font-mono); font-size: 12.5px; height: 34px;" />
        </div>
        <div class="form-group">
          <label>Description:</label>
          <input type="text" id="new-skill-desc" class="input" placeholder="Compiles PDF proposal and attaches commercial pricing" style="width: 100%; font-size: 12px; height: 34px;" />
        </div>
        <div class="form-group">
          <label>SKILL.md Instructions (Antigravity Spec):</label>
          <textarea id="new-skill-md" class="baby-grok-prompt-textarea" style="height: 120px;" placeholder="# Skill Instructions&#10;Describe step-by-step how the agent executes this tool or script..."></textarea>
        </div>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-secondary btn-sm" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="App.submitCreateSkill()">Register Skill</button>
      </div>
    `;
    this.openModal(modalHtml, { size: 'md' });
    setTimeout(() => document.getElementById('new-skill-name')?.focus(), 50);
  },

  async submitCreateSkill() {
    const name = document.getElementById('new-skill-name')?.value.trim();
    const slug = document.getElementById('new-skill-slug')?.value.trim();
    const desc = document.getElementById('new-skill-desc')?.value.trim();
    const md = document.getElementById('new-skill-md')?.value.trim();

    if (!name || !slug) {
      API.showToast('Please provide both name and slug for the skill', 'error');
      return;
    }

    try {
      API.showToast('Registering skill...', 'info');
      await API.post('/api/skills', {
        name, slug, description: desc, skill_md_content: md
      });
      API.showToast(`Skill /${slug} registered!`, 'success');
      this.closeModal();
      this.renderAgentStudioPage();
    } catch (err) {
      API.showToast('Failed to create skill: ' + err.message, 'error');
    }
  },

  async deleteCustomSkill(slug, e) {
    if (e) e.stopPropagation();
    if (!confirm(`Are you sure you want to delete skill /${slug}?`)) return;
    try {
      await API.delete(`/api/skills/${slug}`);
      API.showToast(`Skill /${slug} removed`, 'info');
      this.renderAgentStudioPage();
    } catch (err) {
      API.showToast('Failed to delete skill: ' + err.message, 'error');
    }
  },

  setGrokComposerPrompt(text) {
    const input = document.getElementById('grok-prompt-input');
    if (input) {
      input.value = text;
      input.focus();
    }
  },

  insertGrokPill(tag) {
    const input = document.getElementById('grok-prompt-input') || document.getElementById('studio-prompt-input');
    if (!input) return;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const val = input.value || '';
    const spacer = (start > 0 && val[start - 1] !== ' ' && val[start - 1] !== '\n') ? ' ' : '';
    const insertion = spacer + tag + ' ';
    input.value = val.substring(0, start) + insertion + val.substring(end);
    input.selectionStart = input.selectionEnd = start + insertion.length;
    input.focus();
  },

  insertDataPill(pillTag, targetInputId = null) {
    this.insertGrokPill(pillTag);
    API.showToast(`Inserted ${pillTag}`, 'info');
  },

  formatGrokPromptHtml(promptText) {
    if (!promptText) return '';
    const escaped = this.escapeHtml(promptText);
    // 1. Highlight /commands ONLY when preceded by whitespace or at start of prompt (prevent matching </span > tags!)
    let html = escaped.replace(/(^|\s)(\/[a-zA-Z0-9_-]+)(?=\s|$)/g, '$1<span class="badge" style="background: rgba(59,130,246,0.18); color: #60a5fa; font-family: monospace; font-size: 11px; padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(59,130,246,0.3); font-weight: 600;">$2</span>');
    // 2. Highlight @file:paths in sleek cyan
    html = html.replace(/(@file:[a-zA-Z0-9_\-./]+)/g, '<span class="baby-grok-pill-file">$1</span>');
    // 3. Highlight other @data.pills in amber
    html = html.replace(/(@[a-zA-Z0-9_.-]+)/g, '<span class="badge" style="background: rgba(241,157,56,0.18); color: #f19d38; font-family: monospace; font-size: 11px; padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(241,157,56,0.3); font-weight: 600;">$1</span>');
    return html;
  },

  async previewGrokPrompt() {
    const input = document.getElementById('grok-prompt-input');
    const promptText = input ? input.value.trim() : '';
    const leadId = this._grokSelectedLeadId;

    if (!leadId) {
      API.showToast('Please select a target client first', 'warning');
      return;
    }
    if (!promptText) {
      API.showToast('Please enter prompt text with @ pills to preview', 'warning');
      return;
    }
    await this.previewLeadPrompt(leadId, promptText);
  },

  async previewStudioPrompt() {
    return this.previewGrokPrompt();
  },

  async previewLeadPrompt(leadId, customPrompt = null) {
    const input = document.getElementById('grok-prompt-input') || document.getElementById('studio-prompt-input');
    const prompt = customPrompt || (input ? input.value.trim() : '');
    if (!prompt) {
      API.showToast('Please type a prompt first', 'warning');
      return;
    }

    try {
      API.showToast('Resolving data pills with client vault...', 'info');
      const res = await API.post(`/api/leads/${leadId}/preview-prompt`, { prompt: prompt });
      const resolved = res.resolved_prompt || prompt;
      const pillsFound = res.pills_found || [];

      const modalHtml = `
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
          <h3 style="font-size: 16px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 8px;">
            <span style="display:inline-flex; align-items:center; gap:6px;">${Icons.eye(15)} Resolved Client Vault Prompt</span>
          </h3>
          <button class="btn-icon" onclick="App.closeModal()">${Icons.close(16)}</button>
        </div>
        <div class="modal-body" style="max-height: 520px; overflow-y: auto;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;">
            <span style="font-size: 11px; font-weight: 700; color: var(--color-ink-muted); text-transform: uppercase;">Data Pills Ingested:</span>
            ${pillsFound.length > 0 ? pillsFound.map(p => `<span class="badge" style="background: rgba(241,157,56,0.18); color: #f19d38; font-family: monospace; font-size: 11px;">${p}</span>`).join('') : '<span style="font-size: 11.5px; color: var(--color-mid-gray);">None (plain text prompt)</span>'}
          </div>
          <div style="background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: 8px; padding: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; color: var(--color-ink);">
${this.escapeHtml(resolved)}
          </div>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: var(--color-mid-gray);">${resolved.length} characters ready for local execution</span>
          <button class="btn btn-secondary btn-sm" onclick="App.closeModal()">Close</button>
        </div>
      `;
      this.openModal(modalHtml);
    } catch (e) {
      API.showToast('Could not resolve prompt preview: ' + e.message, 'error');
    }
  },

  async runGrokAgentTask() {
    const input = document.getElementById('grok-prompt-input');
    const prompt = input ? input.value.trim() : '';
    const leadId = this._grokSelectedLeadId;
    const slug = this._grokActiveAgentSlug || 'prototype_maker';

    if (!leadId) {
      API.showToast('Please select a client from the composer bar', 'warning');
      return;
    }
    if (!prompt) {
      API.showToast('Please enter an instruction or click a shortcut command', 'warning');
      return;
    }

    const agent = (this._cachedAgentDefinitions || []).find(a => a.slug === slug);
    const model = (agent && agent.model) ? agent.model : 'pro';

    try {
      API.showToast(`Starting ${agent ? agent.name : 'Agent'} for client...`, 'info');
      const res = await API.post(`/api/leads/${leadId}/agent/jobs`, {
        prompt: prompt,
        model: model,
        role: 'engineer',
        agent_slug: slug,
        execution_target: 'cloud'
      });

      API.showToast('Task launched! Streaming execution...', 'success');
      
      // Refresh runs list immediately
      const refreshedRuns = await API.get('/api/agent/runs').catch(() => []);
      const unpackedRuns = Array.isArray(refreshedRuns) ? refreshedRuns : (refreshedRuns?.runs || []);
      if (unpackedRuns.length > 0) {
        this._grokRuns = unpackedRuns;
      }

      // If job ID returned, make it the active run & initiate live SSE stream
      if (res && res.job_id) {
        this._grokActiveRunId = res.job_id;
        this.startGrokAgentStreaming(leadId, res.job_id);
      } else if (unpackedRuns.length > 0) {
        this._grokActiveRunId = unpackedRuns[0].id;
      }

      if (input) input.value = '';
      this.renderGrokTranscriptContent();
    } catch (err) {
      API.showToast('Failed to start agent task: ' + err.message, 'error');
    }
  },

  startGrokAgentStreaming(leadId, jobId) {
    if (this._grokEventSource) {
      this._grokEventSource.close();
      this._grokEventSource = null;
    }
    if (this._grokPollingTimer) {
      clearInterval(this._grokPollingTimer);
      this._grokPollingTimer = null;
    }

    if (window.EventSource) {
      try {
        const sseUrl = `/api/agent/jobs/${jobId}/events`;
        const es = new EventSource(sseUrl);
        this._grokEventSource = es;

        es.onmessage = async (e) => {
          try {
            const job = JSON.parse(e.data);
            if (!job) return;

            const run = (this._grokRuns || []).find(r => r.id === jobId);
            if (run) {
              run.stream_output = job.stream_output || run.stream_output;
              run.thoughts = job.thoughts || run.thoughts;
              run.status = job.status || run.status;
              run.artifacts = job.artifacts || run.artifacts;
              this.renderGrokTranscriptContent();
            }

            if (job.status === 'completed' || job.status === 'failed') {
              es.close();
              this._grokEventSource = null;
              const refreshed = await API.get('/api/agent/runs').catch(() => []);
              const list = Array.isArray(refreshed) ? refreshed : (refreshed?.runs || []);
              if (list.length > 0) this._grokRuns = list;
              this.renderGrokTranscriptContent();
              API.showToast(job.status === 'completed' ? 'Agent task finished!' : 'Agent task failed', job.status === 'completed' ? 'success' : 'error');
            }
          } catch (err) {
            console.error('Grok SSE parse error:', err);
          }
        };

        es.onerror = () => {
          es.close();
          this._grokEventSource = null;
          this._grokPollingTimer = setInterval(async () => {
            try {
              const job = await API.get(`/api/agent/jobs/${jobId}`);
              if (!job) return;
              const run = (this._grokRuns || []).find(r => r.id === jobId);
              if (run) {
                run.stream_output = job.stream_output || run.stream_output;
                run.thoughts = job.thoughts || run.thoughts;
                run.status = job.status || run.status;
                run.artifacts = job.artifacts || run.artifacts;
                this.renderGrokTranscriptContent();
              }
              if (job.status === 'completed' || job.status === 'failed') {
                clearInterval(this._grokPollingTimer);
                this._grokPollingTimer = null;
                const refreshed = await API.get('/api/agent/runs').catch(() => []);
                const list = Array.isArray(refreshed) ? refreshed : (refreshed?.runs || []);
                if (list.length > 0) this._grokRuns = list;
                this.renderGrokTranscriptContent();
              }
            } catch (err) {
              clearInterval(this._grokPollingTimer);
              this._grokPollingTimer = null;
            }
          }, 1000);
        };
        return;
      } catch (e) {
        console.warn('Grok EventSource error:', e);
      }
    }
  },

  async saveGrokAgentConfig() {
    const slug = this._grokActiveAgentSlug;
    const current = (this._cachedAgentDefinitions || []).find(a => a.slug === slug) || {};

    const nameEl = document.getElementById('grok-inspector-name');
    const roleEl = document.getElementById('grok-inspector-role');
    const promptEl = document.getElementById('grok-inspector-prompt');
    const modelEl = document.getElementById('grok-inspector-model') || document.querySelector('input[name="grok_model_choice"]:checked');
    const fallbackModelEl = document.getElementById('grok-inspector-fallback-model');
    const autonomyEl = document.querySelector('input[name="grok_autonomy_choice"]:checked');

    // Collect selected data pills
    const pillCheckboxes = document.querySelectorAll('.grok-pill-checkbox:checked');
    const selectedPills = Array.from(pillCheckboxes).map(cb => cb.value);

    // Collect selected skills
    const skillCheckboxes = document.querySelectorAll('.grok-skill-checkbox:checked');
    const selectedSkills = Array.from(skillCheckboxes).map(cb => cb.value);

    const payload = {
      ...current,
      slug: slug,
      name: nameEl ? nameEl.value.trim() : (current.name || slug),
      role: roleEl ? roleEl.value.trim() : (current.role || 'engineer'),
      model: modelEl ? modelEl.value : (current.model || 'pro'),
      fallback_model: fallbackModelEl ? fallbackModelEl.value : (current.fallback_model || 'none'),
      autonomy_level: autonomyEl ? autonomyEl.value : (current.autonomy_level || 'approval_required'),
      system_prompt: promptEl ? promptEl.value.trim() : (current.system_prompt || ''),
      default_pills: selectedPills,
      assigned_skills: selectedSkills
    };

    try {
      API.showToast('Saving agent configuration...', 'info');
      await API.post('/api/agents', payload);
      API.showToast('Agent definition saved successfully!', 'success');
      const agentsRes = await API.get('/api/agents').catch(() => []);
      if (agentsRes && agentsRes.length > 0) {
        this._cachedAgentDefinitions = agentsRes;
      }
      this.renderAgentStudioPage();
    } catch (err) {
      API.showToast('Failed to save agent configuration: ' + err.message, 'error');
    }
  },

  async renderAgentStudioPage() {
    const container = document.getElementById('page-content');
    if (!container) return;
    container.classList.add('page-content-agents');

    if (!this._cachedAgentDefinitions.length) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; font-size: 14px; color: var(--color-mid-gray);">
          <div class="agent-pulse-dot" style="margin: 0 auto 12px; width: 12px; height: 12px;"></div>
          Loading Autonomous Agent Teammates & Runs...
        </div>
      `;
    }

    try {
      const [agentsRes, skillsRes, mcpRes, runsRes, pillsRes] = await Promise.all([
        API.get('/api/agents').catch(() => []),
        API.get('/api/skills').catch(() => []),
        API.get('/api/mcp-servers').catch(() => []),
        API.get('/api/agent/runs').catch(() => []),
        API.get('/api/data-pills').catch(() => [])
      ]);

      this._cachedAgentDefinitions = Array.isArray(agentsRes) ? agentsRes : (agentsRes?.agents || []);
      this._cachedSkills = Array.isArray(skillsRes) ? skillsRes : (skillsRes?.skills || []);
      this._cachedMcpServers = Array.isArray(mcpRes) ? mcpRes : (mcpRes?.servers || []);
      this._grokRuns = Array.isArray(runsRes) ? runsRes : (runsRes?.runs || []);
      this._cachedCustomDataPills = Array.isArray(pillsRes) ? pillsRes : [];

      // Check if URL hash specifies an agent
      const hash = window.location.hash || '';
      const match = hash.match(/#\/agents\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        this._grokActiveAgentSlug = match[1];
      }

      const leads = this.state.leads || [];
      if (!this._grokSelectedLeadId && leads.length > 0) {
        this._grokSelectedLeadId = leads[0].id;
      }

      const runsList = Array.isArray(this._grokRuns) ? this._grokRuns : [];
      if (!this._grokActiveRunId && runsList.length > 0) {
        const matchingRun = runsList.find(r => (r.agent_slug || 'prototype_maker') === this._grokActiveAgentSlug);
        this._grokActiveRunId = matchingRun ? matchingRun.id : runsList[0].id;
      }

      this.renderGrokBotInterface(container);
    } catch (err) {
      console.error('[GROK BOT ERROR]', err);
      container.innerHTML = `<div class="error-banner">Failed to load Agent Studio: ${err.message}</div>`;
    }
  },

  renderGrokBotInterface(container) {
    const agents = this._cachedAgentDefinitions || [];
    const activeSlug = this._grokActiveAgentSlug || 'prototype_maker';
    const activeAgent = agents.find(a => a.slug === activeSlug) || agents[0] || {
      name: 'Prototype Maker',
      slug: 'prototype_maker',
      role: 'Principal Prototype Architect',
      description: 'Generates responsive single-file Tailwind prototypes, provisions live subdomains, and drafts WhatsApp pitches.',
      system_prompt: "You are Zero7's Principal Prototype Architect.",
      model: 'pro',
      autonomy_level: 'approval_required',
      default_pills: ['@lead.profile', '@transcripts.all', '@files.all'],
      assigned_skills: ['subdomain-provisioner', 'web_search']
    };

    const agentMeta = {
      prototype_maker: { icon: Icons.zap(14), coat: '#f19d38', time: '1:52 AM', status: 'Ready to build prototype' },
      sow_architect: { icon: Icons.target(14), coat: '#a855f7', time: 'Yesterday', status: 'SOW sprint breakdown' },
      lead_researcher: { icon: Icons.search(14), coat: '#3b82f6', time: 'Sep 26', status: 'Bottleneck audit active' },
      whatsapp_nudge: { icon: Icons.messageSquare(14), coat: '#10b981', time: 'Sep 25', status: 'Pitch sequence ready' },
      chief: { icon: Icons.crown(14), coat: '#64748b', time: 'Online', status: 'General orchestrator' }
    };

    const activeMeta = agentMeta[activeAgent.slug] || { icon: Icons.bot(14), coat: '#f19d38', time: 'Online', status: 'Autonomous agent' };

    // Count runs for this agent
    const agentRunsList = (Array.isArray(this._grokRuns) ? this._grokRuns : []).filter(r => (r.agent_slug || 'prototype_maker') === activeSlug);
    const runCount = agentRunsList.length;

    const leads = this.state.leads || [];

    const html = `
      <div class="baby-grok-bot-container">
        <div class="baby-grok-bot-shell" style="--grok-bot-current-agent-coat: ${activeMeta.coat};">
          <!-- Window Header -->
          <div class="baby-grok-bot-header">
            <div style="display: flex; align-items: center; gap: 12px;">
              <!-- Traffic Lights -->
              <div class="baby-grok-bot-traffic-lights" aria-hidden="true">
                <span class="baby-grok-traffic-light red"></span>
                <span class="baby-grok-traffic-light yellow"></span>
                <span class="baby-grok-traffic-light green"></span>
              </div>

              <!-- Runs Switcher Trigger -->
              <div class="baby-grok-runs-trigger" onclick="App.toggleGrokRunsDrawer()" title="View execution history">
                <span id="grok-runs-trigger-text">${runCount} run${runCount !== 1 ? 's' : ''}</span>
                <span style="display: inline-flex; align-items: center; opacity: 0.6;">${Icons.chevronDown(10)}</span>
              </div>
            </div>

            <!-- Center: Active Agent Name -->
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 13px; font-weight: 500; color: hsl(var(--foreground));">${this.escapeHtml(activeAgent.name)}</span>
              <span class="baby-grok-card-badge baby-grok-badge-done" style="font-size: 9.5px; padding: 0px 6px;">online</span>
            </div>

            <!-- Right: Inspector Toggle -->
            <div style="display: flex; align-items: center; gap: 6px;">
              <button class="btn btn-secondary btn-sm ${this._grokInspectorOpen ? 'active' : ''}" id="grok-inspector-toggle-btn" onclick="App.toggleGrokInspector()" title="Agent Configuration" style="width: 30px; height: 30px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px;">
                ${Icons.settings(14)}
              </button>
            </div>
          </div>

          <!-- Body Frame -->
          <div class="baby-grok-bot-body">
            <!-- Left AI Teammates Sidebar (Resizable) -->
            <div class="baby-grok-bot-sidebar" style="width: ${this._grokSidebarWidth || 240}px;">
              <div class="baby-grok-sidebar-header">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span class="baby-grok-sidebar-title">Teammates</span>
                  <span style="font-size: 10px; color: hsl(var(--muted-foreground));">${agents.length}</span>
                </div>
                <button class="btn-icon" onclick="App.openCreateAgentModal()" title="Add New Teammate" style="padding: 2px;">
                  ${Icons.plus(12)}
                </button>
              </div>

              <div class="baby-grok-sidebar-list">
                ${agents.map(ag => {
                  const meta = agentMeta[ag.slug] || { icon: Icons.bot(14), coat: '#f19d38', time: 'Active', status: ag.role || 'Agent' };
                  const isCurrent = ag.slug === activeSlug;
                  return `
                    <div class="baby-grok-sidebar-item ${isCurrent ? 'active' : ''}" onclick="App.selectGrokAgent('${ag.slug}')">
                      <div class="baby-grok-avatar" style="background: ${meta.coat}; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center;">
                        ${meta.icon}
                      </div>
                      <div class="baby-grok-item-info">
                        <div class="baby-grok-item-top">
                          <span class="baby-grok-item-name">${this.escapeHtml(ag.name)}</span>
                          <span class="baby-grok-item-time">${meta.time}</span>
                        </div>
                        <div class="baby-grok-item-status">${this.escapeHtml(meta.status)}</div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>

              <div class="baby-grok-sidebar-footer">
                <button class="baby-grok-btn-new-agent" onclick="App.openCreateAgentModal()">
                  ${Icons.plus(13)} New Agent
                </button>
              </div>
            </div>

            <!-- Left Resizer Splitter -->
            <div class="baby-grok-resizer baby-grok-resizer-left" onmousedown="App.initGrokResize(event, 'sidebar')" title="Drag to resize sidebar"></div>

            <!-- Main Central Workspace (Runs Drawer + Transcript + Floating Composer) -->
            <div class="baby-grok-bot-main">
              <!-- Runs Dropdown Drawer -->
              <div class="baby-grok-runs-dropdown ${this._grokRunsDrawerOpen ? 'open' : ''}" id="grok-runs-drawer">
                <div class="baby-grok-runs-dropdown-header">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-size: 12px; font-weight: 500; color: hsl(var(--foreground));">Execution History</span>
                    <span style="font-size: 11px; color: hsl(var(--muted-foreground));">${agentRunsList.length}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <button class="btn btn-primary btn-sm" onclick="App.newGrokRun()" style="font-size: 11px; padding: 3px 10px; border-radius: 6px; height: auto;">
                      + New
                    </button>
                    <button class="btn-icon" onclick="App.toggleGrokRunsDrawer()" style="padding: 2px;">${Icons.close(13)}</button>
                  </div>
                </div>

                <div class="baby-grok-runs-list">
                  ${agentRunsList.length === 0 ? `
                    <div style="text-align: center; padding: 24px; font-size: 12px; color: hsl(var(--muted-foreground));">
                      No executions yet.
                    </div>
                  ` : agentRunsList.map(run => {
                    const clientName = run.lead_business_name || run.lead_name || 'Client';
                    const promptExcerpt = run.prompt ? run.prompt.substring(0, 60) + (run.prompt.length > 60 ? '...' : '') : 'Workflow execution';
                    const timeAgo = run.created_at ? new Date(run.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const isCompleted = run.status === 'completed';
                    const isFailed = run.status === 'failed';
                    const statusBadgeClass = isCompleted ? 'baby-grok-badge-done' : (isFailed ? 'badge-lost' : 'baby-grok-badge-working');
                    const statusLabel = isCompleted ? 'Done' : (isFailed ? 'Failed' : 'Running');

                    return `
                      <div class="baby-grok-run-item" onclick="App.selectGrokRun('${run.id}')">
                        <div class="baby-grok-run-item-top">
                          <span class="baby-grok-run-client">${this.escapeHtml(clientName)}</span>
                          <span class="baby-grok-card-badge ${statusBadgeClass}">${statusLabel}</span>
                        </div>
                        <div class="baby-grok-run-prompt">${this.escapeHtml(promptExcerpt)}</div>
                        <div class="baby-grok-run-time">${timeAgo}</div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Pre-Flight Readiness Banner -->
              <div id="grok-agent-preflight-banner" class="lead-agent-preflight-wrap" style="padding: 0 12px; margin-top: 8px;"></div>

              <!-- Chat & Execution Viewport -->
              <div class="baby-grok-bot-transcript" id="grok-transcript-viewport">
                <!-- Transcript content populated dynamically by renderGrokTranscriptContent() -->
              </div>

              <!-- Floating Composer Bar -->
              <div class="baby-grok-composer-container">
                <div class="baby-grok-bot-composer">
                  <!-- Attach Button -->
                  <button class="baby-grok-composer-attach" onclick="App.insertGrokPill('@lead.profile')" title="Insert data pill">
                    ${Icons.plus(15)}
                  </button>

                  <!-- Autocomplete Popover -->
                  <div id="grok-pill-autocomplete" class="pill-autocomplete-popover" style="display: none; bottom: calc(100% + 10px); left: 12px;"></div>

                  <!-- Input -->
                  <input type="text" id="grok-prompt-input" class="baby-grok-composer-input" placeholder="Message ${this.escapeHtml(activeAgent.name)}..." onkeydown="if(event.key === 'Enter' && !event.shiftKey){ event.preventDefault(); App.runGrokAgentTask(); }" autocomplete="off" />

                  <!-- Send Button -->
                  <button class="baby-grok-composer-send" onclick="App.runGrokAgentTask()" title="Send">
                    ${Icons.arrowUp(14)}
                  </button>
                </div>
              </div>
            </div>

            <!-- Right Resizer Splitter -->
            <div class="baby-grok-resizer baby-grok-resizer-right" onmousedown="App.initGrokResize(event, 'inspector')" title="Drag to resize configuration drawer"></div>

            <!-- Right Inspector Drawer (Resizable) -->
            <div class="baby-grok-bot-inspector ${this._grokInspectorOpen ? 'open' : ''}" id="grok-inspector-drawer" style="width: ${this._grokInspectorWidth || 360}px;">
              <div class="baby-grok-inspector-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 13px; font-weight: 600; color: hsl(var(--foreground));">Configuration</span>
                  <span style="font-size: 11px; color: hsl(var(--muted-foreground));">(${this.escapeHtml(activeAgent.name)})</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                  <button class="btn-icon" onclick="App.toggleGrokInspectorExpand()" title="Toggle Width Expand" style="font-size: 13px; padding: 4px 6px;">${Icons.externalLink(13)}</button>
                  <button class="btn-icon" onclick="App.toggleGrokInspector()" title="Close Configuration" style="padding: 4px;">${Icons.close(14)}</button>
                </div>
              </div>

              <div class="baby-grok-inspector-body">
                <!-- Agent Identity -->
                <div>
                  <label class="baby-grok-inspector-label">Agent Title:</label>
                  <input type="text" id="grok-inspector-name" class="input" value="${this.escapeHtml(activeAgent.name)}" style="width: 100%; font-size: 12.5px; height: 32px;" />
                </div>

                <div>
                  <label class="baby-grok-inspector-label">Role Persona:</label>
                  <input type="text" id="grok-inspector-role" class="input" value="${this.escapeHtml(activeAgent.role || 'engineer')}" style="width: 100%; font-size: 12.5px; height: 32px;" />
                </div>

                <!-- Model Tier Dropdown (Primary) -->
                <div>
                  <label class="baby-grok-inspector-label">Primary Execution Model:</label>
                  <select id="grok-inspector-model" class="select" style="width: 100%; font-size: 12px; height: 32px;">
                    <option value="inherit" ${activeAgent.model === 'inherit' ? 'selected' : ''}>Antigravity (Local Desktop Engine)</option>
                    <option value="gemini-3.8-flash-high" ${(activeAgent.model || '').includes('flash-high') || (activeAgent.model || '').includes('flash_high') ? 'selected' : ''}>Gemini 3.8 Flash (High Thinking)</option>
                    <option value="gemini-3.8-flash-medium" ${(activeAgent.model || '').includes('flash-medium') ? 'selected' : ''}>Gemini 3.8 Flash (Medium Thinking)</option>
                    <option value="gemini-3.8-flash-low" ${(activeAgent.model || '').includes('flash-low') ? 'selected' : ''}>Gemini 3.8 Flash (Low / Fast)</option>
                    <option value="claude-3-5-sonnet" ${(activeAgent.model || '').includes('sonnet') ? 'selected' : ''}>Claude 3.5 Sonnet</option>
                    <option value="claude-opus-4-6" ${(activeAgent.model || '').includes('opus') ? 'selected' : ''}>Claude Opus 4.6</option>
                    <option value="gemini-1-5-pro" ${(activeAgent.model || '').includes('1-5-pro') ? 'selected' : ''}>Gemini 1.5 Pro</option>
                    <option value="gpt-4o" ${(activeAgent.model || '').includes('gpt-4o') ? 'selected' : ''}>GPT-4o</option>
                    <option value="pro" ${activeAgent.model === 'pro' || !activeAgent.model ? 'selected' : ''}>Pro (Standard)</option>
                    <option value="flash" ${activeAgent.model === 'flash' ? 'selected' : ''}>Flash (Standard)</option>
                  </select>
                </div>

                <!-- Fallback Model Dropdown -->
                <div>
                  <label class="baby-grok-inspector-label">Fallback Model (On Error / Timeout):</label>
                  <select id="grok-inspector-fallback-model" class="select" style="width: 100%; font-size: 12px; height: 32px;">
                    <option value="none" ${!activeAgent.fallback_model || activeAgent.fallback_model === 'none' ? 'selected' : ''}>None (Fail Fast with Notification)</option>
                    <option value="gemini-3.8-flash-high" ${activeAgent.fallback_model === 'gemini-3.8-flash-high' ? 'selected' : ''}>Gemini 3.8 Flash (High)</option>
                    <option value="gemini-3.8-flash-medium" ${activeAgent.fallback_model === 'gemini-3.8-flash-medium' ? 'selected' : ''}>Gemini 3.8 Flash (Medium)</option>
                    <option value="claude-3-5-sonnet" ${activeAgent.fallback_model === 'claude-3-5-sonnet' ? 'selected' : ''}>Claude 3.5 Sonnet</option>
                    <option value="gemini-1-5-pro" ${activeAgent.fallback_model === 'gemini-1-5-pro' ? 'selected' : ''}>Gemini 1.5 Pro</option>
                    <option value="gpt-4o-mini" ${activeAgent.fallback_model === 'gpt-4o-mini' ? 'selected' : ''}>GPT-4o Mini</option>
                  </select>
                </div>

                <!-- Autonomy Level -->
                <div>
                  <label class="baby-grok-inspector-label">Autonomy Policy:</label>
                  <div style="display: flex; gap: 8px;">
                    <label class="baby-grok-checkbox-label" style="flex: 1; padding: 6px 10px;">
                      <input type="radio" name="grok_autonomy_choice" value="approval_required" ${activeAgent.autonomy_level !== 'autonomous' ? 'checked' : ''} />
                      <div>
                        <div style="font-weight: 500; font-size: 11.5px;">Approval Req.</div>
                        <div style="font-size: 10px; color: hsl(var(--muted-foreground));">Review before execution</div>
                      </div>
                    </label>
                    <label class="baby-grok-checkbox-label" style="flex: 1; padding: 6px 10px;">
                      <input type="radio" name="grok_autonomy_choice" value="autonomous" ${activeAgent.autonomy_level === 'autonomous' ? 'checked' : ''} />
                      <div>
                        <div style="font-weight: 500; font-size: 11.5px;">Autonomous</div>
                        <div style="font-size: 10px; color: hsl(var(--muted-foreground));">Full auto-dispatch</div>
                      </div>
                    </label>
                  </div>
                </div>

                <!-- System Instructions Prompt -->
                <div>
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                    <label class="baby-grok-inspector-label" style="margin-bottom: 0;">System Instructions:</label>
                    <button type="button" class="btn btn-ghost btn-sm" onclick="App.openPromptEditorModal()" style="font-size: 10.5px; height: 20px; padding: 0 6px;">⤢ Expand</button>
                  </div>
                  <textarea id="grok-inspector-prompt" class="baby-grok-prompt-textarea">${this.escapeHtml(activeAgent.system_prompt || '')}</textarea>
                </div>

                <!-- Connected Data Pills Checklist + Creation Button -->
                <div>
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <label class="baby-grok-inspector-label" style="margin-bottom: 0;">Client Vault Data Pills:</label>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="App.openCreateDataPillModal()" style="font-size: 10.5px; height: 22px; padding: 0 8px; border-radius: 6px;">
                      + New Pill
                    </button>
                  </div>
                  <div class="baby-grok-checkbox-grid">
                    ${[
                      { tag: '@lead.profile', label: 'Client Profile & Brief', desc: 'Company brief, phone, status, and custom variables' },
                      { tag: '@transcripts.all', label: 'All Call Transcripts', desc: 'Ingests all Google Drive call recordings & transcripts' },
                      { tag: '@files.all', label: 'Vault Files & Documents', desc: 'Client PDFs, spreadsheets, and specification docs' },
                      { tag: '@meta.form_answers', label: 'Meta Ad Form Answers', desc: 'Inbound ad questionnaire & qualification fields' },
                      { tag: '@whatsapp.all', label: 'WhatsApp Chat History', desc: 'Full chat history & incoming client media messages' },
                      { tag: '@call.latest', label: 'Latest Call Recording', desc: 'The most recent client call transcript and summary' },
                      { tag: '@rep.context', label: 'Sales Rep Briefing', desc: 'Rep guidance: primary workflow, must-have screens & closing angle' },
                      ...(this._cachedCustomDataPills || []).map(p => ({ tag: p.tag, label: p.label, desc: p.description || p.category, isCustom: true, id: p.id }))
                    ].map(item => {
                      const isChecked = Array.isArray(activeAgent.default_pills) && activeAgent.default_pills.includes(item.tag);
                      return `
                        <label class="baby-grok-checkbox-label" style="justify-content: space-between;">
                          <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <input type="checkbox" class="grok-pill-checkbox" value="${item.tag}" ${isChecked ? 'checked' : ''} style="margin-top: 2px;" />
                            <div>
                              <div style="font-weight: 600; color: #f19d38; font-family: monospace; font-size: 11.5px;">${item.tag}</div>
                              <div style="font-size: 11px; color: hsl(var(--muted-foreground));">${item.desc}</div>
                            </div>
                          </div>
                          ${item.isCustom ? `
                            <button type="button" class="btn-icon" onclick="App.deleteCustomDataPill('${item.id}', event)" title="Delete Custom Pill" style="opacity: 0.6; padding: 2px;">
                              ${Icons.trash ? Icons.trash(12) : '×'}
                            </button>
                          ` : ''}
                        </label>
                      `;
                    }).join('')}
                  </div>
                </div>

                <!-- Enabled Skills & MCP Tools + Creation Button -->
                <div>
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <label class="baby-grok-inspector-label" style="margin-bottom: 0;">Enabled Skills & Execution Tools:</label>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="App.openCreateSkillModal()" style="font-size: 10.5px; height: 22px; padding: 0 8px; border-radius: 6px;">
                      + New Skill
                    </button>
                  </div>
                  <div class="baby-grok-checkbox-grid">
                    ${[
                      { slug: 'subdomain-provisioner', name: 'Subdomain Provisioner', desc: 'Provisions live proto-{client}.zero7.space via Cloudflare DNS & Nginx' },
                      { slug: 'web_search', name: 'Live Web Research', desc: 'Searches web for competitor benchmarks and modern UI patterns' },
                      { slug: 'whatsapp_sender', name: 'WhatsApp Dispatcher', desc: 'Sends approved messages & pitch hooks directly to client phone' },
                      { slug: 'drive_file_reader', name: 'Google Drive Sync', desc: 'Syncs and reads files from connected Google Drive Vault folder' },
                      ...(this._cachedSkills || []).filter(s => !['subdomain-provisioner', 'web_search', 'whatsapp_sender', 'drive_file_reader'].includes(s.slug)).map(s => ({
                        slug: s.slug, name: s.name, desc: s.description || 'Custom autonomous skill', isCustom: true
                      }))
                    ].map(skill => {
                      const isChecked = Array.isArray(activeAgent.assigned_skills) ? activeAgent.assigned_skills.includes(skill.slug) : (skill.slug === 'subdomain-provisioner');
                      return `
                        <label class="baby-grok-checkbox-label" style="justify-content: space-between;">
                          <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <input type="checkbox" class="grok-skill-checkbox" value="${skill.slug}" ${isChecked ? 'checked' : ''} style="margin-top: 2px;" />
                            <div>
                              <div style="font-weight: 600; color: hsl(var(--foreground)); font-size: 11.5px;">${skill.name}</div>
                              <div style="font-size: 11px; color: hsl(var(--muted-foreground));">${skill.desc}</div>
                            </div>
                          </div>
                          ${skill.isCustom ? `
                            <button type="button" class="btn-icon" onclick="App.deleteCustomSkill('${skill.slug}', event)" title="Delete Custom Skill" style="opacity: 0.6; padding: 2px;">
                              ${Icons.trash ? Icons.trash(12) : '×'}
                            </button>
                          ` : ''}
                        </label>
                      `;
                    }).join('')}
                  </div>
                </div>

                <!-- Save Action Button -->
                <button class="btn btn-primary" onclick="App.saveGrokAgentConfig()" style="width: 100%; justify-content: center; height: 38px; font-weight: 600; margin-top: 8px;">
                  Save Agent Configuration
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
    this.renderGrokTranscriptContent();
    this.checkPendingActionsCount();

    if (activeSlug === 'prototype_maker' && this._grokSelectedLeadId) {
      this.renderPrototypeReadinessBanner(this._grokSelectedLeadId, 'grok-agent-preflight-banner');
    }

    // Wire up autocomplete for floating composer
    const input = document.getElementById('grok-prompt-input');
    if (input) {
      this.attachPillAutocomplete(input, this._grokSelectedLeadId, 'grok-pill-autocomplete');
    }
  },

  renderGrokTranscriptContent() {
    const viewport = document.getElementById('grok-transcript-viewport');
    if (!viewport) return;

    const agents = this._cachedAgentDefinitions || [];
    const activeSlug = this._grokActiveAgentSlug || 'prototype_maker';
    const activeAgent = agents.find(a => a.slug === activeSlug) || agents[0] || {};
    
    // Get ALL runs for this agent (cumulative view)
    const allRuns = (Array.isArray(this._grokRuns) ? this._grokRuns : [])
      .filter(r => (r.agent_slug || 'prototype_maker') === activeSlug)
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

    const agentInitials = {
      prototype_maker: { icon: Icons.zap(14), coat: '#f19d38', label: 'Prototype Builder' },
      sow_architect: { icon: Icons.target(14), coat: '#a855f7', label: 'SOW Architect' },
      lead_researcher: { icon: Icons.search(14), coat: '#3b82f6', label: 'Market Analyst' },
      whatsapp_nudge: { icon: Icons.messageSquare(14), coat: '#10b981', label: 'WhatsApp Dispatcher' },
      chief: { icon: Icons.crown(14), coat: '#64748b', label: 'Chief Architect' }
    };
    const meta = agentInitials[activeAgent.slug] || { icon: Icons.bot(14), coat: '#3b82f6', label: activeAgent.name || 'Agent' };

    if (allRuns.length > 0) {
      // CUMULATIVE CHAT: Centered container matching Antigravity & Grok
      let chatHtml = `<div class="baby-grok-chat-container">`;

      allRuns.forEach((run, idx) => {
        const clientName = run.lead_business_name || run.business_name || run.lead_name || 'Client';
        const timeStr = run.created_at ? new Date(run.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const dateStr = run.created_at ? new Date(run.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Today';

        // 1. Timestamp divider
        chatHtml += `
          <div class="baby-grok-timestamp-divider">
            <span>${dateStr} ${timeStr} · ${this.escapeHtml(clientName)}</span>
          </div>
        `;

        // 2. User prompt bubble (Sleek slate bubble, no harsh black boxes)
        chatHtml += `
          <div class="baby-grok-turn-user">
            <div class="baby-grok-bubble-user">
              ${this.formatGrokPromptHtml(run.prompt || 'Execute workflow')}
            </div>
          </div>
        `;

        // 3. Parse output (Full output, never truncated)
        const rawOutput = run.stream_output || run.result || '';
        let resultData = null;
        try {
          resultData = typeof rawOutput === 'string' && rawOutput.trim().startsWith('{') ? JSON.parse(rawOutput) : { text: rawOutput };
        } catch (e) {
          resultData = { text: rawOutput };
        }

        const outputText = resultData?.text || resultData?.message || resultData?.pitch || (typeof rawOutput === 'string' ? rawOutput : '');
        const isRunning = run.status === 'pending' || run.status === 'running';
        const isCompleted = run.status === 'completed';
        const isFailed = run.status === 'failed';

        const modelLabel = (run.model === 'flash_lite' || run.model === 'lite') ? 'Antigravity Flash Lite' : ((run.model === 'pro') ? 'Antigravity Pro' : 'Antigravity Flash');

        // 4. Agent response turn (Antigravity Style with rich GFM Markdown)
        chatHtml += `
          <div class="baby-grok-turn-agent" id="grok-agent-turn-${run.id}">
            <!-- Header Row -->
            <div class="baby-grok-agent-header">
              <div class="baby-grok-agent-identity">
                <div class="baby-grok-agent-avatar" style="background: ${meta.coat}; display: flex; align-items: center; justify-content: center;">
                  ${meta.icon}
                </div>
                <div class="baby-grok-agent-meta">
                  <span class="baby-grok-agent-name">${this.escapeHtml(activeAgent.name || 'Agent')}</span>
                  <span class="baby-grok-agent-model-badge">${modelLabel}</span>
                  ${isRunning ? `
                    <span class="baby-grok-status-badge running"><span class="spin">${Icons.refresh(11)}</span> Executing on Antigravity...</span>
                  ` : (isFailed ? `
                    <span class="baby-grok-status-badge error">${Icons.xCircle(11)} Failed</span>
                  ` : `
                    <span class="baby-grok-status-badge success">${Icons.check(11)} Completed</span>
                  `)}
                </div>
              </div>
              <div class="baby-grok-agent-actions">
                <button type="button" class="baby-grok-action-btn" onclick="App.copyMessageText(this, decodeURIComponent('${encodeURIComponent(outputText)}'))" title="Copy response markdown">
                  ${Icons.copy(12)} Copy
                </button>
              </div>
            </div>

            <!-- Collapsible Reasoning & Tool Traces (Antigravity Style) -->
            ${(run.thoughts || isRunning) ? `
              <div class="antigravity-thinking-accordion" style="margin: 8px 0 12px;">
                <details class="antigravity-thinking-details" ${isRunning ? 'open' : ''}>
                  <summary class="antigravity-thinking-summary">
                    <span class="antigravity-thinking-text">
                      ${isRunning ? `<span class="spin">${Icons.refresh(11)}</span> Thinking...` : 'Worked for 5m'}
                    </span>
                    <span class="antigravity-thinking-arrow">${Icons.chevronRight(12)}</span>
                  </summary>
                  <div class="antigravity-thinking-drawer">
                    <pre class="antigravity-thinking-code">${this.escapeHtml(run.thoughts || 'Agent active. Analyzing project files & workspace...')}</pre>
                  </div>
                </details>
              </div>
            ` : ''}

            <!-- Full Rendered Markdown Body (Antigravity Quality) -->
            <div class="baby-grok-markdown-body" id="grok-run-output-${run.id}">
              ${outputText && outputText.trim() ? this.renderAgentMarkdown(outputText) : (isRunning ? `
                <div class="agent-stream-placeholder" style="font-size: 13px; color: var(--color-mid-gray); font-style: italic; padding: 10px 0; display: flex; align-items: center; gap: 8px;">
                  <span class="agent-pulse-dot" style="background:#2563eb; width:8px; height:8px; border-radius:50%; display:inline-block; animation:agentPulse 1.2s infinite;"></span>
                  <span>Agent is analyzing workspace files and formulating response in Antigravity...</span>
                </div>
              ` : `
                <p>Executed workflow for <strong>${this.escapeHtml(clientName)}</strong>.</p>
              `)}
            </div>

            <!-- Deliverables & Artifacts Card -->
            ${(resultData?.subdomain || (run.artifacts && run.artifacts.length > 0)) ? `
              <div class="baby-grok-deliverables-card">
                <div class="baby-grok-deliverables-header">
                  <div style="display: flex; align-items: center; gap: 7px;">
                    <span style="display: inline-flex; align-items: center; color: #f19d38;">${Icons.zap(13)}</span>
                    <span style="font-weight: 600; font-size: 12px; color: hsl(var(--foreground));">Deliverables & Generated Artifacts</span>
                  </div>
                  <span class="baby-grok-card-badge baby-grok-badge-done">Ready</span>
                </div>
                <div class="baby-grok-deliverables-body">
                  ${resultData?.subdomain ? `
                    <div class="baby-grok-deliverable-item">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="display: inline-flex; align-items: center; color: #38bdf8;">${Icons.globe(14)}</span>
                        <div>
                          <div style="font-size: 12px; font-weight: 600; color: hsl(var(--foreground));">Live Client Prototype</div>
                          <a href="${resultData.subdomain}" target="_blank" class="baby-grok-prototype-link">${resultData.subdomain} <span style="display: inline-flex; align-items: center;">${Icons.externalLink(11)}</span></a>
                        </div>
                      </div>
                      <button class="btn btn-primary btn-sm" onclick="window.open('${resultData.subdomain}', '_blank')" style="font-size: 11px; padding: 3px 10px; height: auto; display: inline-flex; align-items: center; gap: 4px;">
                        Open Prototype ${Icons.externalLink(12)}
                      </button>
                    </div>
                  ` : ''}
                  ${run.artifacts && run.artifacts.length > 0 ? run.artifacts.map(art => `
                    <div class="baby-grok-deliverable-item">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        ${Icons.fileText(14)}
                        <div>
                          <div style="font-size: 12px; font-weight: 600; color: hsl(var(--foreground));">${this.escapeHtml(art.name || art.path || 'Artifact')}</div>
                          ${art.summary ? `<div style="font-size: 11px; color: hsl(var(--muted-foreground));">${this.escapeHtml(art.summary)}</div>` : ''}
                        </div>
                      </div>
                      ${art.path ? `<button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 3px 8px; height: auto;" onclick="navigator.clipboard.writeText('${this.escapeHtml(art.path)}'); API.showToast('Copied path!', 'success');">Copy Path</button>` : ''}
                    </div>
                  `).join('') : ''}
                </div>
              </div>
            ` : ''}

            <!-- Execution Error Notice -->
            ${run.error_message ? `
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 12.5px; color: #991b1b; margin-top: 10px;">
                <strong>Execution Error:</strong> ${this.escapeHtml(run.error_message)}
              </div>
            ` : ''}
          </div>
        `;
      });

      chatHtml += `</div>`;
      viewport.innerHTML = chatHtml;
    } else {
      // EMPTY STATE: Clean centered agent identity — no shortcuts
      viewport.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; max-width: 440px; margin: 0 auto; gap: 14px;">
          <div class="baby-grok-avatar" style="width: 52px; height: 52px; background: ${meta.coat}; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,0.12); color: white;">
            ${meta.icon ? meta.icon.replace(/width="14"/, 'width="24"').replace(/height="14"/, 'height="24"') : Icons.bot(24)}
          </div>
          <div>
            <h2 style="font-size: 18px; font-weight: 600; color: hsl(var(--foreground)); margin: 0 0 6px 0;">${this.escapeHtml(activeAgent.name || 'Agent')}</h2>
            <p style="font-size: 13px; color: hsl(var(--muted-foreground)); line-height: 1.55; margin: 0;">
              ${this.escapeHtml(activeAgent.description || activeAgent.role || 'Autonomous AI teammate connected to Google Antigravity.')}
            </p>
          </div>
        </div>
      `;
    }

    // Scroll transcript to bottom
    viewport.scrollTop = viewport.scrollHeight;
  },

  attachPillAutocomplete(textareaEl, leadId, popoverId = 'pill-autocomplete-popover') {
    if (!textareaEl || textareaEl._boundPillAutocomplete) return;
    textareaEl._boundPillAutocomplete = true;

    const getLeadInfo = () => {
      const leads = this.state.leads || [];
      const curLead = (leadId ? leads.find(l => l.id === leadId) : null) || this.state.selectedLead || {};
      const clientName = curLead.business_name || curLead.name || 'this client';
      return { lead: curLead, clientName };
    };

    // Pre-load dynamic data pills and repository files from CRM backend if leadId exists
    let dynamicPills = [];
    if (leadId) {
      API.get(`/api/leads/${leadId}/data-pills`).then(res => {
        if (res && res.available_pills) {
          dynamicPills = res.available_pills.map(p => ({
            tag: p.tag,
            label: p.label || p.tag,
            desc: p.preview || p.desc || p.label || 'Dynamic lead asset',
            icon: p.icon || (p.tag && p.tag.startsWith('@file:') ? Icons.file(14) : Icons.tag(14)),
            category: p.category || (p.tag && p.tag.startsWith('@file:') ? 'Repository File' : 'Context'),
            badge: p.badge || (p.tag && p.tag.startsWith('@file:') ? 'FILE' : ''),
            path: p.path || '',
            insert: p.insert || (p.tag + ' ')
          }));
        }
      }).catch(() => {});
    }

    // Pre-load skills and agents if not cached yet
    if (!this._cachedSkills || this._cachedSkills.length === 0) {
      API.get('/api/skills').then(res => { if (res) this._cachedSkills = res; }).catch(() => {});
    }
    if (!this._cachedAgentDefinitions || this._cachedAgentDefinitions.length === 0) {
      API.get('/api/agents').then(res => { if (res) this._cachedAgentDefinitions = res; }).catch(() => {});
    }

    const popover = document.getElementById(popoverId);
    if (!popover) return;

    let selectedIdx = 0;
    let currentFiltered = [];
    let currentTrigger = null;
    let currentTriggerIdx = -1;

    const buildItemsForTrigger = (trigger) => {
      const { clientName } = getLeadInfo();

      if (trigger === '/') {
        // 1. Quick Prompts & Commands
        const commands = [
          {
            tag: '/prototype',
            label: 'Build Live Prototype',
            category: 'Command',
            desc: `Build Tailwind prototype & provision live subdomain for ${clientName}`,
            insert: `Build an interactive prototype for ${clientName} using @lead.profile and @transcripts.all. Provision live subdomain.`
          },
          {
            tag: '/bottlenecks',
            label: 'Map Bottlenecks & Stack',
            category: 'Command',
            desc: 'Analyze inbound questionnaires & calls for top 3 bottlenecks',
            insert: 'Analyze @meta.form_answers and @call.latest to identify top 3 bottlenecks and custom solution architecture.'
          },
          {
            tag: '/nudge',
            label: 'Draft WhatsApp Nudge',
            category: 'Command',
            desc: 'Draft high-converting follow-up pitch referencing latest call',
            insert: 'Draft a high-converting follow-up WhatsApp pitch incorporating live prototype link for @lead.profile.'
          },
          {
            tag: '/sow',
            label: 'Draft Scope of Work (SOW)',
            category: 'Command',
            desc: `Generate full Phase 1 MVP deliverables & timeline for ${clientName}`,
            insert: `Draft a full Client Scope of Work (SOW) for ${clientName} including technical deliverables, Phase 1 MVP sprint breakdown, timeline, and commercial terms.`
          },
          {
            tag: '/brief',
            label: 'Company Intelligence Brief',
            category: 'Command',
            desc: 'Comprehensive operational workflow audit and pricing proposal',
            insert: 'Conduct deep enterprise workflow audit using @lead.profile, @meta.form_answers, and @whatsapp.all. Propose solution architecture and budget in INR.'
          },
          {
            tag: '/subdomain',
            label: 'Configure Subdomain',
            category: 'Command',
            desc: `Assign and route live prototype subdomain for ${clientName}`,
            insert: `Assign and configure Cloudflare DNS and SSL routing for prototype subdomain for client ${clientName}.`
          }
        ];

        // 2. Skills
        const defaultSkills = [
          {
            tag: '/subdomain-provisioner',
            label: 'Subdomain Provisioner',
            category: 'Skill',
            desc: 'Automated Cloudflare DNS & Nginx Proxy Deployment',
            insert: '/subdomain-provisioner '
          }
        ];
        const extraSkills = (this._cachedSkills || [])
          .filter(s => s.slug !== 'subdomain-provisioner')
          .map(s => ({
            tag: '/' + s.slug,
            label: s.name,
            category: 'Skill',
            desc: s.description || 'Custom autonomous skill',
            insert: '/' + s.slug + ' '
          }));

        // 3. Agents
        const defaultAgents = [
          {
            tag: '/prototype_maker',
            label: 'Prototype Maker Agent',
            category: 'Agent',
            desc: 'Tailwind HTML mockups & live subdomains',
            insert: 'Use agent Prototype Maker to: '
          },
          {
            tag: '/lead_researcher',
            label: 'Lead Researcher Agent',
            category: 'Agent',
            desc: 'Deep enterprise workflow & questionnaire audit',
            insert: 'Use agent Lead Researcher to: '
          },
          {
            tag: '/sow_architect',
            label: 'SOW Architect Agent',
            category: 'Agent',
            desc: 'Phase 1 MVP deliverables & sprint breakdown',
            insert: 'Use agent SOW Architect to: '
          },
          {
            tag: '/whatsapp_nudge',
            label: 'WhatsApp Nudge Agent',
            category: 'Agent',
            desc: 'Polite re-engagement hook from past chats',
            insert: 'Use agent WhatsApp Nudge to: '
          },
          {
            tag: '/chief',
            label: 'Chief Orchestrator Agent',
            category: 'Agent',
            desc: 'General orchestrator & workflow coordination',
            insert: 'Use agent Chief to: '
          }
        ];
        const extraAgents = (this._cachedAgentDefinitions || [])
          .filter(a => !['prototype_maker', 'lead_researcher', 'sow_architect', 'whatsapp_nudge', 'chief'].includes(a.slug))
          .map(a => ({
            tag: '/' + a.slug,
            label: a.name + ' Agent',
            category: 'Agent',
            desc: a.description || 'Custom autonomous agent',
            insert: `Use agent ${a.name} to: `
          }));

        return [...commands, ...defaultSkills, ...extraSkills, ...defaultAgents, ...extraAgents];
      }

      if (trigger === '@') {
        // 1. Core Data Pills
        const corePills = [
          { tag: '@lead.profile', label: 'Lead Profile', category: 'Context', badge: 'PROFILE', desc: 'Company brief, city, budget tier, phone', insert: '@lead.profile ' },
          { tag: '@whatsapp.all', label: 'All WhatsApp', category: 'Context', badge: 'WHATSAPP', desc: 'Complete history across Central & Personal inboxes', insert: '@whatsapp.all ' },
          { tag: '@whatsapp.central', label: 'Central Inbox', category: 'Context', badge: 'CENTRAL', desc: 'Official Zero7 Central inbox messages', insert: '@whatsapp.central ' },
          { tag: '@whatsapp.personal', label: 'Personal Inbox', category: 'Context', badge: 'PERSONAL', desc: 'Personal founder direct chat history', insert: '@whatsapp.personal ' },
          { tag: '@transcripts.all', label: 'Call Transcripts', category: 'Context', badge: 'AUDIO', desc: 'All Deepgram call audio transcripts', insert: '@transcripts.all ' },
          { tag: '@call.latest', label: 'Latest Call', category: 'Context', badge: 'CALL', desc: 'Most recent call audio transcript & notes', insert: '@call.latest ' },
          { tag: '@meta.form_answers', label: 'Meta Ad Form', category: 'Context', badge: 'META', desc: 'Inbound ad questionnaire answers & attribution', insert: '@meta.form_answers ' },
          { tag: '@files.all', label: 'Client Files', category: 'Context', badge: 'FILES', desc: 'Client attachments, spreadsheets & uploaded files', insert: '@files.all ' }
        ];

        // 2. Repository Files
        const repoFiles = dynamicPills.filter(dp => (dp.tag && dp.tag.startsWith('@file:')) || dp.category === 'Repository Files' || dp.category === 'Repository File');

        // 3. Other Dynamic Pills
        const dynOther = dynamicPills.filter(dp => !dp.tag.startsWith('@file:') && dp.category !== 'Repository Files' && dp.category !== 'Repository File' && !corePills.some(cp => cp.tag === dp.tag));

        // 4. Custom Registered Data Pills
        const customPills = (this._cachedCustomDataPills || []).map(p => ({
          tag: p.tag,
          label: p.label,
          category: p.category || 'Custom Context',
          badge: 'CUSTOM',
          desc: p.description || 'Custom registered data pill',
          insert: p.tag + ' '
        }));

        // 5. Mentions for Agents & Skills
        const mentionAgents = [
          { tag: '@prototype_maker', label: 'Prototype Maker', category: 'Agent', badge: 'AGENT', desc: 'Autonomous Prototype Builder', insert: '@prototype_maker ' },
          { tag: '@lead_researcher', label: 'Lead Researcher', category: 'Agent', badge: 'AGENT', desc: 'Lead Intelligence & Solutions Strategist', insert: '@lead_researcher ' },
          { tag: '@sow_architect', label: 'SOW Architect', category: 'Agent', badge: 'AGENT', desc: 'Scope of Work & Sprint Breakdown', insert: '@sow_architect ' },
          { tag: '@whatsapp_nudge', label: 'WhatsApp Nudge', category: 'Agent', badge: 'AGENT', desc: 'WhatsApp Outreach Consultant', insert: '@whatsapp_nudge ' },
          { tag: '@chief', label: 'Chief Orchestrator', category: 'Agent', badge: 'AGENT', desc: 'General Orchestrator & Team Coordinator', insert: '@chief ' },
          { tag: '@subdomain-provisioner', label: 'Subdomain Provisioner', category: 'Skill', badge: 'SKILL', desc: 'Cloudflare DNS & Nginx Deployer', insert: '@subdomain-provisioner ' }
        ];

        return [...corePills, ...repoFiles, ...dynOther, ...customPills, ...mentionAgents];
      }

      return [];
    };

    const getPillSvgIcon = (tag, category) => {
      const t = (tag || '').toLowerCase();
      if (t.startsWith('@file:') || category === 'Repository File' || category === 'Repository Files') {
        const ext = t.split('.').pop();
        if (ext === 'md' || ext === 'txt') {
          return Icons.fileText(15);
        }
        if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
          return Icons.fileSpreadsheet(15);
        }
        if (['html', 'js', 'ts', 'tsx', 'jsx', 'py', 'json', 'sql', 'css'].includes(ext)) {
          return Icons.fileCode(15);
        }
        return Icons.file(15);
      }
      if (t.includes('whatsapp')) {
        return Icons.whatsapp(15);
      }
      if (t.includes('lead') || t.includes('profile') || t.includes('user')) {
        return Icons.user(15);
      }
      if (t.includes('transcript') || t.includes('call') || t.includes('audio') || t.includes('recording')) {
        return Icons.mic(15);
      }
      if (t.includes('meta') || t.includes('form') || t.includes('brief') || t.includes('sow') || t.includes('doc')) {
        return Icons.fileText(15);
      }
      if (t.includes('file') || t.includes('drive') || t.includes('vault') || t.includes('sheet')) {
        return Icons.folder(15);
      }
      if (category === 'Agent' || t.includes('maker') || t.includes('researcher') || t.includes('chief') || t.includes('architect')) {
        return Icons.bot(15);
      }
      if (category === 'Skill' || t.includes('provisioner') || t.includes('subdomain')) {
        return Icons.zap(15);
      }
      if (category === 'Command') {
        return Icons.terminal(15);
      }
      return Icons.tag(15);
    };

    const highlightMatch = (str, query) => {
      if (!query || !str) return this.escapeHtml(str || '');
      const s = String(str);
      const q = String(query).toLowerCase();
      const idx = s.toLowerCase().indexOf(q);
      if (idx === -1) return this.escapeHtml(s);
      const before = s.substring(0, idx);
      const match = s.substring(idx, idx + q.length);
      const after = s.substring(idx + q.length);
      return `${this.escapeHtml(before)}<span class="pill-autocomplete-highlight">${this.escapeHtml(match)}</span>${this.escapeHtml(after)}`;
    };

    const renderPopover = (trigger, queryText) => {
      const allItems = buildItemsForTrigger(trigger);
      const q = (queryText || '').toLowerCase().trim();

      const filtered = q ? allItems.filter(item => {
        const tagMatch = item.tag.toLowerCase().includes(q);
        const labelMatch = (item.label || '').toLowerCase().includes(q);
        const descMatch = (item.desc || '').toLowerCase().includes(q);
        return tagMatch || labelMatch || descMatch;
      }) : allItems;

      if (filtered.length === 0) {
        popover.style.display = 'none';
        currentFiltered = [];
        return;
      }

      currentFiltered = filtered;
      if (selectedIdx >= filtered.length) selectedIdx = 0;

      let itemsHtml = '';
      filtered.forEach((item, idx) => {
        const isSel = idx === selectedIdx;
        const iconSvg = getPillSvgIcon(item.tag, item.category);
        const tagHtml = highlightMatch(item.tag, q);
        const descText = item.desc || item.label || '';
        const descHtml = highlightMatch(descText, q);

        // Header category tag on the top right of first item (Antigravity style: "FILE RESULTS" / "CONTEXT RESULTS")
        const isFileItem = (item.tag && item.tag.startsWith('@file:')) || item.category === 'Repository File' || item.category === 'Repository Files';
        const categoryHeader = idx === 0 ? `<span class="pill-autocomplete-cat-badge">${trigger === '/' ? 'COMMAND RESULTS' : (isFileItem ? 'FILE RESULTS' : 'CONTEXT RESULTS')}</span>` : '';
        const badgeChip = item.badge ? `<span class="pill-item-badge pill-badge-${(item.badge || '').toLowerCase()}">${this.escapeHtml(item.badge)}</span>` : '';

        itemsHtml += `
          <div class="pill-autocomplete-item ${isSel ? 'selected' : ''}" data-idx="${idx}">
            <div class="pill-autocomplete-item-left">
              <span class="pill-autocomplete-icon">${iconSvg}</span>
              <span class="pill-autocomplete-tag">${tagHtml}</span>
              <span class="pill-autocomplete-sub" title="${this.escapeHtml(descText)}">${descHtml}</span>
            </div>
            <div class="pill-autocomplete-item-right" style="display: flex; align-items: center; gap: 6px;">
              ${badgeChip}
              ${categoryHeader}
            </div>
          </div>
        `;
      });

      popover.innerHTML = `
        <div class="pill-autocomplete-list" id="${popoverId}-list">
          ${itemsHtml}
        </div>
        <div class="pill-autocomplete-scroll-hint" id="${popoverId}-scroll-hint" style="display: none;" title="Scroll down">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
        </div>
      `;

      popover.style.display = 'block';

      // Check overflow for scroll hint indicator
      const listEl = document.getElementById(`${popoverId}-list`);
      const hintEl = document.getElementById(`${popoverId}-scroll-hint`);
      if (listEl && hintEl) {
        hintEl.onclick = () => listEl.scrollBy({ top: 68, behavior: 'smooth' });
        const updateScrollHint = () => {
          const hasMore = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight > 15;
          hintEl.style.display = hasMore ? 'flex' : 'none';
        };
        listEl.onscroll = updateScrollHint;
        setTimeout(updateScrollHint, 20);
      }

      // Auto scroll to active item
      const selEl = popover.querySelector('.pill-autocomplete-item.selected');
      if (selEl) selEl.scrollIntoView({ block: 'nearest' });

      popover.querySelectorAll('.pill-autocomplete-item').forEach(el => {
        el.onclick = () => {
          const idx = parseInt(el.dataset.idx, 10);
          if (!isNaN(idx) && currentFiltered[idx]) {
            insertItem(currentFiltered[idx]);
          }
        };
      });
    };

    const insertItem = (item) => {
      const cur = textareaEl.value;
      const pos = textareaEl.selectionStart;
      const left = cur.substring(0, pos);
      const right = cur.substring(pos);
      const prefix = left.substring(0, currentTriggerIdx);
      const insertText = item.insert || (item.tag + ' ');

      textareaEl.value = prefix + insertText + right;
      const newPos = prefix.length + insertText.length;
      textareaEl.selectionStart = textareaEl.selectionEnd = newPos;
      popover.style.display = 'none';
      currentTrigger = null;
      currentTriggerIdx = -1;
      textareaEl.focus();
    };

    textareaEl.addEventListener('input', () => {
      const pos = textareaEl.selectionStart;
      const left = textareaEl.value.substring(0, pos);
      const lastAt = left.lastIndexOf('@');
      const lastSlash = left.lastIndexOf('/');

      let trigger = null;
      let triggerIdx = -1;

      if (lastAt >= 0 && lastAt > lastSlash) {
        if (lastAt === 0 || /[\s\n]/.test(left[lastAt - 1])) {
          const query = left.substring(lastAt + 1);
          if (!/[\s\n]/.test(query)) {
            trigger = '@';
            triggerIdx = lastAt;
          }
        }
      } else if (lastSlash >= 0 && lastSlash > lastAt) {
        if (lastSlash === 0 || /[\s\n]/.test(left[lastSlash - 1])) {
          const query = left.substring(lastSlash + 1);
          if (!/[\s\n]/.test(query)) {
            trigger = '/';
            triggerIdx = lastSlash;
          }
        }
      }

      if (trigger) {
        currentTrigger = trigger;
        currentTriggerIdx = triggerIdx;
        const queryText = left.substring(triggerIdx + 1);
        renderPopover(trigger, queryText);
      } else {
        popover.style.display = 'none';
        currentTrigger = null;
        currentTriggerIdx = -1;
      }
    });

    textareaEl.addEventListener('keydown', (e) => {
      if (popover.style.display !== 'none' && currentFiltered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          selectedIdx = (selectedIdx + 1) % currentFiltered.length;
          const items = popover.querySelectorAll('.pill-autocomplete-item');
          items.forEach((it, idx) => it.classList.toggle('selected', idx === selectedIdx));
          const selEl = popover.querySelector('.pill-autocomplete-item.selected');
          if (selEl) selEl.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          selectedIdx = (selectedIdx - 1 + currentFiltered.length) % currentFiltered.length;
          const items = popover.querySelectorAll('.pill-autocomplete-item');
          items.forEach((it, idx) => it.classList.toggle('selected', idx === selectedIdx));
          const selEl = popover.querySelector('.pill-autocomplete-item.selected');
          if (selEl) selEl.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (currentFiltered[selectedIdx]) {
            insertItem(currentFiltered[selectedIdx]);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          popover.style.display = 'none';
          currentTrigger = null;
          currentTriggerIdx = -1;
        }
      }
    }, true);

    document.addEventListener('click', (e) => {
      if (!textareaEl.contains(e.target) && !popover.contains(e.target)) {
        popover.style.display = 'none';
        currentTrigger = null;
        currentTriggerIdx = -1;
      }
    });
  },

  // ==================== ACTION QUEUE METHODS ====================

  async checkPendingActionsCount() {
    try {
      const actions = await API.get('/api/actions?status=pending_approval');
      const count = Array.isArray(actions) ? actions.length : 0;
      const badges = [
        document.getElementById('pending-actions-badge'),
        document.getElementById('studio-action-badge')
      ];
      badges.forEach(b => {
        if (b) {
          b.textContent = count;
          b.style.display = count > 0 ? 'inline-block' : 'none';
        }
      });
    } catch (e) {
      // Silently ignore if server offline
    }
  },

  async openActionQueueDrawer() {
    try {
      const actions = await API.get('/api/actions?status=pending_approval');
      const items = Array.isArray(actions) ? actions : [];

      const html = `
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${Icons.zap(17)}
            </div>
            <div>
              <h3 style="font-size: 15.5px; font-weight: 600; margin: 0; display: flex; align-items: center; gap: 8px;">
                Action Approval Queue
                <span class="badge" style="background: var(--color-warning-light); color: var(--color-warning); font-size: 11px; padding: 1px 7px;">
                  ${items.length} Pending
                </span>
              </h3>
              <div class="modal-subtitle">
                High-stakes agent actions staged for 1-click human verification
              </div>
            </div>
          </div>
          <button class="modal-close" onclick="App.closeModal()" title="Close">${Icons.close(16)}</button>
        </div>

        <div class="modal-body" style="padding: 18px 22px;">
          ${items.length === 0 ? `
            <div style="text-align: center; padding: 48px 16px; color: var(--color-mid-gray);">
              <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--color-success-light); color: var(--color-success); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
                ${Icons.check(24)}
              </div>
              <div style="font-size: 15px; font-weight: 600; color: var(--color-ink);">All Actions Clear!</div>
              <p style="font-size: 12.5px; color: var(--color-mid-gray); margin-top: 4px; max-width: 320px; margin-left: auto; margin-right: auto;">
                No external messages or prototype provisions currently waiting for human approval.
              </p>
            </div>
          ` : `
            <div class="action-queue-list">
              ${items.map(act => {
                const actType = (act.action_type || 'action').toLowerCase();
                let payload = act.payload || {};
                if (typeof payload === 'string') {
                  try { payload = JSON.parse(payload); } catch (e) { payload = {}; }
                }

                const lead = act.lead_id ? this.state.leads.find(l => l.id === act.lead_id) : null;
                const leadName = lead ? (lead.business_name || lead.name) : (payload.lead_name || payload.business_name || 'System Aberration');
                
                const isWhatsApp = actType.includes('whatsapp') || payload.message || payload.phone;
                const isSubdomain = actType.includes('subdomain') || actType.includes('prototype') || payload.live_url;
                const isAlert = actType.includes('alert') || actType.includes('sentinel') || payload.aberration_type || payload.dispatched_nags;

                let badgeClass = 'whatsapp';
                let badgeLabel = 'WhatsApp Outreach';
                let badgeIcon = Icons.whatsapp(12);

                if (isAlert) {
                  badgeClass = 'alert';
                  badgeLabel = 'Sentinel Aberration';
                  badgeIcon = Icons.zap(12);
                } else if (isSubdomain) {
                  badgeClass = 'subdomain';
                  badgeLabel = 'Prototype Deploy';
                  badgeIcon = Icons.globe(12);
                }

                // Format content preview
                let previewHtml = '';
                if (isWhatsApp) {
                  const recipient = payload.recipient || payload.phone || (lead ? lead.phone : 'Client');
                  const messageText = payload.message || payload.text || 'Message text not specified';
                  previewHtml = `
                    <div class="action-chat-bubble">
                      <div style="font-size: 11px; font-weight: 600; color: var(--color-mid-gray); margin-bottom: 4px; display: flex; justify-content: space-between;">
                        <span>To: ${this.escapeHtml(recipient)}</span>
                        <span>WhatsApp Outbound</span>
                      </div>
                      <div style="white-space: pre-wrap;">${this.escapeHtml(messageText)}</div>
                    </div>
                  `;
                } else if (isAlert) {
                  const nagList = Array.isArray(payload.dispatched_nags) ? payload.dispatched_nags : [];
                  const firstNag = nagList[0] || {};
                  const nagText = firstNag.nag_copy || payload.nag_copy || payload.message || 'Client query unaddressed';
                  const unalerted = payload.unalerted_aberrations || payload.total_aberrations_detected || nagList.length;

                  previewHtml = `
                    <div class="action-alert-summary">
                      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                        <span style="font-weight: 600; font-size: 12.5px; color: var(--color-ink);">
                          ${this.escapeHtml(leadName)} &bull; ${firstNag.aberration_type || 'Unanswered Query'}
                        </span>
                        <span class="badge" style="background: var(--color-danger-light); color: var(--color-danger); font-size: 10.5px;">
                          ${firstNag.severity || 'HIGH'} PRIORITY
                        </span>
                      </div>
                      <div style="font-size: 12.5px; line-height: 1.5; color: var(--color-ink); white-space: pre-wrap; font-family: inherit;">
                        ${this.escapeHtml(nagText)}
                      </div>
                      ${unalerted > 1 ? `
                        <div style="font-size: 11px; color: var(--color-mid-gray); margin-top: 6px;">
                          + ${unalerted - 1} other anomaly nag items grouped in this scan batch
                        </div>
                      ` : ''}
                    </div>
                  `;
                } else {
                  const text = payload.text || payload.message || payload.summary || JSON.stringify(payload, null, 2);
                  previewHtml = `<div class="action-payload-box">${this.escapeHtml(text)}</div>`;
                }

                const rawJson = JSON.stringify(payload, null, 2);

                return `
                  <div class="action-item-card" id="action-card-${act.id}">
                    <div class="action-header-row">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="action-badge ${badgeClass}">
                          <span style="display:inline-flex; align-items:center; gap:4px;">${badgeIcon} ${badgeLabel}</span>
                        </span>
                        <strong style="font-size: 13.5px; color: var(--color-ink);">${this.escapeHtml(leadName)}</strong>
                      </div>
                      <span style="font-size: 11px; color: var(--color-mid-gray); font-feature-settings: 'tnum';">
                        ${this.formatRelativeTime ? this.formatRelativeTime(act.created_at) : (act.created_at || 'Just now')}
                      </span>
                    </div>

                    ${previewHtml}

                    <details class="action-details-accordion">
                      <summary>Inspect Technical Payload</summary>
                      <pre>${this.escapeHtml(rawJson)}</pre>
                    </details>

                    <div class="action-btn-group">
                      <button class="action-btn-reject" onclick="App.rejectAction('${act.id}')">
                        ${Icons.close(13)} Reject
                      </button>
                      <button class="action-btn-approve" onclick="App.approveAction('${act.id}')">
                        ${Icons.check(13)} Approve & Execute
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 12px; color: var(--color-mid-gray);">
            ${items.length > 0 ? `${items.length} action(s) awaiting founder authorization` : 'Queue is synchronized'}
          </span>
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.closeModal()">
            Close
          </button>
        </div>
      `;

      this.openModal(html, { size: 'lg' });
    } catch (e) {
      API.showToast('Failed to load action queue: ' + e.message, 'error');
    }
  },

  async approveAction(actionId) {
    const card = document.getElementById(`action-card-${actionId}`);
    if (card) {
      const btns = card.querySelectorAll('button');
      btns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; b.style.pointerEvents = 'none'; });
    }
    try {
      const res = await API.post(`/api/actions/${actionId}/approve`, {});
      const msg = res && res.unchanged ? 'Action already reviewed' : 'Action approved and executed!';
      API.showToast(msg, 'success');
      if (card) {
        card.style.opacity = '0.6';
        card.innerHTML = `<div style="color: var(--color-success); font-weight: 600; font-size: 13px; padding: 12px; text-align: center; display:flex; align-items:center; justify-content:center; gap:5px;">${Icons.check(15)} Approved & Executed</div>`;
      }
      this.checkPendingActionsCount();
    } catch (e) {
      API.showToast('Error approving action: ' + e.message, 'error');
      if (card) {
        const btns = card.querySelectorAll('button');
        btns.forEach(b => { b.disabled = false; b.style.opacity = '1'; b.style.pointerEvents = 'auto'; });
      }
    }
  },

  async rejectAction(actionId) {
    const card = document.getElementById(`action-card-${actionId}`);
    if (card) {
      const btns = card.querySelectorAll('button');
      btns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; b.style.pointerEvents = 'none'; });
    }
    try {
      const res = await API.post(`/api/actions/${actionId}/reject`, {});
      const msg = res && res.unchanged ? 'Action already reviewed' : 'Action rejected';
      API.showToast(msg, 'info');
      if (card) {
        card.style.opacity = '0.6';
        card.innerHTML = `<div style="color: var(--color-danger); font-weight: 600; font-size: 13px; padding: 12px; text-align: center; display:flex; align-items:center; justify-content:center; gap:5px;">${Icons.close(15)} Action Rejected</div>`;
      }
      this.checkPendingActionsCount();
    } catch (e) {
      API.showToast('Error rejecting action: ' + e.message, 'error');
      if (card) {
        const btns = card.querySelectorAll('button');
        btns.forEach(b => { b.disabled = false; b.style.opacity = '1'; b.style.pointerEvents = 'auto'; });
      }
    }
  },

  openCreateAgentModal() {
    const html = `
      <div class="modal-header">
        <h3 style="font-size: 16px; font-weight: 700; margin: 0; display:flex; align-items:center; gap:6px;">${Icons.plus(16)} Register New Autonomous Agent</h3>
        <button class="btn-icon" onclick="App.closeModal()">${Icons.close(16)}</button>
      </div>
      <form onsubmit="App.handleSaveAgent(event)">
        <div class="modal-body">
          <div class="form-group">
            <label class="label">Agent Name</label>
            <input type="text" name="name" class="input" required placeholder="e.g. SOW Solutions Architect" />
          </div>
          <div class="form-group">
            <label class="label">Agent Slug (Unique Identifier)</label>
            <input type="text" name="slug" class="input" required placeholder="e.g. sow_architect" />
          </div>
          <div class="form-group">
            <label class="label">Description</label>
            <input type="text" name="description" class="input" placeholder="Brief summary of agent responsibilities" />
          </div>
          <div class="form-group">
            <label class="label">Model Tier</label>
            <select name="model" class="select">
              <option value="pro">Pro (pro) - Deep Planning & Prototype Coding</option>
              <option value="flash" selected>Flash (flash) - Standard Workflows & Summaries</option>
              <option value="flash_lite">Flash Lite (flash_lite) - Ultra-Fast Triage & Nudges</option>
            </select>
          </div>
          <div class="form-group">
            <label class="label">System Prompt / Core Persona</label>
            <textarea name="system_prompt" class="textarea" rows="4" placeholder="You are Zero7's specialized agent..."></textarea>
          </div>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Create Agent</button>
        </div>
      </form>
    `;
    this.openModal(html);
  },

  async handleSaveAgent(event) {
    event.preventDefault();
    const form = event.target;
    const data = {
      name: form.name.value.trim(),
      slug: form.slug.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      description: form.description.value.trim(),
      model: form.model.value,
      system_prompt: form.system_prompt.value.trim(),
      default_pills: ['@lead.profile', '@transcripts.all'],
      assigned_skills: ['subdomain-provisioner'],
      mcp_servers: ['zero7-crm']
    };

    try {
      await API.post('/api/agents', data);
      API.showToast(`Agent '${data.name}' registered successfully!`, 'success');
      this.closeModal();
      if (this.state.currentView === 'agents') {
        this.renderAgentStudioPage();
      }
    } catch (e) {
      API.showToast('Failed to create agent: ' + e.message, 'error');
    }
  },

  filterLeadsByRep(userId) {
    this.state.filters.assigned_to = userId;
    this.setView('leads');
  },

  openEditUserModal(userId) {
    this.openAddMemberModal(userId);
  },

  onMemberSelectChange(val) {
    const users = this.state.users || [];
    const editUser = val !== 'new' ? users.find(u => u.id === val) : null;
    const isEdit = !!editUser;
    const isSelf = this.state.currentUser?.id === (editUser ? editUser.id : null);

    const titleEl = document.getElementById('member-modal-title');
    const subTitleEl = document.getElementById('member-modal-subtitle');
    const userIdInput = document.getElementById('member-modal-user-id');
    const nameInput = document.getElementById('member-modal-name');
    const phoneInput = document.getElementById('member-modal-phone');
    const emailInput = document.getElementById('member-modal-email');
    const pwdLabel = document.getElementById('member-modal-pwd-label');
    const pwdInput = document.getElementById('member-modal-password');
    const roleSelect = document.getElementById('member-modal-role');
    const submitBtn = document.getElementById('member-modal-submit-btn');

    if (titleEl) titleEl.innerText = isEdit ? `Edit Member: ${editUser.name}` : 'Add Executioner / Team Member';
    if (subTitleEl) subTitleEl.innerText = isEdit ? `Update credentials, contact phone, or system access for ${editUser.name}` : 'Assign consultants and register phone for auto call recording sync';
    if (userIdInput) userIdInput.value = isEdit ? editUser.id : '';
    if (nameInput) nameInput.value = isEdit ? (editUser.name || '') : '';
    if (phoneInput) phoneInput.value = isEdit ? (editUser.phone || '') : '';
    if (emailInput) emailInput.value = isEdit ? (editUser.email || '') : '';
    if (roleSelect) {
      roleSelect.value = isEdit ? (editUser.role || 'member') : 'member';
      roleSelect.disabled = isSelf && editUser?.role === 'admin';
    }
    if (pwdLabel) {
      pwdLabel.innerHTML = `
        ${Icons.lock(14)}
        <span>${isEdit ? 'Update Login Password' : 'Login Password *'}</span>
      `;
    }
    const pwdDesc = document.getElementById('member-modal-pwd-desc');
    if (pwdDesc) {
      pwdDesc.innerText = isEdit
        ? "Type a new password (min 6 characters) to reset this user's credentials, or leave blank to keep existing password unchanged."
        : "Set initial temporary password (min 6 characters) for first login.";
    }
    if (pwdInput) {
      pwdInput.required = !isEdit;
      pwdInput.placeholder = isEdit ? 'Enter new password to change...' : 'Min 6 characters';
      pwdInput.value = '';
      pwdInput.type = 'password';
      const toggleBtn = document.getElementById('member-modal-pwd-toggle');
      if (toggleBtn) toggleBtn.innerHTML = Icons.eye(15);
    }
    if (submitBtn) {
      submitBtn.innerText = isEdit ? 'Save Changes' : 'Add Member';
    }
  },

  onMemberEmailInput(val) {
    const cleanEmail = (val || '').trim().toLowerCase();
    if (!cleanEmail) return;
    const userIdInput = document.getElementById('member-modal-user-id');
    if (!userIdInput || userIdInput.value) return;

    const users = this.state.users || [];
    const matched = users.find(u => (u.email || '').toLowerCase() === cleanEmail);
    if (matched) {
      const picker = document.getElementById('member-select-picker');
      if (picker) {
        picker.value = matched.id;
        this.onMemberSelectChange(matched.id);
        API.showToast(`Existing team member '${matched.name}' detected — switched to edit mode.`, 'info');
      }
    }
  },

  openAddMemberModal(memberIdToEdit = null) {
    const users = this.state.users || [];
    const editUser = memberIdToEdit ? (users.find(u => u.id === memberIdToEdit) || (this.state.currentUser?.id === memberIdToEdit ? this.state.currentUser : null)) : null;
    const isEdit = !!editUser;
    const isAdmin = this.state.currentUser?.role === 'admin';
    const isSelf = this.state.currentUser?.id === (editUser ? editUser.id : null);

    const html = `
      <div class="modal-header">
        <div>
          <h3 id="member-modal-title">
            ${isEdit ? `Edit Member: ${this.escapeHtml(editUser.name)}` : 'Add Executioner / Team Member'}
          </h3>
          <div id="member-modal-subtitle" class="modal-subtitle">
            ${isEdit ? `Update credentials, contact phone, or system access for ${this.escapeHtml(editUser.name)}` : 'Assign consultants and register phone for auto call recording sync'}
          </div>
        </div>
        <button class="modal-close" onclick="App.closeModal()" title="Close">${Icons.close(16)}</button>
      </div>
      <form onsubmit="App.handleAddMember(event)">
        <input type="hidden" name="user_id" id="member-modal-user-id" value="${isEdit ? editUser.id : ''}">
        <div class="modal-body">
          
          ${isAdmin ? `
            <div class="form-group" style="margin-bottom: 16px;">
              <label>Action / Member Selector</label>
              <select id="member-select-picker" class="select" style="width: 100%; margin-top: 6px;" onchange="App.onMemberSelectChange(this.value)">
                <option value="new" ${!isEdit ? 'selected' : ''}>+ Add New Team Member</option>
                ${users.map(u => `
                  <option value="${u.id}" ${editUser && editUser.id === u.id ? 'selected' : ''}>
                    Edit: ${this.escapeHtml(u.name)} (${this.escapeHtml(u.email)})
                  </option>
                `).join('')}
              </select>
            </div>
          ` : ''}

          <div class="form-group">
            <label>Full Name *</label>
            <input type="text" name="name" id="member-modal-name" class="input" value="${this.escapeHtml(editUser?.name || '')}" placeholder="e.g. Akash" required style="margin-top: 6px;">
          </div>

          <div class="form-group" style="margin-top: 14px;">
            <label style="display: flex; justify-content: space-between;">
              <span>Primary Mobile Number</span>
              <span style="font-weight: 400; color: #38bdf8; font-size: 11px;">Auto Call Sync & Internal Discussion Detection</span>
            </label>
            <input type="tel" name="phone" id="member-modal-phone" class="input" value="${this.escapeHtml(editUser?.phone || '')}" placeholder="e.g. 9993963968 or +91 9993963968" style="margin-top: 6px;">
            <p style="font-size: 11.5px; color: var(--color-mid-gray); margin: 5px 0 0 0;">
              Internal sync calls to this number will be archived under Internal Discussions instead of creating client leads.
            </p>
          </div>

          <div class="form-group" style="margin-top: 14px;">
            <label>Email Address *</label>
            <input type="email" name="email" id="member-modal-email" class="input" value="${this.escapeHtml(editUser?.email || '')}" placeholder="akash@zero7.space" required style="margin-top: 6px;" oninput="App.onMemberEmailInput(this.value)">
          </div>

          <div class="form-group" style="margin-top: 16px; background: hsl(var(--muted) / 0.35); border: 1px solid hsl(var(--border)); border-radius: 8px; padding: 14px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label id="member-modal-pwd-label" style="font-weight: 600; font-size: 13px; margin: 0; display: flex; align-items: center; gap: 6px;">
                ${Icons.lock(14)}
                <span>${isEdit ? 'Update Login Password' : 'Login Password *'}</span>
              </label>
              <button type="button" class="btn btn-secondary btn-xs" style="font-size: 11px; padding: 2px 8px; border-radius: 4px;" onclick="App.generateAndFillMemberPassword()">
                ${Icons.sparkles(11)} Generate Strong
              </button>
            </div>
            <p id="member-modal-pwd-desc" style="font-size: 11.5px; color: var(--color-mid-gray); margin: 0 0 8px 0;">
              ${isEdit ? 'Type a new password (min 6 characters) to reset this user\'s credentials, or leave blank to keep existing password unchanged.' : 'Set initial temporary password (min 6 characters) for first login.'}
            </p>
            <div class="password-input-wrap">
              <input type="password" name="password" id="member-modal-password" class="input" placeholder="${isEdit ? 'Enter new password to change...' : 'Min 6 characters'}" ${isEdit ? '' : 'required'} style="padding-right: 40px; width: 100%; font-family: monospace;">
              <button type="button" id="member-modal-pwd-toggle" class="password-toggle-btn" onclick="App.togglePasswordVisibility('member-modal-password', 'member-modal-pwd-toggle')" title="Show / Hide Password">
                ${Icons.eye(15)}
              </button>
            </div>
          </div>

          ${isAdmin ? `
            <div class="form-group" style="margin-top: 14px;">
              <label>Role & Access Level *</label>
              <select name="role" id="member-modal-role" class="select" style="width: 100%; margin-top: 6px;" ${isSelf && editUser?.role === 'admin' ? 'disabled title="You cannot demote your own administrator account"' : ''}>
                <option value="member" ${editUser?.role === 'member' || !editUser ? 'selected' : ''}>Consultant / Closer (Assigned queue only)</option>
                <option value="admin" ${editUser?.role === 'admin' ? 'selected' : ''}>Administrator (Full company access & team management)</option>
              </select>
            </div>
          ` : ''}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" id="member-modal-submit-btn" class="btn btn-primary" style="font-weight: 500;">
            ${isEdit ? 'Save Changes' : 'Add Member'}
          </button>
        </div>
      </form>
    `;
    this.openModal(html, { size: 'md' });
  },

  async handleAddMember(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const userId = data.user_id;
    delete data.user_id;

    if (!data.password) {
      delete data.password;
    }

    try {
      if (userId) {
        const updated = await API.put(`/api/users/${userId}`, data);
        API.showToast(`Updated ${updated.name || data.name} successfully!`, 'success');
        if (this.state.currentUser?.id === userId) {
          this.state.currentUser = { ...this.state.currentUser, ...updated };
        }
      } else {
        const res = await API.post('/api/users', data);
        API.showToast(`Saved ${res.name || data.name} to the team!`, 'success');
      }
      this.closeModal();
      await this.loadInitialData();
      if (this.state.currentView === 'team') {
        this.renderTeamPage();
      } else {
        this.render();
      }
    } catch (err) {
      console.error(err);
    }
  },

  openChangePasswordModal(userId) {
    const users = this.state.users || [];
    const targetUser = users.find(u => u.id === userId) || (this.state.currentUser?.id === userId ? this.state.currentUser : null);
    if (!targetUser) {
      API.showToast('User not found', 'error');
      return;
    }

    const initials = (targetUser.name || 'User').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    const html = `
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="user-avatar" style="width: 32px; height: 32px; font-size: 11px; font-weight: 700; background: #3b82f6; color: #fff;">${initials}</div>
          <div>
            <h3 style="margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
              ${Icons.key(15)} Change Password: ${this.escapeHtml(targetUser.name)}
            </h3>
            <div class="modal-subtitle">${this.escapeHtml(targetUser.email)} &bull; ${targetUser.role || 'Member'}</div>
          </div>
        </div>
        <button class="modal-close" onclick="App.closeModal()" title="Close">${Icons.close(16)}</button>
      </div>
      <form onsubmit="App.handleSubmitChangePassword(event, '${targetUser.id}', '${this.escapeHtml(targetUser.name)}')">
        <div class="modal-body" style="padding: 20px 24px;">
          <div style="margin-bottom: 16px; background: rgba(59, 130, 246, 0.06); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; padding: 12px 14px; font-size: 12.5px; color: hsl(var(--foreground)); line-height: 1.5;">
            Update login credentials for <strong>${this.escapeHtml(targetUser.name)}</strong> (${this.escapeHtml(targetUser.email)}). The new password will take effect immediately.
          </div>

          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label style="font-weight: 600; font-size: 13px; margin: 0;">New Password *</label>
              <button type="button" class="btn btn-secondary btn-xs" style="font-size: 11px; padding: 2px 8px; border-radius: 4px;" onclick="App.generateAndFillQuickPassword('quick-new-pwd', 'quick-new-pwd-toggle')">
                ${Icons.sparkles(11)} Generate Strong
              </button>
            </div>
            <div class="password-input-wrap">
              <input type="password" id="quick-new-pwd" class="input" placeholder="Enter new password (min 6 characters)" required minlength="6" style="padding-right: 40px; width: 100%; font-family: monospace;">
              <button type="button" id="quick-new-pwd-toggle" class="password-toggle-btn" onclick="App.togglePasswordVisibility('quick-new-pwd', 'quick-new-pwd-toggle')" title="Show / Hide Password">
                ${Icons.eye(15)}
              </button>
            </div>
            <p style="font-size: 11.5px; color: var(--color-mid-gray); margin-top: 6px;">
              Minimum 6 characters. Once saved, the new password will be copied to your clipboard.
            </p>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" style="font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
            ${Icons.check(14)} Update Password
          </button>
        </div>
      </form>
    `;
    this.openModal(html, { size: 'sm' });
  },

  async handleSubmitChangePassword(e, userId, userName) {
    e.preventDefault();
    const input = document.getElementById('quick-new-pwd');
    const pwd = (input?.value || '').trim();
    if (!pwd || pwd.length < 6) {
      API.showToast('Password must be at least 6 characters long', 'error');
      return;
    }

    try {
      await API.put(`/api/users/${userId}`, { password: pwd });
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(pwd);
          API.showToast(`Password for ${userName} updated & copied to clipboard!`, 'success');
        } else {
          API.showToast(`Password for ${userName} updated successfully!`, 'success');
        }
      } catch (cErr) {
        API.showToast(`Password for ${userName} updated successfully!`, 'success');
      }
      this.closeModal();
    } catch (err) {
      console.error(err);
      API.showToast('Failed to update password: ' + (err.message || 'Server error'), 'error');
    }
  },

  togglePasswordVisibility(inputId, toggleBtnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(toggleBtnId);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (btn) btn.innerHTML = Icons.eyeOff(15);
    } else {
      input.type = 'password';
      if (btn) btn.innerHTML = Icons.eye(15);
    }
  },

  generateAndFillMemberPassword() {
    this.generateAndFillQuickPassword('member-modal-password', 'member-modal-pwd-toggle');
  },

  generateAndFillQuickPassword(inputId = 'quick-new-pwd', toggleBtnId = 'quick-new-pwd-toggle') {
    const input = document.getElementById(inputId);
    if (!input) return;
    const words = ['Zero7', 'Kedia', 'Alpha', 'Prime', 'Titan', 'Apex', 'Falcon', 'Orbit'];
    const randWord = words[Math.floor(Math.random() * words.length)];
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const generated = `${randWord}@${randNum}`;
    input.value = generated;
    input.type = 'text';
    const btn = document.getElementById(toggleBtnId);
    if (btn) btn.innerHTML = Icons.eyeOff(15);
    API.showToast(`Generated secure password: ${generated}`, 'info');
  },

  async handleSaveUser(e, userId) {
    return this.handleAddMember(e);
  },


  async openInternalDiscussionsModal(userId) {
    const user = (this.state.users || []).find(u => u.id === userId);
    if (!user) return;

    const initials = (user.name || 'User').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    this.openModal(`
      <div class="modal-header" style="background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="user-avatar" style="width: 36px; height: 36px; background: #8b5cf6; color: #fff;">${initials}</div>
          <div>
            <h3 style="font-size: 16px; font-weight: 600; color: #fff; margin: 0;">Internal Discussions: ${this.escapeHtml(user.name)}</h3>
            <div style="font-size: 12px; color: var(--color-mid-gray);">${this.escapeHtml(user.phone || 'No phone attached')}</div>
          </div>
        </div>
        <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
      </div>
      <div class="modal-body" style="padding: 30px; text-align: center; color: var(--color-mid-gray);">
        Loading internal discussions...
      </div>
    `);

    try {
      const res = await API.get(`/api/crm/calls/internal?teammate_user_id=${userId}`);
      const calls = res.internal_calls || [];
      const leads = this.state.leads || [];

      const html = `
        <div class="modal-header" style="background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="user-avatar" style="width: 38px; height: 38px; font-size: 14px; font-weight: 700; background: #8b5cf6; color: #fff;">${initials}</div>
            <div>
              <h3 style="font-size: 16px; font-weight: 600; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
                Internal Discussions: ${this.escapeHtml(user.name)}
                <span class="role-badge" style="font-size: 10px; background: rgba(139, 92, 246, 0.2); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.4); padding: 1px 6px;">
                  ${calls.length} Recording${calls.length === 1 ? '' : 's'}
                </span>
              </h3>
              <div style="font-size: 12px; color: var(--color-mid-gray); margin-top: 2px;">
                ${this.escapeHtml(user.phone || 'No phone attached')} • Auto-synchronized & Deepgram transcribed
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <a href="/api/users/${user.id}/drive/open" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 5px;">
              ${Icons.folderOpen(13)} Drive Folder
            </a>
            <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
          </div>
        </div>

        <div class="modal-body" style="padding: 20px 24px; max-height: 72vh; overflow-y: auto;">
          ${calls.length === 0 ? `
            <div style="text-align: center; padding: 48px 20px; color: var(--color-mid-gray);">
              <div style="margin-bottom: 12px; opacity: 0.7;">${Icons.phone(36)}</div>
              <div style="font-size: 15px; font-weight: 500; color: #f4f4f5;">No Recorded Internal Discussions Yet</div>
              <div style="font-size: 12.5px; max-width: 380px; margin: 6px auto 0; line-height: 1.5;">
                When you call or receive calls from <strong>${this.escapeHtml(user.name)}</strong> (${this.escapeHtml(user.phone || 'attach phone first')}), they will automatically sync here with audio playback and transcripts.
              </div>
            </div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 14px;">
              ${calls.map(c => {
                const callDate = c.called_at ? new Date(c.called_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown date';
                const durationLabel = c.recording_duration_secs ? `${Math.floor(c.recording_duration_secs / 60)}m ${c.recording_duration_secs % 60}s` : `${c.duration_minutes || 1} min`;
                return `
                  <div class="internal-discussion-card">
                    <div class="discussion-header-meta">
                      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span class="discussion-topic-pill">${this.escapeHtml(c.outcome || 'Internal Sync')}</span>
                        <span style="font-size: 12.5px; font-weight: 600; color: #f4f4f5;">${callDate}</span>
                        <span style="font-size: 11.5px; color: var(--color-mid-gray);">&bull; ${durationLabel}</span>
                      </div>
                      ${c.recording_drive_url ? `
                        <a href="${c.recording_drive_url}" target="_blank" class="btn btn-secondary btn-xs" style="display: inline-flex; align-items: center; gap: 4px;" title="Open in Google Drive">
                          ${Icons.externalLink ? Icons.externalLink(11) : Icons.folder(11)} Drive Audio
                        </a>
                      ` : ''}
                    </div>

                    ${c.notes ? `
                      <div style="font-size: 13px; color: #e4e4e7; line-height: 1.5; white-space: pre-wrap; margin-bottom: 10px; background: rgba(255, 255, 255, 0.02); padding: 8px 10px; border-radius: 6px; border-left: 3px solid #f19d38;">
                        ${this.escapeHtml(c.notes)}
                      </div>
                    ` : ''}

                    <!-- Audio Player -->
                    ${c.recording_file_name ? `
                      <div class="discussion-audio-row">
                        <audio controls preload="none" src="/api/recordings/${encodeURIComponent(c.recording_file_name)}"></audio>
                      </div>
                    ` : ''}

                    <!-- Deepgram Transcript -->
                    ${c.transcription_text ? `
                      <details style="margin-top: 10px;">
                        <summary style="font-size: 12px; font-weight: 600; color: #38bdf8; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                          ${Icons.fileText(13)} View Deepgram Speech Transcript (Hindi/English)
                        </summary>
                        <div class="discussion-transcript-box">${this.escapeHtml(c.transcription_text)}</div>
                      </details>
                    ` : `
                      <div style="font-size: 11.5px; color: var(--color-mid-gray); margin-top: 8px; font-style: italic;">
                        Transcription processing in background...
                      </div>
                    `}

                    <!-- Multi-Lead Mentions & Tagging -->
                    <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.06); display: flex; flex-direction: column; gap: 8px;">
                      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                          <span style="font-size: 11px; font-weight: 600; color: #a1a1aa;">Discussed Leads:</span>
                          ${(c.lead_mentions && c.lead_mentions.length > 0) ? c.lead_mentions.map(m => `
                            <span style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 6px; padding: 2px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 6px;">
                              <span style="cursor: pointer; font-weight: 600;" onclick="App.closeModal(); App.openLeadDetailModal('${m.lead_id}')" title="View Lead Profile">
                                ${this.escapeHtml(m.lead_name || m.business_name || 'Lead')}
                              </span>
                              <button type="button" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 0; line-height: 1; font-size: 13px;" onclick="App.handleDeleteInternalMention('${c.id}', '${m.id}', '${userId}')" title="Remove lead mention">&times;</button>
                            </span>
                          `).join('') : `
                            <span style="font-size: 11.5px; color: var(--color-mid-gray); font-style: italic;">General team discussion</span>
                          `}
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                          ${c.transcription_text ? `
                            <button type="button" class="btn btn-secondary btn-xs" style="font-size: 11px; height: 26px; padding: 0 8px; color: #38bdf8;" onclick="App.handleAutoDetectMentions('${c.id}', '${userId}')" title="Auto-detect lead mentions in Deepgram transcript">
                              ⚡ Auto-Detect Leads
                            </button>
                          ` : ''}
                          <select class="select" style="height: 26px; font-size: 11px; width: 150px; padding: 0 6px;" onchange="if(this.value){ App.handleAddInternalMention('${c.id}', this.value, '${userId}'); this.value=''; }">
                            <option value="">+ Tag Lead...</option>
                            ${leads.filter(l => !(c.lead_mentions || []).some(m => m.lead_id === l.id)).map(l => `
                              <option value="${l.id}">
                                ${this.escapeHtml(l.name)} ${l.business_name ? `(${this.escapeHtml(l.business_name)})` : ''}
                              </option>
                            `).join('')}
                          </select>
                        </div>
                      </div>

                      ${(c.lead_mentions && c.lead_mentions.length > 0) ? `
                        <details style="margin-top: 4px;">
                          <summary style="font-size: 11px; color: #94a3b8; cursor: pointer; user-select: none;">
                            View Lead Discussion Summaries & Excerpts (${c.lead_mentions.length})
                          </summary>
                          <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 6px;">
                            ${c.lead_mentions.map(m => `
                              <div style="background: rgba(255, 255, 255, 0.02); border-left: 2px solid #38bdf8; padding: 6px 10px; border-radius: 4px; font-size: 11.5px;">
                                <div style="font-weight: 600; color: #f4f4f5; display: flex; justify-content: space-between;">
                                  <span>${this.escapeHtml(m.lead_name || 'Lead')} — ${this.escapeHtml(m.topic || 'Strategy')}</span>
                                  <span style="color: #a1a1aa; font-size: 10.5px;">${m.time_offset_end ? `${Math.floor(m.time_offset_start/60)}m - ${Math.floor(m.time_offset_end/60)}m` : ''}</span>
                                </div>
                                ${m.notes ? `<div style="color: #cbd5e1; margin-top: 2px;">${this.escapeHtml(m.notes)}</div>` : ''}
                                ${m.transcript_excerpt ? `<div style="color: #94a3b8; font-style: italic; margin-top: 4px; font-size: 11px;">"${this.escapeHtml(m.transcript_excerpt.substring(0, 160))}..."</div>` : ''}
                                ${m.action_items ? `<div style="color: #34d399; margin-top: 3px; font-size: 11px;">✓ Action: ${this.escapeHtml(m.action_items)}</div>` : ''}
                              </div>
                            `).join('')}
                          </div>
                        </details>
                      ` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <div class="modal-footer" style="padding: 12px 24px; background: rgba(255, 255, 255, 0.02); border-top: 1px solid rgba(255, 255, 255, 0.08); display: flex; justify-content: flex-end;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Close</button>
        </div>
      `;
      this.openModal(html);
    } catch (err) {
      console.error('Failed to load internal discussions:', err);
      API.showToast('Failed to load internal discussions: ' + err.message, 'error');
    }
  },

  async handleAddInternalMention(callId, leadId, teammateUserId) {
    if (!leadId) return;
    try {
      await API.post(`/api/crm/calls/internal/${callId}/mentions`, { lead_id: leadId });
      API.showToast('Tagged lead to discussion!', 'success');
      await this.loadInitialData();
      if (teammateUserId) {
        this.openInternalDiscussionsModal(teammateUserId);
      }
    } catch (err) {
      console.error(err);
      API.showToast('Failed to tag lead: ' + err.message, 'error');
    }
  },

  async handleDeleteInternalMention(callId, mentionId, teammateUserId) {
    if (!confirm('Remove this lead mention from this internal discussion?')) return;
    try {
      await API.delete(`/api/crm/calls/internal/${callId}/mentions/${mentionId}`);
      API.showToast('Removed lead mention.', 'success');
      await this.loadInitialData();
      if (teammateUserId) {
        this.openInternalDiscussionsModal(teammateUserId);
      }
    } catch (err) {
      console.error(err);
      API.showToast('Failed to remove mention: ' + err.message, 'error');
    }
  },

  async handleAutoDetectMentions(callId, teammateUserId) {
    try {
      API.showToast('Analyzing transcript for lead mentions...', 'info');
      const res = await API.post(`/api/crm/calls/internal/${callId}/auto-segment`, {});
      if (res.total_detected > 0) {
        API.showToast(`Auto-detected ${res.total_detected} lead mentions!`, 'success');
      } else {
        API.showToast('No new lead mentions detected in transcript.', 'info');
      }
      await this.loadInitialData();
      if (teammateUserId) {
        this.openInternalDiscussionsModal(teammateUserId);
      }
    } catch (err) {
      console.error(err);
      API.showToast('Auto-detection failed: ' + err.message, 'error');
    }
  },

  async handleLinkInternalCallToLead(callId, leadId, teammateUserId) {
    try {
      await API.put(`/api/crm/calls/internal/${callId}/link-lead`, { lead_id: leadId || null });
      API.showToast(leadId ? 'Linked discussion to client lead successfully!' : 'Unlinked lead from discussion.', 'success');
      await this.loadInitialData();
      if (teammateUserId) {
        this.openInternalDiscussionsModal(teammateUserId);
      }
    } catch (err) {
      console.error(err);
      API.showToast('Failed to update lead link: ' + err.message, 'error');
    }
  },

  async handleUpdateUserRole(userId, newRole) {
    try {
      await API.put(`/api/users/${userId}`, { role: newRole });
      API.showToast('Role updated successfully', 'success');
      await this.loadInitialData();
      this.render();
    } catch (err) {
      console.error(err);
    }
  },

  async handleDeleteUser(userId, userName) {
    if (!confirm(`Are you sure you want to remove ${userName}? Their assigned leads and deals will be unassigned.`)) return;
    try {
      await API.delete(`/api/users/${userId}`);
      API.showToast(`Removed ${userName}`, 'info');
      await this.loadInitialData();
      this.render();
    } catch (err) {
      console.error(err);
    }
  },

  // ---------------- MODALS & HELPERS ----------------

  openAddLeadModal() {
    const html = `
      <div class="modal-header">
        <h3 style="font-size: 16px; font-weight: 600;">Add New Lead</h3>
        <button class="modal-close" onclick="App.closeModal()" title="Close">${Icons.close(16)}</button>
      </div>
      <form onsubmit="App.handleAddLead(event)">
        <div class="modal-body">
          <div class="form-group">
            <label>Contact Person Name *</label>
            <input type="text" name="name" class="input" placeholder="e.g. Vikram Malhotra" required>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
            <div class="form-group">
              <label>Business / Brand Name</label>
              <input type="text" name="business_name" class="input" placeholder="e.g. Malhotra Technologies">
            </div>
            <div class="form-group">
              <label>City / Location</label>
              <input type="text" name="city" class="input" placeholder="e.g. Mumbai, Bengaluru">
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
            <div class="form-group">
              <label>Phone Number</label>
              <input type="tel" name="phone" class="input" placeholder="+91 98765 43210">
            </div>
            <div class="form-group">
              <label>Email Address</label>
              <input type="email" name="email" class="input" placeholder="vikram@example.com">
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 12px;">
            <div class="form-group">
              <label>Website URL</label>
              <input type="url" name="website" class="input" placeholder="https://example.com">
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
            <div class="form-group">
              <label>Acquisition Source</label>
              <select name="source" class="select" style="width: 100%;">
                <option value="meta_ads">Meta Ads</option>
                <option value="scraping">Lead Scraping</option>
                <option value="manual" selected>Manual Outreach</option>
                <option value="referral">Referral</option>
                <option value="website">Website Form</option>
                <option value="linkedin">LinkedIn</option>
              </select>
            </div>
            <div class="form-group">
              <label>Temperature</label>
              <select name="temperature" class="select" style="width: 100%;">
                <option value="hot">Hot</option>
                <option value="warm" selected>Warm</option>
                <option value="cold">Cold</option>
              </select>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 12px;">
            <div class="form-group">
              <label>Priority</label>
              <select name="priority" class="select" style="width: 100%;">
                <option value="unexplored" selected>Unexplored</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>
            </div>
            <div class="form-group">
              <label>Est. Deal Value (₹)</label>
              <input type="number" name="deal_value" class="input" placeholder="50000" min="0">
            </div>
            <div class="form-group">
              <label>Assign To Consultant</label>
              <select name="assigned_to" class="select" style="width: 100%;">
                <option value="">Unassigned (Queue)</option>
                ${this.state.users.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Lead</button>
        </div>
      </form>
    `;
    this.openModal(html, { size: 'md' });
  },

  async handleAddLead(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    if (data.deal_value) data.deal_value = parseFloat(data.deal_value);
    if (!data.assigned_to) delete data.assigned_to;

    try {
      const created = await API.post('/api/leads', data);
      API.showToast('Lead created successfully', 'success');
      this.closeModal();
      await this.loadInitialData();
      this.viewLead(created.id);
    } catch (err) {
      console.error(err);
    }
  },

  openAddDealModal() {
    const html = `
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display:inline-flex; align-items:center; color: var(--color-ink);">${Icons.briefcase(18)}</span>
          <h3 style="font-size: 16px; font-weight: 600; margin: 0;">Record Closed Client Deal</h3>
        </div>
        <button class="modal-close" onclick="App.closeModal()" title="Close">${Icons.close(16)}</button>
      </div>
      <form onsubmit="App.handleAddDeal(event)">
        <div class="modal-body" style="padding: 18px 20px;">
          <div class="form-group" style="margin-bottom: 12px;">
            <label>Project / Deal Title *</label>
            <input type="text" name="title" class="input" placeholder="e.g. Inventory Management System, AI Automation Suite..." required>
          </div>

          <div class="form-group" style="margin-bottom: 12px;">
            <label>Associate with Client Lead</label>
            <select name="lead_id" class="select" style="width: 100%;" onchange="App.handleLeadSelectForDeal(this.value)">
              <option value="">None / Standalone Contract</option>
              ${this.state.leads.map(l => `
                <option value="${l.id}">${l.business_name || l.name} (${l.name} &bull; ${l.city || 'No City'})</option>
              `).join('')}
            </select>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <div class="form-group">
              <label>Total Contract Value (₹) *</label>
              <input type="number" name="value" id="new-deal-value" class="input" placeholder="300000" min="0" required>
            </div>
            <div class="form-group">
              <label>Advance Payment Collected (₹)</label>
              <input type="number" name="amount_received" class="input" placeholder="150000" min="0">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <div class="form-group">
              <label>Delivery Stage</label>
              <select name="delivery_stage" class="select">
                <option value="kickoff">Kickoff & Scope</option>
                <option value="in_development" selected>In Engineering</option>
                <option value="staging_uat">Staging & UAT</option>
                <option value="completed">Delivered & Live</option>
                <option value="maintenance">Retainer & AMC</option>
              </select>
            </div>
            <div class="form-group">
              <label>Target Delivery Date</label>
              <input type="date" name="target_delivery_date" class="input">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <div class="form-group">
              <label style="display:flex; align-items:center; gap:4px;">${Icons.github(13)} GitHub Repo URL (optional)</label>
              <input type="url" name="github_repo_url" class="input" placeholder="https://github.com/org/repo">
            </div>
            <div class="form-group">
              <label style="display:flex; align-items:center; gap:4px;">${Icons.monitor(13)} Staging / Demo URL (optional)</label>
              <input type="text" name="demo_url" class="input" placeholder="https://demo.vercel.app">
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 12px;">
            <label>Assign To Consultant</label>
            <select name="assigned_to" class="select" style="width: 100%;">
              ${this.state.users.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Contract Scope / Notes</label>
            <textarea name="notes" class="input" rows="2" placeholder="Agreed scope, deliverables, key terms..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save & Open Delivery Hub</button>
        </div>
      </form>
    `;
    this.openModal(html, { size: 'lg' });
  },

  handleLeadSelectForDeal(leadId) {
    if (!leadId) return;
    const lead = this.state.leads.find(l => l.id === leadId);
    if (!lead) return;
    const valInput = document.getElementById('new-deal-value');
    if (valInput && !valInput.value && lead.deal_value) {
      valInput.value = lead.deal_value;
    }
  },

  async handleAddDeal(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    if (data.value) data.value = parseFloat(data.value);
    if (data.amount_received) data.amount_received = parseFloat(data.amount_received);
    if (!data.lead_id) delete data.lead_id;

    try {
      const deal = await API.post('/api/deals', data);
      API.showToast('Client Deal created successfully!', 'success');
      this.closeModal();
      await this.loadInitialData();
      this.renderDealsView();
      if (deal && deal.id) {
        this.viewDeal(deal.id);
      }
    } catch (err) {
      console.error(err);
      API.showToast('Failed to create deal', 'error');
    }
  },

  selectOutcome(btn, outcome) {
    document.querySelectorAll('#quick-outcome-pills .outcome-pill').forEach(el => {
      el.classList.remove('selected');
      el.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('selected');
    btn.setAttribute('aria-checked', 'true');
    const input = document.getElementById('selected-outcome');
    if (input) input.value = outcome;
    const flow = this.CALL_OUTCOMES[outcome];
    const hint = document.getElementById('outcome-hint');
    if (hint && flow) {
      const attempt = this.getCallAttempts(this.state.selectedLead) + 1;
      hint.textContent = outcome === 'DNP' ? `Attempt ${attempt}. ${flow.hint}${attempt >= 6 ? ' After 6 tries, consider Not interested.' : ''}` : flow.hint;
    }
    const notes = btn.form?.querySelector('[name="notes"]');
    if (notes) notes.placeholder = flow?.connected ? 'What was discussed, objections, what they asked for…' : 'Optional note, e.g. switched off, asked to call after 5';
    // No talk time or recording for a call that did not connect.
    btn.form?.classList.toggle('is-missed-call', !!flow && !flow.connected);
  },

  toggleChannelCard(cardId) {
    const body = document.getElementById(cardId + '-body');
    const arrow = document.getElementById(cardId + '-arrow');
    if (body && arrow) {
      if (body.style.display === 'none') {
        body.style.display = '';
        arrow.style.transform = 'rotate(0deg)';
      } else {
        body.style.display = 'none';
        arrow.style.transform = 'rotate(-90deg)';
      }
    }
  },

  renderCreativeAreaContent(lead, ch, cardId) {
    const creative = ch.creative || {};
    const thumbUrl = creative.thumbnail_url || creative.image_url;
    const ad = ch.ad_name || lead.meta_ad_name || 'Lead Ad';
    const campaign = ch.campaign_name || 'Standard Meta Campaign';
    const platform = ch.platform ? (ch.platform.toLowerCase().includes('instagram') ? 'Instagram' : 'Facebook') : 'Meta Ads';
    const isVideo = creative.is_video !== false;
    const driveUrl = creative.web_view_link || 'https://drive.google.com/drive/folders/1dwX-XZ9QqH5IXKVKhn9_NCvbiDqTUNjj';
    const adId = ch.ad_id || '';

    if (thumbUrl) {
      return `
        <div class="creative-preview-box">
          <div class="creative-thumb-wrapper" onclick="App.openCreativeModal('${lead.id}')" title="Hover to magnify • Click to play/view">
            <img src="${this.escapeHtml(thumbUrl)}" class="creative-thumb-img" alt="Ad Creative">
            ${isVideo ? `<div class="creative-video-badge" style="display:inline-flex; align-items:center; justify-content:center;">${Icons.play(10)}</div>` : ''}
            
            <!-- Hover Magnification Popover -->
            <div class="creative-hover-preview">
              <img src="${this.escapeHtml(thumbUrl)}" class="creative-hover-preview-media" alt="Ad Creative Preview">
              <div class="creative-hover-preview-footer">
                <span style="display:inline-flex; align-items:center; gap:4px;">${isVideo ? Icons.video(12) + ' Video Creative' : Icons.image(12) + ' Graphic Ad'}</span>
                <span style="font-weight: 600; color: var(--color-ink);">Click to enlarge &rarr;</span>
              </div>
            </div>
          </div>

          <div class="creative-info">
            <div class="creative-title" title="${this.escapeHtml(creative.title || ad)}">${this.escapeHtml(creative.title || ad)}</div>
            <div class="creative-subtitle">
              <span>${this.escapeHtml(platform)}</span>
              <span>•</span>
              <span>${this.escapeHtml(campaign)}</span>
              ${creative.filename ? `<span>•</span> <span style="font-family: monospace; font-size: 11px;">${this.escapeHtml(creative.filename)}</span>` : ''}
            </div>
            <div class="creative-actions">
              <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px;" onclick="App.openCreativeModal('${lead.id}')">
                ${isVideo ? `<span style="display:inline-flex; align-items:center; gap:4px;">${Icons.play(11)} Play Video</span>` : `<span style="display:inline-flex; align-items:center; gap:4px;">${Icons.search(11)} View Creative</span>`}
              </button>
              <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px;" onclick="window.open('${driveUrl}', '_blank')">
                <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.folder(11)} Open in Drive</span>
              </button>
              <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px;" onclick="App.uploadCreativeForLead('${lead.id}', '${this.escapeHtml(ad)}')">
                <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.upload(11)} Replace Asset</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    // Fallback state when creative is not yet in Drive
    return `
      <div class="creative-preview-box">
        <div class="creative-thumb-wrapper" onclick="App.uploadCreativeForLead('${lead.id}', '${this.escapeHtml(ad)}')" title="Click to upload ad video or image to Drive">
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; color: var(--color-mid-gray);">
            ${Icons.image(22)}
            <span style="font-size: 9px; font-weight: 600; margin-top: 2px;">DRIVE</span>
          </div>
          <!-- Hover Magnification Popover -->
          <div class="creative-hover-preview">
            <div style="height: 140px; display:flex; flex-direction:column; align-items:center; justify-content:center; background: var(--color-surface-alt); color: var(--color-mid-gray); padding: 16px; text-align: center;">
              <span style="font-size: 28px; margin-bottom: 6px; display:inline-flex; align-items:center; justify-content:center; color: var(--color-mid-gray);">${Icons.folder(28)}</span>
              <div style="font-weight: 600; font-size: 12px; color: var(--color-ink);">Google Drive Creative Storage</div>
              <div style="font-size: 11px; margin-top: 4px; color: var(--color-mid-gray);">Click to select and upload video/image directly to Drive</div>
            </div>
            <div class="creative-hover-preview-footer">
              <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.folder(12)} Meta Ad Creatives</span>
              <span style="font-weight: 600; color: var(--color-ink);">Click to upload &rarr;</span>
            </div>
          </div>
        </div>

        <div class="creative-info">
          <div class="creative-title" title="${this.escapeHtml(ad)}">${this.escapeHtml(ad)}</div>
          <div class="creative-subtitle">
            <span>${this.escapeHtml(platform)}</span>
            <span>•</span>
            <span>${this.escapeHtml(campaign)}</span>
          </div>
          <div class="creative-actions">
            <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px;" onclick="window.open('${driveUrl}', '_blank')">
              <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.folder(11)} Open Drive Folder</span>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px;" onclick="App.uploadCreativeForLead('${lead.id}', '${this.escapeHtml(ad)}')">
              <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.upload(11)} Upload Creative</span>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px;" onclick="App.fetchAdCreative('${lead.id}', '${adId}', '${cardId}', '${this.escapeHtml(ad)}')" title="Scan Google Drive for matching files">
              <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.refresh(11)} Sync Drive</span>
            </button>
          </div>
        </div>
      </div>
    `;
  },

  async fetchAdCreative(leadId, adId, cardId, adName = '') {
    const creativeArea = document.getElementById(cardId + '-creative-area');
    if (!creativeArea) return;
    
    creativeArea.innerHTML = `
      <div class="creative-preview-box" style="justify-content: center; padding: 16px;">
        <div style="text-align: center; color: var(--color-mid-gray); font-size: 12px;">
          <span class="spinner-sm" style="display:inline-block;width:14px;height:14px;border:2px solid var(--color-hairline);border-top-color:var(--color-ink);border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></span>
          Checking Google Drive for matching creative…
        </div>
      </div>
    `;

    try {
      const q = new URLSearchParams();
      if (leadId) q.set('lead_id', leadId);
      if (adName) q.set('ad_name', adName);
      const res = await fetch(`/api/meta/ad-creative/${adId || 'lookup'}?${q.toString()}`, {
        headers: { 'Authorization': 'Bearer ' + this.state.token }
      });
      const data = await res.json();
      
      if (data.status === 'success' && data.creative) {
        const cr = data.creative;
        if (this.state.selectedLead && this.state.selectedLead.id === leadId) {
          if (!this.state.selectedLead.channel_data) this.state.selectedLead.channel_data = {};
          this.state.selectedLead.channel_data.creative = cr;
        }

        // Update card header thumbnail
        const header = creativeArea.closest('.channel-intelligence-card')?.querySelector('.channel-card-header');
        const thumbUrl = cr.thumbnail_url || cr.image_url;
        if (header && thumbUrl) {
          const tagSpan = header.querySelector('.channel-source-tag');
          if (tagSpan && !header.querySelector('.header-thumb-mini')) {
            tagSpan.insertAdjacentHTML('beforebegin', 
              `<img src="${this.escapeHtml(thumbUrl)}" class="header-thumb-mini" style="width:24px;height:24px;border-radius:4px;object-fit:cover;border:1px solid var(--color-hairline);" alt="Ad">`
            );
          }
        }

        const lead = this.state.selectedLead || { id: leadId };
        const ch = lead.channel_data || {};
        creativeArea.innerHTML = this.renderCreativeAreaContent(lead, ch, cardId);
        API.showToast('Creative loaded from Google Drive!', 'success');
      } else {
        const lead = this.state.selectedLead || { id: leadId };
        const ch = lead.channel_data || {};
        creativeArea.innerHTML = this.renderCreativeAreaContent(lead, ch, cardId);
        API.showToast('Asset not found in Drive yet. You can upload it or drop it in Drive.', 'info');
      }
    } catch (err) {
      console.error(err);
      const lead = this.state.selectedLead || { id: leadId };
      const ch = lead.channel_data || {};
      creativeArea.innerHTML = this.renderCreativeAreaContent(lead, ch, cardId);
    }
  },

  openCreativeModal(leadId) {
    const lead = (this.state.selectedLead && this.state.selectedLead.id === leadId) 
      ? this.state.selectedLead 
      : (this.state.leads || []).find(l => l.id === leadId);
    if (!lead) return;

    const ch = typeof lead.channel_data === 'string' ? JSON.parse(lead.channel_data || '{}') : (lead.channel_data || {});
    const creative = ch.creative || {};
    const thumbUrl = creative.thumbnail_url || creative.image_url;
    const isVideo = creative.is_video !== false;
    const previewLink = creative.preview_link || (creative.file_id ? `https://drive.google.com/file/d/${creative.file_id}/preview` : '');
    const driveUrl = creative.web_view_link || 'https://drive.google.com/drive/folders/1At6p6N0vqrXmkNXfTk1GpoCfWtxFQ_AX';
    const title = creative.title || ch.ad_name || lead.meta_ad_name || 'Ad Creative';
    const formAnswers = ch.form_answers || [];

    const modalHtml = `
      <div class="modal-header">
        <div>
          <h2 style="font-size: 16px; font-weight: 700; margin: 0; color: var(--color-ink);">${this.escapeHtml(title)}</h2>
          <div style="font-size: 12px; color: var(--color-mid-gray); margin-top: 2px;">
            ${this.escapeHtml(ch.campaign_name || 'Meta Campaign')} · ${this.escapeHtml(ch.adset_name || 'Ad Set')}
          </div>
        </div>
        <button class="modal-close" onclick="App.closeModal()" title="Close">${Icons.close(16)}</button>
      </div>
      <div class="modal-body" style="padding: 20px;">
        ${previewLink ? `
          <div style="position: relative; width: 100%; border-radius: 8px; overflow: hidden; background: #000; margin-bottom: 16px;">
            <iframe src="${previewLink}" width="100%" height="420" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="border: none; display: block;"></iframe>
          </div>
        ` : (thumbUrl ? `
          <div style="text-align: center; margin-bottom: 16px; background: #0f172a; border-radius: 8px; padding: 12px;">
            <img src="${this.escapeHtml(thumbUrl)}" style="max-width: 100%; max-height: 440px; border-radius: 6px; object-fit: contain;" alt="Ad Creative">
          </div>
        ` : '')}

        <div style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
          <a href="${driveUrl}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none;">
            ${Icons.folder(13)} View on Google Drive ${Icons.externalLink(12)}
          </a>
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.closeModal(); App.uploadCreativeForLead('${lead.id}', '${this.escapeHtml(title)}')">
            <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.upload(12)} Replace / Upload New Asset</span>
          </button>
        </div>

        ${creative.body ? `
          <div style="background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">
            <div style="font-size: 11px; font-weight: 600; color: var(--color-mid-gray); margin-bottom: 4px; text-transform: uppercase;">Ad Copy & Text</div>
            <div style="font-size: 13px; line-height: 1.5; color: var(--color-ink); white-space: pre-wrap;">${this.escapeHtml(creative.body)}</div>
          </div>
        ` : ''}

        ${formAnswers.length > 0 ? `
          <div style="background: var(--color-surface-alt); border: 1px solid var(--color-hairline); border-radius: 8px; padding: 12px 14px;">
            <div style="font-size: 11px; font-weight: 600; color: var(--color-mid-gray); margin-bottom: 8px; text-transform: uppercase;">Lead Form Responses</div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${formAnswers.map(a => `
                <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 12px; border-bottom: 1px dashed var(--color-hairline); padding-bottom: 4px;">
                  <span style="color: var(--color-mid-gray);">${this.escapeHtml(a.question || a.field_key || '')}</span>
                  <span style="font-weight: 600; color: var(--color-ink); text-align: right;">${this.escapeHtml(Array.isArray(a.values) ? a.values.join(', ') : a.answer || a.values || 'N/A')}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>
      </div>
    `;

    this.openModal(modalHtml, { size: 'lg' });
  },

  uploadCreativeForLead(leadId, adName = '') {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'video/*,image/*';
    fileInput.style.display = 'none';

    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      API.showToast(`Uploading ${file.name} to Google Drive…`, 'info');

      const formData = new FormData();
      formData.append('file', file);
      if (leadId) formData.append('lead_id', leadId);
      if (adName) formData.append('ad_name', adName);

      try {
        const resp = await fetch('/api/creatives/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + this.state.token },
          body: formData
        });
        const res = await resp.json();

        if (resp.ok && res.status === 'success' && res.creative) {
          API.showToast('Creative successfully uploaded to Google Drive!', 'success');
          if (this.state.selectedLead && this.state.selectedLead.id === leadId) {
            if (!this.state.selectedLead.channel_data) this.state.selectedLead.channel_data = {};
            this.state.selectedLead.channel_data.creative = res.creative;
            this.renderLeadDetailPage();
          }
        } else {
          API.showToast(res.detail || 'Upload to Drive failed', 'error');
        }
      } catch (err) {
        console.error(err);
        API.showToast('Error uploading creative: ' + err.message, 'error');
      }
    };

    document.body.appendChild(fileInput);
    fileInput.click();
    setTimeout(() => {
      if (fileInput.parentNode) document.body.removeChild(fileInput);
    }, 2000);
  },


  async triggerWebhookTest() {
    try {
      const cities = ['Bengaluru', 'Mumbai', 'Delhi NCR', 'Pune', 'Hyderabad', 'Ahmedabad'];
      const randomCity = cities[Math.floor(Math.random() * cities.length)];
      const sampleLead = {
        name: `Meta Lead ${Math.floor(1000 + Math.random() * 9000)}`,
        business_name: 'Inbound Meta Brand',
        city: randomCity,
        temperature: 'warm',
        call_stage: 'uncontacted',
        priority: 'unexplored',
        phone: '+91 98' + Math.floor(10000000 + Math.random() * 90000000),
        email: `lead${Date.now()}@meta-inbound.com`,
        ad_name: 'Zero7 Growth Advisory Ad'
      };

      await API.post('/api/webhooks/meta-leads', sampleLead);
      API.showToast('Meta Lead simulated & ingested live!', 'success');
      await this.loadInitialData();
      if (this.state.currentView === 'leads') {
        this.renderLeadsView();
      }
    } catch (err) {
      console.error(err);
    }
  },

  openModal(html, options = {}) {
    let container = document.getElementById('modal-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'modal-container';
      document.body.appendChild(container);
    }

    let content = String(html || '').trim();
    // Normalize if caller accidentally passed full .modal-backdrop
    if (content.includes('class="modal-backdrop"') || content.startsWith('<div class="modal-backdrop"')) {
      const temp = document.createElement('div');
      temp.innerHTML = content;
      const inner = temp.querySelector('.modal-card, .modal-content, .modal') || temp.firstElementChild;
      if (inner) content = inner.innerHTML;
    }

    const sizeClass = options.size ? `modal-${options.size}` : '';

    container.innerHTML = `
      <div class="modal-backdrop" id="app-modal-backdrop">
        <div class="modal modal-content ${sizeClass}" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          ${content}
        </div>
      </div>
    `;

    document.body.classList.add('modal-open');

    const backdrop = container.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          App.closeModal();
        }
      });
      setTimeout(() => backdrop.classList.add('open'), 10);
    }

    if (!this._modalEscapeAttached) {
      this._modalEscapeAttached = true;
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const bd = document.querySelector('.modal-backdrop');
          if (bd) App.closeModal();
        }
      });
    }

    setTimeout(() => {
      const firstInput = container.querySelector('input:not([type="hidden"]), select, textarea');
      if (firstInput) {
        firstInput.focus();
      }
    }, 60);
  },

  closeModal() {
    this.closeComposeMailModal();
    this.closeMailPreviewModal();
    document.body.classList.remove('modal-open');
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      setTimeout(() => {
        const container = document.getElementById('modal-container');
        if (container) container.innerHTML = '';
      }, 180);
    }
    if (window.location.hash && window.location.hash.startsWith('#/deals/')) {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', '#/deals');
      }
    }
  },

  _normalizeIso(dateStr) {
    if (!dateStr) return null;
    let s = String(dateStr).trim();
    if (!s) return null;
    if (s.includes(' ') && !s.includes('T')) {
      s = s.replace(' ', 'T');
    }
    // If string lacks timezone offset (Z, +XX:XX, -XX:XX), append 'Z' so it's treated as UTC
    if (!s.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(s)) {
      s += 'Z';
    }
    return s;
  },

  formatDateTime(dateStr) {
    const s = this._normalizeIso(dateStr);
    if (!s) return 'N/A';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return dateStr;
    }
  },

  formatRelativeTime(dateStr) {
    const s = this._normalizeIso(dateStr);
    if (!s) return '';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return '';
      const now = new Date();
      const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
      if (diff < 0) return 'Just now';
      if (diff < 60) return 'Just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      if (diff < 172800) return 'Yesterday';
      if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    } catch (e) {
      return '';
    }
  },

  formatDate(dateStr) {
    return this.formatRelativeTime(dateStr) || this.formatDateTime(dateStr);
  },

  getStatusBadge(status) {
    const st = (status || 'new').toLowerCase();
    const map = {
      'new': { cls: 'badge-new', label: 'New' },
      'contacted': { cls: 'badge-contacted', label: 'Contacted' },
      'qualified': { cls: 'badge-qualified', label: 'Qualified' },
      'proposal': { cls: 'badge-proposal', label: 'Proposal' },
      'won': { cls: 'badge-won', label: 'Won' },
      'lost': { cls: 'badge-lost', label: 'Lost' }
    };
    const item = map[st] || { cls: 'badge-new', label: status };
    return `<span class="badge ${item.cls}">${item.label}</span>`;
  },

  getPriorityBadge(priority) {
    const p = (priority || 'unexplored').toLowerCase();
    const map = {
      'high': { label: 'High', bg: 'var(--color-danger-light)', color: 'var(--color-danger)', border: 'rgba(239, 68, 68, 0.2)' },
      'medium': { label: 'Medium', bg: 'var(--color-warning-light)', color: 'var(--color-warning)', border: 'rgba(217, 119, 6, 0.2)' },
      'low': { label: 'Low', bg: 'var(--color-surface-alt)', color: 'var(--color-mid-gray)', border: 'var(--color-hairline)' },
      'unexplored': { label: 'Unexplored', bg: 'var(--color-purple-light)', color: 'var(--color-purple)', border: 'rgba(124, 58, 237, 0.2)' },
      'won': { label: 'Won', bg: 'var(--color-success-light)', color: 'var(--color-success)', border: 'rgba(22, 163, 74, 0.2)' },
      'lost': { label: 'Lost', bg: 'var(--color-danger-light)', color: 'var(--color-danger)', border: 'rgba(239, 68, 68, 0.2)' }
    };
    const c = map[p] || map['unexplored'];
    return `<span class="priority-pill" style="background: ${c.bg}; color: ${c.color}; border: 1px solid ${c.border};">
      <span style="width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block;"></span> ${c.label}
    </span>`;
  },

  getTemperatureBadge(temp) {
    const t = (temp || 'warm').toLowerCase();
    if (t === 'hot') {
      return `<span class="badge badge-hot">${Icons.flame(12)} Hot</span>`;
    } else if (t === 'cold') {
      return `<span class="badge badge-cold">${Icons.snowflake(12)} Cold</span>`;
    }
    return `<span class="badge badge-warm">${Icons.flame(12)} Warm</span>`;
  },

  getCallStageBadge(stage) {
    const st = (stage || 'uncontacted').toLowerCase();
    const map = {
      'uncontacted': { bg: 'var(--color-surface-alt)', color: 'var(--color-mid-gray)', label: 'Uncontacted', border: 'var(--color-hairline)' },
      'not_called': { bg: 'var(--color-surface-alt)', color: 'var(--color-mid-gray)', label: 'Not Called', border: 'var(--color-hairline)' },
      'first_call': { bg: 'var(--color-primary-light)', color: 'var(--color-primary)', label: 'First Call', border: 'rgba(24, 24, 27, 0.12)' },
      'follow_up': { bg: 'var(--color-warning-light)', color: 'var(--color-warning)', label: 'Follow-up', border: 'rgba(217, 119, 6, 0.15)' },
      'dnp': { bg: 'var(--color-danger-light)', color: 'var(--color-danger)', label: 'DNP', border: 'rgba(239, 68, 68, 0.15)' },
      'connected': { bg: 'var(--color-success-light)', color: 'var(--color-success)', label: 'Connected', border: 'rgba(22, 163, 74, 0.15)' },
      'interested': { bg: 'var(--color-success-light)', color: 'var(--color-success)', label: 'Interested', border: 'rgba(22, 163, 74, 0.15)' },
      'not_interested': { bg: 'var(--color-surface-alt)', color: 'var(--color-mid-gray)', label: 'Not Interested', border: 'var(--color-hairline)' }
    };
    const item = map[st] || { bg: 'var(--color-surface-alt)', color: 'var(--color-mid-gray)', label: stage || 'Uncontacted', border: 'var(--color-hairline)' };
    return `<span class="stage-pill" style="background: ${item.bg}; color: ${item.color}; border: 1px solid ${item.border};">${item.label}</span>`;
  },

  getSourceBadge(source) {
    const src = (source || 'manual').toLowerCase();
    const labels = {
      'meta_ads': 'Meta Ads',
      'scraping': 'Scraping',
      'manual': 'Manual',
      'referral': 'Referral',
      'website': 'Website',
      'linkedin': 'LinkedIn'
    };
    return `<span class="badge" style="background: var(--color-canvas); color: var(--color-ink-soft); border: 1px solid var(--color-hairline);">${labels[src] || source}</span>`;
  },

  // ─── WhatsApp Conversation Methods ───────────────────

  async loadWhatsAppConversation(leadId, accountPhone = null) {
    try {
      this._waLeadId = leadId;
      const targetAcc = accountPhone !== null ? accountPhone : (this._waSelectedAccount || 'all');
      this._waSelectedAccount = targetAcc;

      const url = `/api/leads/${leadId}/whatsapp?account_phone=${encodeURIComponent(targetAcc)}`;
      const data = await API.get(url);
      if (!data) return;
      this._waData = data;

      // 1. Render account pills with connection dots (green = connected, red = not connected)
      this.renderWhatsAppPills(data.accounts, data.selected_account);

      // 2. Unconditionally render messages from database (even if account is not connected)
      this.renderWhatsAppMessages(data.messages, data.lead_phone, data.selected_account, data.accounts);
    } catch (e) {
      console.error('WA load error:', e);
      const wrap = document.getElementById('wa-account-pills-wrap');
      if (wrap) wrap.innerHTML = `<span style="font-size: 11px; color: #ef4444;">Could not load inboxes: ${e.message || 'Error'}</span>`;
    }
  },

  renderWhatsAppPills(accounts, selectedAccount) {
    const wrap = document.getElementById('wa-account-pills-wrap');
    if (!wrap) return;

    selectedAccount = selectedAccount || this._waSelectedAccount || 'all';
    this._waSelectedAccount = selectedAccount;

    const isAll = selectedAccount === 'all';

    // Deduplicate accounts by 10-digit phone
    const seen = new Set();
    const cleanAccounts = [];
    if (accounts && accounts.length > 0) {
      for (const a of accounts) {
        const p10 = (a.phone_number || '').replace(/\D/g, '').slice(-10);
        if (p10 && !seen.has(p10)) {
          seen.add(p10);
          cleanAccounts.push({ ...a, phone_number: p10 });
        }
      }
    }

    // Calculate total messages across all accounts
    let totalMsgs = 0;
    if (cleanAccounts.length > 0) {
      totalMsgs = cleanAccounts.reduce((sum, a) => sum + (a.message_count || 0), 0);
    } else if (this._waData && this._waData.messages) {
      totalMsgs = this._waData.messages.length;
    }

    let pillsHtml = `
      <button type="button" 
        class="wa-account-pill ${isAll ? 'active' : ''}" 
        onclick="App.switchWhatsAppAccount('all')"
        style="
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px; border-radius: 6px; font-size: 12px;
          cursor: pointer; border: 1px solid ${isAll ? 'hsl(var(--primary))' : 'hsl(var(--input))'};
          background: ${isAll ? 'hsl(var(--primary))' : 'hsl(var(--background))'};
          color: ${isAll ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))'};
          font-weight: 500;
          transition: all 0.15s ease;
          box-shadow: var(--shadow-xs);
          outline: none;
        "
        title="View unified conversation stream across both inboxes">
        <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.messageCircle(13)} Unified (All Inboxes)</span>
        ${totalMsgs > 0 ? `<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: ${isAll ? 'rgba(128,128,128,0.25)' : 'hsl(var(--muted))'}; color: ${isAll ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))'}; font-weight: 600;">${totalMsgs}</span>` : ''}
      </button>
    `;

    for (const acc of cleanAccounts) {
      const isConnected = acc.is_connected || acc.status === 'connected';
      const isSelected = selectedAccount === acc.phone_number;
      const dotColor = isConnected ? '#16a34a' : '#ef4444';
      const statusTitle = isConnected ? 'Connected (Live Sync Active)' : 'Disconnected (Stored History Only)';
      const count = acc.message_count || 0;
      const isPersonal = acc.phone_number === '9993202900';
      const inboxLabel = isPersonal ? 'Personal Inbox' : 'Central Inbox';
      const icon = isPersonal ? Icons.smartphone(13) : Icons.building(13);

      pillsHtml += `
        <button type="button" 
          class="wa-account-pill ${isSelected ? 'active' : ''}" 
          onclick="App.switchWhatsAppAccount('${acc.phone_number}')"
          style="
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 10px; border-radius: 6px; font-size: 12px;
            cursor: pointer; border: 1px solid ${isSelected ? 'hsl(var(--primary))' : 'hsl(var(--input))'};
            background: ${isSelected ? 'hsl(var(--primary))' : 'hsl(var(--background))'};
            color: ${isSelected ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))'};
            font-weight: 500;
            transition: all 0.15s ease;
            box-shadow: var(--shadow-xs);
            outline: none;
          "
          title="${inboxLabel} (+91 ${acc.phone_number}) — ${statusTitle}">
          <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${dotColor}; flex-shrink: 0;"></span>
          <span>${icon} ${inboxLabel} (${acc.phone_number})</span>
          ${count > 0 ? `<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: ${isSelected ? 'rgba(128,128,128,0.25)' : 'hsl(var(--muted))'}; color: ${isSelected ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))'}; font-weight: 600;">${count}</span>` : ''}
        </button>
      `;
    }

    wrap.innerHTML = pillsHtml;

    // Update status indicator on the right side of the ribbon
    const statusWrap = document.getElementById('wa-sync-status-indicator');
    if (statusWrap) {
      let isLive = false;
      let statusLabel = 'Disconnected';
      if (isAll) {
        isLive = cleanAccounts.some(a => a.is_connected || a.status === 'connected');
        statusLabel = isLive ? 'Live Sync Active' : 'Offline / Stored History';
      } else {
        const cur = cleanAccounts.find(a => a.phone_number === selectedAccount);
        isLive = cur ? (cur.is_connected || cur.status === 'connected') : false;
        statusLabel = isLive ? 'Connected • Live Sync' : 'Not Connected • Stored History';
      }

      statusWrap.innerHTML = `
        <span style="display: inline-flex; align-items: center; gap: 5px; color: ${isLive ? '#00a884' : '#667781'}; font-weight: 500;">
          <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${isLive ? '#16a34a' : '#ef4444'};"></span>
          ${statusLabel}
        </span>
      `;
    }

    // Update header avatar online badge
    const headerBadge = document.getElementById('wa-header-online-badge');
    if (headerBadge) {
      const anyLive = cleanAccounts.some(a => a.is_connected || a.status === 'connected');
      headerBadge.style.background = anyLive ? '#25d366' : '#ef4444';
      headerBadge.title = anyLive ? 'WhatsApp Connected' : 'WhatsApp Disconnected';
    }
  },

  switchWhatsAppAccount(phone) {
    this._waSelectedAccount = phone;
    if (this._waLeadId) {
      this.loadWhatsAppConversation(this._waLeadId, phone);
    }
  },

  renderWhatsAppMessages(messages, leadPhone, selectedAccount, accounts) {
    const container = document.getElementById('wa-chat-container');
    if (!container) return;

    selectedAccount = selectedAccount || this._waSelectedAccount || 'all';

    if (!messages || messages.length === 0) {
      let offlineNote = '';
      if (selectedAccount && selectedAccount !== 'all') {
        const cleanAccounts = accounts || (this._waData ? this._waData.accounts : []);
        const acc = cleanAccounts.find(a => (a.phone_number || '').replace(/\D/g, '').slice(-10) === selectedAccount.replace(/\D/g, '').slice(-10));
        const isConn = acc ? (acc.is_connected || acc.status === 'connected') : false;
        if (!isConn) {
          offlineNote = `<div style="font-size: 11.5px; color: #ef4444; margin-top: 6px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#ef4444;"></span>
            Number is currently disconnected in droplet. Connect in Integrations to sync new messages.
          </div>`;
        }
      }

      container.innerHTML = `
        <div style="text-align: center; padding: 50px 20px; color: #667781;">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto; color: #00a884;">${Icons.messageCircle(26)}</div>
          <div style="font-weight: 600; font-size: 14px; color: #111b21; margin-bottom: 4px;">No WhatsApp Messages Synced Yet</div>
          <div style="font-size: 12px; color: #667781; max-width: 360px; margin: 0 auto; line-height: 1.4;">
            All historical messages in the CRM database are preserved. When connected, any message sent or received with this contact streams here automatically.
          </div>
          ${offlineNote}
        </div>`;
      return;
    }

    let html = '';
    let lastDate = '';
    for (const msg of messages) {
      // Date separator
      const msgDate = msg.timestamp ? new Date(msg.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      if (msgDate && msgDate !== lastDate) {
        html += `
          <div class="wa-date-separator">
            <span class="wa-date-pill">${msgDate}</span>
          </div>`;
        lastDate = msgDate;
      }

      const isOut = msg.direction === 'out' || msg.direction === 'outgoing';
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
      
      // WhatsApp Read receipt ticks
      let ticks = '';
      if (isOut) {
        if (msg.status === 'read') {
          ticks = `<span class="wa-ticks read" title="Read" style="display:inline-flex; align-items:center;">${Icons.checkCheck(14)}</span>`;
        } else if (msg.status === 'delivered') {
          ticks = `<span class="wa-ticks delivered" title="Delivered" style="display:inline-flex; align-items:center;">${Icons.checkCheck(14)}</span>`;
        } else {
          ticks = `<span class="wa-ticks delivered" title="Sent" style="display:inline-flex; align-items:center;">${Icons.check(14)}</span>`;
        }
      }

      // Check if message text is a lead form inquiry
      let contentHtml = '';
      const text = msg.message_text || '';
      const isLeadForm = text.includes('filled in your form') || text.includes('What does your business do?');

      if (msg.message_type === 'video') {
        const videoSrc = msg.media_url || '';
        contentHtml = `
          <div class="wa-media-video-container" style="max-width: 320px; border-radius: 8px; overflow: hidden; margin-bottom: 4px;">
            ${videoSrc ? `
              <video controls preload="metadata" style="width: 100%; border-radius: 8px; background: #000; max-height: 220px; display: block;">
                <source src="${this.escapeHtml(videoSrc)}" type="video/mp4">
              </video>
            ` : `
              <div style="background: #1f2c34; color: #fff; padding: 14px 16px; border-radius: 8px; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">
                <div style="width: 40px; height: 40px; border-radius: 50%; background: #00a884; display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0;">${Icons.video(18)}</div>
                <div>
                  <div style="font-weight: 600; font-size: 13px; color: #fff;">Video Message</div>
                  <div style="font-size: 11px; color: #8696a0;">Synced from WhatsApp</div>
                </div>
              </div>
            `}
          </div>
          ${msg.media_caption ? `<div class="wa-bubble-text" style="margin-top: 6px;">${this.escapeHtml(msg.media_caption)}</div>` : ''}`;
      } else if (msg.message_type === 'image') {
        const imgSrc = msg.media_url || '';
        contentHtml = `
          <div class="wa-media-image-container" style="max-width: 300px; border-radius: 8px; overflow: hidden; margin-bottom: 4px;">
            ${imgSrc ? `
              <img src="${this.escapeHtml(imgSrc)}" style="width: 100%; border-radius: 8px; object-fit: cover; max-height: 240px; cursor: pointer;" onclick="window.open(this.src, '_blank')">
            ` : `
              <div style="background: var(--color-surface-alt); padding: 12px 14px; border-radius: var(--radius-sm); display: flex; align-items: center; gap: 10px; color: var(--color-ink); border: 1px solid var(--color-hairline);">
                <span style="display:inline-flex; align-items:center; color: var(--color-ink);">${Icons.image(22)}</span>
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Photo Attachment</div>
                  <div style="font-size: 11px; color: var(--color-mid-gray);">Synced from WhatsApp</div>
                </div>
              </div>
            `}
          </div>
          ${msg.media_caption ? `<div class="wa-bubble-text" style="margin-top: 4px;">${this.escapeHtml(msg.media_caption)}</div>` : ''}`;
      } else if (msg.message_type === 'audio' || msg.message_type === 'voice_note') {
        const audioSrc = msg.media_url || '';
        contentHtml = `
          <div class="wa-voice-card" style="display: flex; align-items: center; gap: 8px; padding: 4px 0;">
            ${audioSrc ? `
              <audio controls style="height: 32px; width: 220px;">
                <source src="${this.escapeHtml(audioSrc)}" type="audio/ogg">
                <source src="${this.escapeHtml(audioSrc)}" type="audio/mpeg">
              </audio>
            ` : `
              <div class="wa-play-btn" style="width: 32px; height: 32px; border-radius: 50%; background: #00a884; color: white; display: flex; align-items: center; justify-content: center;">${Icons.mic(14)}</div>
              <div style="flex: 1; height: 16px; background: repeating-linear-gradient(90deg, #00a884 0, #00a884 2px, transparent 2px, transparent 5px); opacity: 0.5;"></div>
              <span style="font-size: 11px; color: #667781; white-space: nowrap;">Voice Note</span>
            `}
          </div>`;
      } else if (msg.message_type === 'document') {
        const docSrc = msg.media_url || '';
        contentHtml = `
          <div style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(0,0,0,0.04); border-radius: 6px;">
            <span style="display:inline-flex; align-items:center; color: var(--color-ink);">${Icons.fileText(22)}</span>
            <div>
              <div style="font-weight: 600; font-size: 13px; color: #111b21;">${this.escapeHtml(msg.media_caption || msg.message_text || 'Document Attachment')}</div>
              ${docSrc ? `<a href="${this.escapeHtml(docSrc)}" target="_blank" style="font-size: 11px; color: #00a884; text-decoration: none; font-weight: 500;">Download / View &darr;</a>` : '<div style="font-size: 11px; color: #8696a0;">WhatsApp Document</div>'}
            </div>
          </div>`;
      } else if (isLeadForm) {
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        const greeting = lines[0] || '';
        const fields = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            fields.push({
              key: line.substring(0, colonIdx).trim(),
              val: line.substring(colonIdx + 1).trim()
            });
          }
        }
        contentHtml = `
          <div style="font-weight: 500; margin-bottom: 6px;">${this.escapeHtml(greeting)}</div>
          <div class="wa-form-card">
            <div style="font-size: 10.5px; font-weight: 700; color: #00a884; letter-spacing: 0.5px; margin-bottom: 6px; text-transform: uppercase; display:flex; align-items:center; gap:4px;">${Icons.clipboardList(12)} Lead Form Submission</div>
            ${fields.map(f => `
              <div class="wa-form-field">
                <div class="wa-form-label">${this.escapeHtml(f.key)}</div>
                <div class="wa-form-val">${this.escapeHtml(f.val || '—')}</div>
              </div>
            `).join('')}
          </div>`;
      } else {
        contentHtml = `<div class="wa-bubble-text" style="white-space: pre-wrap;">${this.escapeHtml(text)}</div>`;
      }

      const senderName = isOut ? '' : `<div class="wa-bubble-sender">${this.escapeHtml(this.state.selectedLead?.name || 'Lead')}</div>`;

      // Clear Inbox Pill inside bubble
      const normAcc = (msg.account_phone || '').replace(/\D/g, '').slice(-10);
      const isPersonal = normAcc === '9993202900';
      const isCentral = normAcc === '9479007951';

      let inboxPill = '';
      if (isPersonal) {
        inboxPill = `
          <div style="margin-bottom: 5px;">
            <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 10px; font-size: 10px; font-weight: 600; white-space: nowrap; background: ${isOut ? '#dcfce7' : '#e0f2fe'}; color: ${isOut ? '#166534' : '#0369a1'}; border: 1px solid ${isOut ? '#bbf7d0' : '#bae6fd'};">
              <span style="display:inline-block; width:5.5px; height:5.5px; border-radius:50%; background:${isOut ? '#16a34a' : '#0284c7'};"></span>
              ${isOut ? `<span style="display:inline-flex; align-items:center; gap:3px;">${Icons.arrowUp(11)} Sent from Personal (9993202900)</span>` : `<span style="display:inline-flex; align-items:center; gap:3px;">${Icons.arrowDown(11)} Received in Personal (9993202900)</span>`}
            </span>
          </div>`;
      } else if (isCentral) {
        inboxPill = `
          <div style="margin-bottom: 5px;">
            <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 10px; font-size: 10px; font-weight: 600; white-space: nowrap; background: ${isOut ? '#fef3c7' : '#fffbeb'}; color: #92400e; border: 1px solid #fde68a;">
              <span style="display:inline-block; width:5.5px; height:5.5px; border-radius:50%; background:#d97706;"></span>
              ${isOut ? `<span style="display:inline-flex; align-items:center; gap:3px;">${Icons.arrowUp(11)} Sent from Zero7 Central (9479007951)</span>` : `<span style="display:inline-flex; align-items:center; gap:3px;">${Icons.building(11)} Received in Zero7 Central (9479007951)</span>`}
            </span>
          </div>`;
      } else if (msg.account_phone) {
        inboxPill = `
          <div style="margin-bottom: 5px;">
            <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--radius-pill); font-size: 10px; font-weight: 600; white-space: nowrap; background: var(--color-surface-alt); color: var(--color-ink-muted); border: 1px solid var(--color-hairline);">
              ${isOut ? `<span style="display:inline-flex; align-items:center; gap:3px;">${Icons.arrowUp(11)} Sent</span>` : `<span style="display:inline-flex; align-items:center; gap:3px;">${Icons.arrowDown(11)} Received</span>`} (${this.escapeHtml(msg.account_phone)})
            </span>
          </div>`;
      }

      html += `
        <div class="wa-message-row ${isOut ? 'outgoing' : 'incoming'}">
          <div class="wa-bubble ${isOut ? 'outgoing' : 'incoming'}">
            ${inboxPill}
            ${senderName}
            ${contentHtml}
            <div class="wa-bubble-meta">
              <span>${time}</span>
              ${ticks}
            </div>
          </div>
        </div>`;
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  },

  // ---------------- ZOHO MAIL INBOX & ALIAS BIFURCATION ----------------

  _initMailState() {
    if (!this.state.mail) {
      this.state.mail = {
        folder: 'inbox',
        alias: 'all',
        label: '',
        search: '',
        page: 1,
        limit: 12,
        loading: false,
        aliases: [
          { email: 'admin@zero7.space', displayName: 'Zero7', isPrimary: true },
          { email: 'abhijeet@zero7.space', displayName: 'Abhijeet', isPrimary: false },
          { email: 'shailesh@zero7.space', displayName: 'Shailesh', isPrimary: false },
          { email: 'aakash@zero7.space', displayName: 'Aakash', isPrimary: false },
          { email: 'lishant@zero7.space', displayName: 'Lishant', isPrimary: false },
        ],
        aliasCounts: {},
        folderCounts: { inbox: 0, starred: 0, sent: 0, drafts: 0, spam: 0, important: 0, bin: 0 },
        labels: [
          { id: 'primary', name: 'Primary', color: '#00b69b', bg: 'rgba(0, 182, 155, 0.14)' },
          { id: 'social', name: 'Social', color: '#5a8cff', bg: 'rgba(90, 140, 255, 0.14)' },
          { id: 'work', name: 'Work', color: '#fd9a56', bg: 'rgba(253, 154, 86, 0.16)' },
          { id: 'friends', name: 'Friends', color: '#d456fd', bg: 'rgba(212, 86, 253, 0.14)' },
        ],
        messages: [],
        pagination: { page: 1, limit: 12, total: 0, start: 0, end: 0, totalPages: 1 },
        selectedIds: new Set(),
        activeThread: null,
        threadLoading: false,
        expandedMessageIds: new Set(),
      };
    }
    return this.state.mail;
  },

  formatMailTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const isSameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (isSameDay) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 365) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  },

  formatMailFullDate(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  },

  async renderMailView(forceRefresh = false) {
    const m = this._initMailState();
    this.renderMailPageDOM();
    await this.loadMailMessages(forceRefresh);
  },

  async loadMailMessages(forceRefresh = false) {
    const m = this._initMailState();
    m.loading = true;
    this.renderMailPageDOM();

    try {
      const params = new URLSearchParams({
        folder: m.folder,
        alias: m.alias,
        label: m.label || '',
        search: m.search || '',
        page: String(m.page),
        limit: String(m.limit),
        force_refresh: forceRefresh ? 'true' : 'false',
      });
      const res = await API.get(`/api/mail/messages?${params.toString()}`);
      if (res) {
        if (res.aliases && res.aliases.length > 0) m.aliases = res.aliases;
        if (res.aliasCounts) m.aliasCounts = res.aliasCounts;
        if (res.folderCounts) m.folderCounts = res.folderCounts;
        if (res.labels && res.labels.length > 0) m.labels = res.labels;
        m.messages = res.messages || [];
        m.pagination = res.pagination || { page: 1, limit: 12, total: 0, start: 0, end: 0, totalPages: 1 };
      }
    } catch (err) {
      console.error('[ZOHO MAIL] Failed to load messages:', err);
    } finally {
      m.loading = false;
      if (this.state.currentView === 'mail') {
        this.renderMailPageDOM();
      }
    }
  },

  selectMailFolder(folderKey) {
    const m = this._initMailState();
    m.folder = folderKey;
    m.page = 1;
    m.activeThread = null;
    m.selectedIds.clear();
    this.loadMailMessages(false);
  },

  selectMailAlias(aliasEmail) {
    const m = this._initMailState();
    m.alias = aliasEmail;
    m.page = 1;
    m.activeThread = null;
    m.selectedIds.clear();
    this.loadMailMessages(false);
  },

  selectMailLabel(labelId) {
    const m = this._initMailState();
    m.label = m.label === labelId ? '' : labelId;
    m.page = 1;
    m.activeThread = null;
    m.selectedIds.clear();
    this.loadMailMessages(false);
  },

  onMailSearchInput(val) {
    const m = this._initMailState();
    m.search = val;
    m.page = 1;
    clearTimeout(this._mailSearchTimer);
    this._mailSearchTimer = setTimeout(() => {
      this.loadMailMessages(false);
    }, 280);
  },

  changeMailPage(delta) {
    const m = this._initMailState();
    const next = m.page + delta;
    if (next < 1 || next > (m.pagination.totalPages || 1)) return;
    m.page = next;
    m.selectedIds.clear();
    this.loadMailMessages(false);
  },

  toggleMailRowSelect(event, messageId) {
    event.stopPropagation();
    const m = this._initMailState();
    const idStr = String(messageId);
    if (m.selectedIds.has(idStr)) {
      m.selectedIds.delete(idStr);
    } else {
      m.selectedIds.add(idStr);
    }
    this.renderMailPageDOM();
  },

  async toggleMailStar(event, messageId, currentlyStarred) {
    event.stopPropagation();
    const m = this._initMailState();
    const idStr = String(messageId);
    const targetMsg = m.messages.find(item => String(item.messageId) === idStr);
    const nextStar = !currentlyStarred;
    if (targetMsg) {
      targetMsg.isStarred = nextStar;
      m.folderCounts.starred = Math.max(0, (m.folderCounts.starred || 0) + (nextStar ? 1 : -1));
      this.renderMailPageDOM();
    }
    try {
      await API.post('/api/mail/messages/action', {
        messageIds: [idStr],
        action: nextStar ? 'star' : 'unstar',
      });
    } catch (err) {
      console.error('Star toggle failed:', err);
    }
  },

  async bulkMailAction(action, explicitIds = null, labelId = null) {
    const m = this._initMailState();
    const ids = explicitIds || Array.from(m.selectedIds);
    if (!ids.length) {
      API.showToast('Select at least one email first', 'info');
      return;
    }
    try {
      await API.post('/api/mail/messages/action', {
        messageIds: ids,
        action,
        labelId,
      });
      m.selectedIds.clear();
      if (m.activeThread && (action === 'trash' || action === 'spam' || action === 'archive')) {
        m.activeThread = null;
      }
      const actionLabels = {
        trash: 'Moved to Bin',
        spam: 'Marked as Spam',
        archive: 'Archived',
        read: 'Marked as Read',
        assign_label: 'Label updated',
      };
      API.showToast(actionLabels[action] || 'Updated successfully', 'success');
      await this.loadMailMessages(true);
    } catch (err) {
      console.error('Bulk action error:', err);
    }
  },

  async openMailThread(folderId, messageId) {
    this._replyFiles = [];
    const m = this._initMailState();
    m.threadLoading = true;
    m.expandedMessageIds = new Set();
    const msgPreview = m.messages.find(x => String(x.messageId) === String(messageId));
    if (msgPreview && msgPreview.isUnread) {
      msgPreview.isUnread = false;
    }
    m.activeThread = {
      message: msgPreview || { messageId, folderId, subject: 'Loading...' },
      thread: msgPreview ? [msgPreview] : [],
    };
    if (msgPreview?.messageId) {
      m.expandedMessageIds.add(String(msgPreview.messageId));
    }
    this.renderMailPageDOM();

    try {
      const data = await API.get(`/api/mail/messages/${encodeURIComponent(folderId)}/${encodeURIComponent(messageId)}`);
      if (data) {
        m.activeThread = data;
        const thread = data.thread || (data.message ? [data.message] : []);
        m.expandedMessageIds = new Set();
        if (thread.length === 1) {
          m.expandedMessageIds.add(String(thread[0].messageId));
        } else if (thread.length > 1) {
          // Default (Zoho & Gmail standard): Expand only the latest message in thread
          const lastMsg = thread[thread.length - 1];
          if (lastMsg && lastMsg.messageId) {
            m.expandedMessageIds.add(String(lastMsg.messageId));
          }
          // If user specifically clicked an older message, expand it too
          if (messageId && thread.some(t => String(t.messageId) === String(messageId))) {
            m.expandedMessageIds.add(String(messageId));
          }
        }
      }
    } catch (err) {
      console.error('Failed to load mail thread:', err);
    } finally {
      m.threadLoading = false;
      if (this.state.currentView === 'mail') {
        this.renderMailPageDOM();
      }
    }
  },

  closeMailThread() {
    this._replyFiles = [];
    const m = this._initMailState();
    m.activeThread = null;
    m.expandedMessageIds = new Set();
    this.renderMailPageDOM();
  },

  getMailSnippet(item) {
    if (!item) return '';
    if (item.summary && item.summary.trim()) {
      return item.summary.trim();
    }
    if (item.htmlContent) {
      try {
        const doc = new DOMParser().parseFromString(item.htmlContent, 'text/html');
        doc.querySelectorAll('style, script, noscript').forEach(el => el.remove());
        const txt = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt) return txt;
      } catch (e) {}
    }
    return item.subject || '';
  },

  toggleThreadCard(msgId) {
    const m = this._initMailState();
    if (!m.expandedMessageIds) m.expandedMessageIds = new Set();
    const idStr = String(msgId);
    const cardEl = document.getElementById(`mail-thread-card-${idStr}`);

    if (m.expandedMessageIds.has(idStr)) {
      m.expandedMessageIds.delete(idStr);
      if (cardEl) {
        cardEl.classList.remove('is-expanded');
        cardEl.classList.add('is-collapsed');
      }
    } else {
      m.expandedMessageIds.add(idStr);
      if (cardEl) {
        cardEl.classList.remove('is-collapsed');
        cardEl.classList.add('is-expanded');
      }
    }
    this._updateThreadToolbarExpandBtn();
  },

  toggleAllThreadCards() {
    const m = this._initMailState();
    if (!m.activeThread || !m.activeThread.thread) return;
    const threadList = m.activeThread.thread;
    if (!m.expandedMessageIds) m.expandedMessageIds = new Set();

    const allExpanded = threadList.length > 0 && threadList.every(t => m.expandedMessageIds.has(String(t.messageId)));

    if (allExpanded) {
      // Collapse older messages, keep only the latest one expanded
      m.expandedMessageIds.clear();
      const last = threadList[threadList.length - 1];
      if (last && last.messageId) {
        m.expandedMessageIds.add(String(last.messageId));
      }
    } else {
      // Expand all messages in thread
      threadList.forEach(t => {
        if (t.messageId) m.expandedMessageIds.add(String(t.messageId));
      });
    }

    // Direct DOM class toggle for instant responsive feedback without clearing input state
    threadList.forEach(t => {
      const idStr = String(t.messageId);
      const cardEl = document.getElementById(`mail-thread-card-${idStr}`);
      if (cardEl) {
        if (m.expandedMessageIds.has(idStr)) {
          cardEl.classList.remove('is-collapsed');
          cardEl.classList.add('is-expanded');
        } else {
          cardEl.classList.remove('is-expanded');
          cardEl.classList.add('is-collapsed');
        }
      }
    });

    this._updateThreadToolbarExpandBtn();
  },

  _updateThreadToolbarExpandBtn() {
    const m = this._initMailState();
    const btn = document.getElementById('mail-thread-toggle-all-btn');
    if (!btn || !m.activeThread?.thread) return;
    const threadList = m.activeThread.thread;
    const allExpanded = threadList.length > 0 && threadList.every(t => m.expandedMessageIds?.has(String(t.messageId)));

    if (allExpanded) {
      btn.innerHTML = `${Icons.chevronUp(15)}`;
      btn.title = 'Collapse older messages';
    } else {
      btn.innerHTML = `${Icons.chevronDown(15)}`;
      btn.title = 'Expand all messages in thread';
    }
  },

  _replyFiles: [],

  onReplyFilesChanged(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    this._replyFiles = (this._replyFiles || []).concat(files);
    this.renderReplyAttachmentsTray();
  },

  removeReplyFile(idx) {
    if (this._replyFiles && this._replyFiles.length > idx) {
      this._replyFiles.splice(idx, 1);
      this.renderReplyAttachmentsTray();
    }
  },

  renderReplyAttachmentsTray() {
    const tray = document.getElementById('mail-reply-attachments-tray');
    if (!tray) return;

    if (!this._replyFiles || this._replyFiles.length === 0) {
      tray.style.display = 'none';
      tray.innerHTML = '';
      return;
    }

    tray.style.display = 'flex';
    tray.innerHTML = this._replyFiles.map((f, idx) => {
      const sizeStr = `${Math.max(1, Math.round(f.size / 1024))} KB`;
      const ext = (f.name || '').split('.').pop().toLowerCase();
      const isImg = f.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
      const isPdf = f.type === 'application/pdf' || ext === 'pdf';
      let thumbUrl = '';
      if (isImg) {
        try { thumbUrl = URL.createObjectURL(f); } catch (e) {}
      }

      return `
        <div class="mail-compose-file-tag"
             onclick="App.previewLocalAttachment('reply', ${idx})"
             title="Click to preview ${this.escapeHtml(f.name)}">
          ${isImg && thumbUrl ? `
            <div class="mail-compose-file-thumb">
              <img src="${thumbUrl}" alt="">
            </div>
          ` : `
            <span style="color: #4880ff; display: inline-flex;">${isPdf ? Icons.fileText(14) : Icons.paperclip(14)}</span>
          `}
          <span class="mail-compose-file-name" style="max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">
            ${this.escapeHtml(f.name)}
          </span>
          <span style="color: var(--color-mid-gray); font-size: 11px;">(${sizeStr})</span>
          <span class="mail-compose-file-preview-hint">
            ${Icons.eye(12)} Preview
          </span>
          <button type="button"
                  class="mail-compose-file-remove"
                  onclick="event.stopPropagation(); App.removeReplyFile(${idx})"
                  title="Remove ${this.escapeHtml(f.name)}">
            ${Icons.close(13)}
          </button>
        </div>
      `;
    }).join('');
  },

  _isSendingReply: false,

  async submitMailReply(event, messageId, defaultFrom, defaultTo, subject) {
    event.preventDefault();
    if (this._isSendingReply) {
      console.warn('[MAIL] Reply submission already in progress, ignoring duplicate submit');
      return;
    }

    const fromEl = document.getElementById('mail-reply-from');
    const toEl = document.getElementById('mail-reply-to');
    const ccEl = document.getElementById('mail-reply-cc');
    const bodyEl = document.getElementById('mail-reply-body');
    const fileInput = document.getElementById('mail-reply-file-input');
    const btnEl = document.getElementById('mail-reply-submit-btn');

    const content = (bodyEl?.value || '').trim();
    if (!content) {
      API.showToast('Please write a reply message', 'error');
      return;
    }

    this._isSendingReply = true;
    const fromAddress = fromEl?.value || defaultFrom || 'admin@zero7.space';
    const toAddress = (toEl?.value || defaultTo || '').trim();
    const ccAddress = (ccEl?.value || '').trim();
    const cleanSubj = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = `${Icons.loader(14)} Sending...`;
    }

    try {
      const files = (this._replyFiles && this._replyFiles.length > 0) ? this._replyFiles : Array.from(fileInput?.files || []);
      if (files.length > 0) {
        const fd = new FormData();
        fd.append('fromAddress', fromAddress);
        fd.append('toAddress', toAddress);
        fd.append('ccAddress', ccAddress);
        fd.append('subject', cleanSubj);
        fd.append('content', content);
        fd.append('inReplyTo', String(messageId));
        fd.append('action', 'reply');
        for (const f of files) {
          fd.append('files', f);
        }

        const token = localStorage.getItem('zero7_token');
        const res = await fetch('/api/mail/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Server error (${res.status})`);
        }
      } else {
        await API.post('/api/mail/send', {
          fromAddress,
          toAddress,
          ccAddress,
          subject: cleanSubj,
          content,
          inReplyTo: String(messageId),
          action: 'reply',
        });
      }

      API.showToast(`Reply sent from ${fromAddress}`, 'success');
      this._replyFiles = [];
      if (bodyEl) bodyEl.value = '';
      if (fileInput) fileInput.value = '';
      const replyTray = document.getElementById('mail-reply-attachments-tray');
      if (replyTray) {
        replyTray.style.display = 'none';
        replyTray.innerHTML = '';
      }
      await this.loadMailMessages(true);
      if (this.state.mail?.activeThread?.message) {
        await this.openMailThread(
          this.state.mail.activeThread.message.folderId,
          this.state.mail.activeThread.message.messageId
        );
      }
    } catch (err) {
      console.error('Failed to send reply:', err);
      API.showToast(err.message || 'Failed to send reply', 'error');
    } finally {
      this._isSendingReply = false;
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = `${Icons.send(14)} Send Reply`;
      }
    }
  },

  splitMailQuotedContent(htmlStr, summaryStr = '') {
    const raw = htmlStr || '';
    if (!raw && summaryStr) {
      const txtPatterns = [
        /----+[\s\xa0]*on[\s\xa0]+[A-Za-z]+,\s+\d+[\s\S]*?wrote[\s\S]*?----+/i,
        /---+[\s\xa0]*on[\s\xa0]+[A-Za-z]+,\s+\d+[\s\S]*?wrote[\s\S]*?---+/i,
        /On\s+[A-Za-z]+,\s+\d+[\s\S]*?wrote:/i,
        /-----Original Message-----/i,
        /----- Original Message -----/i
      ];
      for (const p of txtPatterns) {
        const m = summaryStr.match(p);
        if (m && m.index > 5) {
          const main = summaryStr.slice(0, m.index).trim();
          const quoted = summaryStr.slice(m.index).trim();
          return {
            main: `<p style="white-space: pre-wrap;">${this.escapeHtml(main)}</p>`,
            quoted: `<p style="white-space: pre-wrap;">${this.escapeHtml(quoted)}</p>`
          };
        }
      }
      return { main: `<p style="white-space: pre-wrap;">${this.escapeHtml(summaryStr)}</p>`, quoted: '' };
    }

    if (!raw) return { main: '', quoted: '' };

    const patterns = [
      /(<div[^>]*>)?\s*----+[\s\xa0]*on[\s\xa0]+[A-Za-z]+,\s+\d+[\s\S]*?wrote[\s\S]*?----+/i,
      /(<div[^>]*>)?\s*---+[\s\xa0]*on[\s\xa0]+[A-Za-z]+,\s+\d+[\s\S]*?wrote[\s\S]*?---+/i,
      /<div[^>]*class="[^"]*(?:gmail_quote|zmail_extra|blockquote_zmail|zoho_quote)[^"]*"[^>]*>/i,
      /<blockquote[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>/i,
      /<blockquote[^>]*>/i,
      /-----Original Message-----/i,
      /----- Original Message -----/i
    ];

    let earliestPos = -1;
    for (const p of patterns) {
      const match = raw.match(p);
      if (match && match.index !== undefined) {
        const pos = match.index;
        if (earliestPos === -1 || pos < earliestPos) {
          earliestPos = pos;
        }
      }
    }

    if (earliestPos !== -1 && earliestPos > 15) {
      return {
        main: raw.slice(0, earliestPos).trim(),
        quoted: raw.slice(earliestPos).trim()
      };
    }

    return { main: raw, quoted: '' };
  },

  renderMailMessageBodyHTML(tItem, msgId) {
    const { main, quoted } = this.splitMailQuotedContent(tItem.htmlContent, tItem.summary);
    if (!quoted) {
      return `<div class="mail-body-content">${main || `<p style="white-space: pre-wrap;">${this.escapeHtml(tItem.summary || '')}</p>`}</div>`;
    }

    const safeId = String(msgId).replace(/[^a-zA-Z0-9_-]/g, '_');

    return `
      <div class="mail-body-content">
        ${main}
        <div class="mail-trimmed-toggle-wrap">
          <button type="button"
                  id="mail-trimmed-btn-${safeId}"
                  class="mail-trimmed-btn"
                  onclick="App.toggleMailTrimmed('${safeId}')"
                  title="Show trimmed content">
            <span class="mail-trimmed-dots">&bull;&bull;&bull;</span>
          </button>
        </div>
        <div id="mail-trimmed-box-${safeId}" class="mail-trimmed-box" style="display: none;">
          ${quoted}
        </div>
      </div>
    `;
  },

  toggleMailTrimmed(safeId) {
    const box = document.getElementById(`mail-trimmed-box-${safeId}`);
    const btn = document.getElementById(`mail-trimmed-btn-${safeId}`);
    if (!box) return;
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'block' : 'none';
    if (btn) {
      btn.classList.toggle('expanded', isHidden);
      btn.title = isHidden ? 'Hide trimmed content' : 'Show trimmed content';
    }
  },

  _composeFiles: [],

  openComposeMailModal(prefill = {}) {
    this._composeFiles = [];
    const m = this._initMailState();
    const defaultFrom =
      prefill.fromAddress ||
      (m.alias && m.alias !== 'all' ? m.alias : 'admin@zero7.space');

    const leadEmails = (this.state.leads || [])
      .filter(l => l && l.email && l.email.includes('@'))
      .slice(0, 40);

    const aliases = (m.aliases && m.aliases.length > 0) ? m.aliases : [
      { email: 'admin@zero7.space', displayName: 'Zero7', isPrimary: true },
      { email: 'abhijeet@zero7.space', displayName: 'Abhijeet', isPrimary: false },
      { email: 'shailesh@zero7.space', displayName: 'Shailesh', isPrimary: false },
      { email: 'aakash@zero7.space', displayName: 'Aakash', isPrimary: false },
      { email: 'lishant@zero7.space', displayName: 'Lishant', isPrimary: false },
    ];

    const html = `
      <div class="mail-compose-dialog-backdrop" onclick="if(event.target === this) App.closeComposeMailModal()">
        <div class="mail-compose-dialog-card">
          <div class="mail-compose-dialog-header">
            <h3 style="font-size: 15.5px; font-weight: 600; display: flex; align-items: center; gap: 8px; margin: 0; color: var(--color-ink);">
              ${Icons.mail(17)} New Email Message
            </h3>
            <button type="button" class="btn-icon" onclick="App.closeComposeMailModal()" title="Close">${Icons.close(18)}</button>
          </div>
          <form onsubmit="App.submitComposeMail(event)" id="compose-mail-form" style="display: flex; flex-direction: column; flex: 1; min-height: 0;">
            <div class="mail-compose-dialog-body">
              <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 12px; font-weight: 600; color: var(--color-ink-soft); display: block; margin-bottom: 4px;">From (Select Zoho Alias)</label>
                <select id="compose-mail-from" class="input" style="height: 38px; font-weight: 500; width: 100%;">
                  ${aliases.map(a => `
                    <option value="${this.escapeHtml(a.email)}" ${a.email === defaultFrom ? 'selected' : ''}>
                      ${this.escapeHtml(a.displayName || a.email)} &lt;${this.escapeHtml(a.email)}&gt; ${a.isPrimary ? '(Primary)' : '(Alias)'}
                    </option>
                  `).join('')}
                </select>
              </div>
              <div class="form-group" style="margin-bottom: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <label style="font-size: 12px; font-weight: 600; color: var(--color-ink-soft); margin: 0;">To</label>
                  <div style="display: flex; gap: 8px; font-size: 12px;">
                    <button type="button" style="color: #4880ff; font-weight: 500; cursor: pointer; background: none; border: none; padding: 0;" onclick="App.toggleComposeField('cc')">+ Cc</button>
                    <button type="button" style="color: #4880ff; font-weight: 500; cursor: pointer; background: none; border: none; padding: 0;" onclick="App.toggleComposeField('bcc')">+ Bcc</button>
                  </div>
                </div>
                <input type="text" id="compose-mail-to" class="input" list="crm-lead-emails-list" placeholder="client@company.com (comma separated)" value="${this.escapeHtml(prefill.toAddress || '')}" required style="width: 100%;">
                <datalist id="crm-lead-emails-list">
                  ${leadEmails.map(l => `<option value="${this.escapeHtml(l.email)}">${this.escapeHtml(l.name || l.business_name || l.email)} (${this.escapeHtml(l.business_name || '')})</option>`).join('')}
                </datalist>
              </div>
              <div id="compose-mail-cc-container" class="form-group" style="${prefill.ccAddress ? '' : 'display: none;'} margin-bottom: 0;">
                <label style="font-size: 12px; font-weight: 600; color: var(--color-ink-soft); display: block; margin-bottom: 4px;">Cc</label>
                <input type="text" id="compose-mail-cc" class="input" placeholder="cc@zero7.space" value="${this.escapeHtml(prefill.ccAddress || '')}" style="width: 100%;">
              </div>
              <div id="compose-mail-bcc-container" class="form-group" style="display: none; margin-bottom: 0;">
                <label style="font-size: 12px; font-weight: 600; color: var(--color-ink-soft); display: block; margin-bottom: 4px;">Bcc</label>
                <input type="text" id="compose-mail-bcc" class="input" placeholder="bcc@zero7.space" style="width: 100%;">
              </div>
              <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 12px; font-weight: 600; color: var(--color-ink-soft); display: block; margin-bottom: 4px;">Subject</label>
                <input type="text" id="compose-mail-subject" class="input" placeholder="Subject" value="${this.escapeHtml(prefill.subject || '')}" required style="width: 100%;">
              </div>
              <div class="form-group" style="margin-bottom: 0; flex: 1; display: flex; flex-direction: column;">
                <label style="font-size: 12px; font-weight: 600; color: var(--color-ink-soft); display: block; margin-bottom: 4px;">Message</label>
                <textarea id="compose-mail-body" class="input" rows="8" placeholder="Write your email here..." style="resize: vertical; font-family: var(--font-sans); line-height: 1.55; padding: 10px 12px; flex: 1; min-height: 140px; width: 100%;" required>${this.escapeHtml(prefill.body || '')}</textarea>
              </div>
              <div id="compose-attachments-tray" class="mail-compose-tray" style="display: none;"></div>
            </div>
            <div class="mail-compose-dialog-footer">
              <div style="display: flex; align-items: center; gap: 8px;">
                <input type="file" id="compose-mail-file-input" multiple onchange="App.onComposeFilesChanged(event)" style="display: none;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('compose-mail-file-input').click()" style="display: inline-flex; align-items: center; gap: 6px;">
                  ${Icons.paperclip(14)} Attach Files
                </button>
                <span id="compose-attachment-count" style="font-size: 12px; color: var(--color-mid-gray);"></span>
              </div>
              <div style="display: flex; gap: 10px;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="App.closeComposeMailModal()">Discard</button>
                <button type="submit" id="compose-mail-submit-btn" class="btn btn-primary btn-sm" style="background: #4880ff; border-color: #4880ff; color: #fff; padding: 0 20px; height: 36px; display: inline-flex; align-items: center; gap: 6px;">
                  ${Icons.send(14)} Send Email
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;

    let container = document.getElementById('mail-compose-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'mail-compose-container';
      document.body.appendChild(container);
    }
    container.innerHTML = html;
  },

  closeComposeMailModal() {
    this._composeFiles = [];
    const container = document.getElementById('mail-compose-container');
    if (container) {
      container.innerHTML = '';
    }
  },

  toggleComposeField(field) {
    const el = document.getElementById(`compose-mail-${field}-container`);
    if (el) {
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
      if (el.style.display === 'block') {
        const inp = document.getElementById(`compose-mail-${field}`);
        if (inp) inp.focus();
      }
    }
  },

  onComposeFilesChanged(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    this._composeFiles = (this._composeFiles || []).concat(files);
    this.renderComposeAttachmentsTray();
  },

  removeComposeFile(idx) {
    if (this._composeFiles && this._composeFiles.length > idx) {
      this._composeFiles.splice(idx, 1);
      this.renderComposeAttachmentsTray();
    }
  },

  renderComposeAttachmentsTray() {
    const tray = document.getElementById('compose-attachments-tray');
    const countEl = document.getElementById('compose-attachment-count');
    if (!tray) return;

    if (!this._composeFiles || this._composeFiles.length === 0) {
      tray.style.display = 'none';
      tray.innerHTML = '';
      if (countEl) countEl.textContent = '';
      return;
    }

    tray.style.display = 'flex';
    tray.innerHTML = this._composeFiles.map((f, idx) => {
      const sizeStr = `${Math.max(1, Math.round(f.size / 1024))} KB`;
      const ext = (f.name || '').split('.').pop().toLowerCase();
      const isImg = f.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
      const isPdf = f.type === 'application/pdf' || ext === 'pdf';
      let thumbUrl = '';
      if (isImg) {
        try { thumbUrl = URL.createObjectURL(f); } catch (e) {}
      }

      return `
        <div class="mail-compose-file-tag"
             onclick="App.previewLocalAttachment('compose', ${idx})"
             title="Click to preview ${this.escapeHtml(f.name)}">
          ${isImg && thumbUrl ? `
            <div class="mail-compose-file-thumb">
              <img src="${thumbUrl}" alt="">
            </div>
          ` : `
            <span style="color: #4880ff; display: inline-flex;">${isPdf ? Icons.fileText(14) : Icons.paperclip(14)}</span>
          `}
          <span class="mail-compose-file-name" style="max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">
            ${this.escapeHtml(f.name)}
          </span>
          <span style="color: var(--color-mid-gray); font-size: 11px;">(${sizeStr})</span>
          <span class="mail-compose-file-preview-hint">
            ${Icons.eye(12)} Preview
          </span>
          <button type="button"
                  class="mail-compose-file-remove"
                  onclick="event.stopPropagation(); App.removeComposeFile(${idx})"
                  title="Remove ${this.escapeHtml(f.name)}">
            ${Icons.close(13)}
          </button>
        </div>
      `;
    }).join('');

    if (countEl) {
      countEl.textContent = `${this._composeFiles.length} file${this._composeFiles.length > 1 ? 's' : ''} attached`;
    }
  },

  async submitComposeMail(event) {
    event.preventDefault();
    const fromAddress = document.getElementById('compose-mail-from')?.value || 'admin@zero7.space';
    const toAddress = (document.getElementById('compose-mail-to')?.value || '').trim();
    const ccAddress = (document.getElementById('compose-mail-cc')?.value || '').trim();
    const bccAddress = (document.getElementById('compose-mail-bcc')?.value || '').trim();
    const subject = (document.getElementById('compose-mail-subject')?.value || '').trim() || '(No Subject)';
    const content = document.getElementById('compose-mail-body')?.value || '';
    const btn = document.getElementById('compose-mail-submit-btn');

    if (!toAddress) {
      API.showToast('Please specify at least one recipient email address', 'error');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${Icons.loader(14)} Sending...`;
    }

    try {
      if (this._composeFiles && this._composeFiles.length > 0) {
        const fd = new FormData();
        fd.append('fromAddress', fromAddress);
        fd.append('toAddress', toAddress);
        fd.append('ccAddress', ccAddress);
        fd.append('bccAddress', bccAddress);
        fd.append('subject', subject);
        fd.append('content', content);
        for (const file of this._composeFiles) {
          fd.append('files', file);
        }

        const token = localStorage.getItem('zero7_token');
        const res = await fetch('/api/mail/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Server error (${res.status})`);
        }
      } else {
        await API.post('/api/mail/send', {
          fromAddress,
          toAddress,
          ccAddress,
          bccAddress,
          subject,
          content,
        });
      }

      this._composeFiles = [];
      this.closeComposeMailModal();
      API.showToast(`Email sent from ${fromAddress}`, 'success');
      await this.loadMailMessages(true);
    } catch (err) {
      console.error('Send mail error:', err);
      API.showToast(err.message || 'Failed to send email', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${Icons.send(14)} Send Email`;
      }
    }
  },

  _activePreviewBlobUrl: null,

  previewLocalAttachment(source, idx) {
    const list = source === 'reply' ? this._replyFiles : this._composeFiles;
    if (!list || !list[idx]) return;
    const file = list[idx];

    if (this._activePreviewBlobUrl) {
      try { URL.revokeObjectURL(this._activePreviewBlobUrl); } catch (e) {}
      this._activePreviewBlobUrl = null;
    }

    const blobUrl = URL.createObjectURL(file);
    this._activePreviewBlobUrl = blobUrl;

    const fn = file.name || 'Attachment';
    const ext = fn.split('.').pop().toLowerCase();
    const sizeStr = `${Math.max(1, Math.round(file.size / 1024))} KB`;

    const isImage = file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
    const isPdf = file.type === 'application/pdf' || ext === 'pdf';
    const isVideo = file.type.startsWith('video/') || ['mp4', 'webm', 'ogg'].includes(ext);
    const isAudio = file.type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext);
    const isText = file.type.startsWith('text/') || ['txt', 'csv', 'json', 'log', 'md', 'html', 'js', 'py', 'css', 'xml', 'yaml', 'yml'].includes(ext);

    let bodyHtml = '';
    if (isImage) {
      bodyHtml = `
        <div style="text-align: center; max-height: 75vh; overflow: auto; width: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; background: #0b0f19; border-radius: 8px; padding: 20px;">
          <img src="${blobUrl}" alt="${this.escapeHtml(fn)}" style="max-width: 100%; max-height: 68vh; object-fit: contain; border-radius: 6px; box-shadow: 0 4px 24px rgba(0,0,0,0.5);" />
          <div style="margin-top: 12px; font-size: 12px; color: rgba(255,255,255,0.7); display: flex; align-items: center; gap: 8px;">
            <span>Pre-send attachment preview</span>
            <span>&bull;</span>
            <span>${this.escapeHtml(file.type || 'image')}</span>
            <span>&bull;</span>
            <span>${sizeStr}</span>
          </div>
        </div>
      `;
    } else if (isPdf) {
      bodyHtml = `
        <div style="width: 100%; height: 75vh; background: #fff; border-radius: 8px; overflow: hidden;">
          <iframe src="${blobUrl}#toolbar=1" style="width: 100%; height: 100%; border: none;"></iframe>
        </div>
      `;
    } else if (isVideo) {
      bodyHtml = `
        <div style="width: 100%; max-height: 75vh; display: flex; justify-content: center; background: #000; border-radius: 8px; overflow: hidden; padding: 10px;">
          <video controls autoplay style="max-width: 100%; max-height: 70vh; border-radius: 4px;">
            <source src="${blobUrl}">
          </video>
        </div>
      `;
    } else if (isAudio) {
      bodyHtml = `
        <div style="padding: 40px; text-align: center; width: 100%;">
          <audio controls autoplay style="width: 100%; max-width: 480px;">
            <source src="${blobUrl}">
          </audio>
          <div style="margin-top: 14px; font-size: 12px; color: var(--color-mid-gray);">${this.escapeHtml(fn)} (${sizeStr})</div>
        </div>
      `;
    } else if (isText) {
      bodyHtml = `
        <div style="width: 100%; height: 70vh; background: var(--color-surface); border-radius: 8px; overflow: hidden; border: 1px solid var(--color-hairline);">
          <iframe src="${blobUrl}" style="width: 100%; height: 100%; border: none; font-family: monospace;"></iframe>
        </div>
      `;
    } else {
      bodyHtml = `
        <div style="padding: 48px 24px; text-align: center; width: 100%;">
          <div style="margin-bottom: 14px; color: var(--color-ink);">${Icons.fileText(48)}</div>
          <div style="font-size: 15px; font-weight: 600; color: var(--color-ink);">${this.escapeHtml(fn)}</div>
          <p style="font-size: 13px; color: var(--color-mid-gray); margin-top: 6px; margin-bottom: 20px;">
            Ready to send &bull; ${sizeStr}
          </p>
          <div style="display: flex; justify-content: center; gap: 10px;">
            <a href="${blobUrl}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px;">
              ${Icons.externalLink(14)} Open in Browser Tab
            </a>
          </div>
        </div>
      `;
    }

    const modalHtml = `
      <div class="mail-preview-dialog-backdrop" onclick="if(event.target === this) App.closeMailPreviewModal()">
        <div class="mail-preview-dialog-card">
          <div class="mail-preview-dialog-header">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <span style="color: #4880ff; display: inline-flex;">${isImage ? Icons.image(18) : isPdf ? Icons.fileText(18) : Icons.paperclip(18)}</span>
              <div style="font-size: 14.5px; font-weight: 600; color: var(--color-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${this.escapeHtml(fn)} <span style="font-size: 12px; font-weight: 400; color: var(--color-mid-gray);">(${sizeStr})</span>
              </div>
              <span class="mail-alias-tag" style="background: rgba(72,128,255,0.12); color: #4880ff; border-color: transparent;">Draft Attachment</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
              <a href="${blobUrl}" target="_blank" class="btn btn-secondary btn-xs" title="Open in new window / tab" style="display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px;">
                ${Icons.externalLink(13)} Open in New Tab
              </a>
              <button type="button" class="btn btn-danger-soft btn-xs" onclick="App.removeLocalAttachmentFromPreview('${source}', ${idx})" title="Remove this attachment" style="display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; color: var(--color-danger); background: rgba(235, 87, 87, 0.1); border: 1px solid rgba(235, 87, 87, 0.2); border-radius: 4px; font-weight: 600; cursor: pointer;">
                ${Icons.trash(13)} Remove
              </button>
              <button type="button" class="btn-icon" onclick="App.closeMailPreviewModal()" title="Close preview" style="width: 28px; height: 28px;">
                ${Icons.close(16)}
              </button>
            </div>
          </div>
          <div class="mail-preview-dialog-body">
            ${bodyHtml}
          </div>
        </div>
      </div>
    `;

    let previewContainer = document.getElementById('mail-preview-container');
    if (!previewContainer) {
      previewContainer = document.createElement('div');
      previewContainer.id = 'mail-preview-container';
      document.body.appendChild(previewContainer);
    }
    previewContainer.innerHTML = modalHtml;
  },

  removeLocalAttachmentFromPreview(source, idx) {
    if (source === 'reply') {
      this.removeReplyFile(idx);
    } else {
      this.removeComposeFile(idx);
    }
    this.closeMailPreviewModal();
    API.showToast('Attachment removed', 'info');
  },

  openMailAttachmentPreviewModal(folderId, messageId, attachmentId, attachmentName, attachmentSize) {
    const fn = attachmentName || 'Attachment';
    const ext = fn.split('.').pop().toLowerCase();
    const sizeStr = attachmentSize ? ` (${Math.max(1, Math.round(attachmentSize / 1024))} KB)` : '';
    const inlineUrl = `/api/mail/attachments/${encodeURIComponent(folderId)}/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}?name=${encodeURIComponent(fn)}`;
    const downloadUrl = `${inlineUrl}&download=1`;

    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
    const isPdf = ext === 'pdf';
    const isVideo = ['mp4', 'webm', 'ogg'].includes(ext);
    const isAudio = ['mp3', 'wav', 'ogg', 'm4a'].includes(ext);
    const isText = ['txt', 'csv', 'json', 'log', 'md', 'html', 'js', 'py', 'css'].includes(ext);

    let bodyHtml = '';
    if (isImage) {
      bodyHtml = `
        <div style="text-align: center; max-height: 75vh; overflow: auto; width: 100%; display: flex; justify-content: center; align-items: center; background: #0b0f19; border-radius: 8px; padding: 16px;">
          <img src="${inlineUrl}" alt="${this.escapeHtml(fn)}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 4px; box-shadow: 0 4px 24px rgba(0,0,0,0.5);" />
        </div>
      `;
    } else if (isPdf) {
      bodyHtml = `
        <div style="width: 100%; height: 75vh; background: #fff; border-radius: 8px; overflow: hidden;">
          <iframe src="${inlineUrl}#toolbar=1" style="width: 100%; height: 100%; border: none;"></iframe>
        </div>
      `;
    } else if (isVideo) {
      bodyHtml = `
        <div style="width: 100%; max-height: 75vh; display: flex; justify-content: center; background: #000; border-radius: 8px; overflow: hidden;">
          <video controls autoplay style="max-width: 100%; max-height: 70vh;">
            <source src="${inlineUrl}">
          </video>
        </div>
      `;
    } else if (isAudio) {
      bodyHtml = `
        <div style="padding: 40px; text-align: center; width: 100%;">
          <audio controls autoplay style="width: 100%; max-width: 480px;">
            <source src="${inlineUrl}">
          </audio>
        </div>
      `;
    } else if (isText) {
      bodyHtml = `
        <div style="width: 100%; height: 70vh; background: var(--color-surface); border-radius: 8px; overflow: hidden; border: 1px solid var(--color-hairline);">
          <iframe src="${inlineUrl}" style="width: 100%; height: 100%; border: none; font-family: monospace;"></iframe>
        </div>
      `;
    } else {
      bodyHtml = `
        <div style="padding: 48px 24px; text-align: center; width: 100%;">
          <div style="margin-bottom: 14px; color: var(--color-ink);">${Icons.fileText(48)}</div>
          <div style="font-size: 15px; font-weight: 600; color: var(--color-ink);">${this.escapeHtml(fn)}</div>
          <p style="font-size: 13px; color: var(--color-mid-gray); margin-top: 6px; margin-bottom: 20px;">
            This file type cannot be previewed directly inline.
          </p>
          <div style="display: flex; justify-content: center; gap: 10px;">
            <a href="${inlineUrl}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px;">
              ${Icons.externalLink(14)} Open in Browser Tab
            </a>
            <a href="${downloadUrl}" class="btn btn-primary btn-sm" style="display: inline-flex; align-items: center; gap: 6px;">
              ${Icons.download(14)} Download File ${sizeStr}
            </a>
          </div>
        </div>
      `;
    }

    const modalHtml = `
      <div class="mail-preview-dialog-backdrop" onclick="if(event.target === this) App.closeMailPreviewModal()">
        <div class="mail-preview-dialog-card">
          <div class="mail-preview-dialog-header">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <span style="color: #4880ff; display: inline-flex;">${isImage ? Icons.image(18) : isPdf ? Icons.fileText(18) : Icons.paperclip(18)}</span>
              <div style="font-size: 14.5px; font-weight: 600; color: var(--color-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${this.escapeHtml(fn)} <span style="font-size: 12px; font-weight: 400; color: var(--color-mid-gray);">${sizeStr}</span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
              <a href="${inlineUrl}" target="_blank" class="btn btn-secondary btn-xs" title="Open in new window / tab" style="display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px;">
                ${Icons.externalLink(13)} <span style="font-size: 11.5px;">New Tab</span>
              </a>
              <a href="${downloadUrl}" class="btn btn-secondary btn-xs" title="Download to device" style="display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px;">
                ${Icons.download(13)} <span style="font-size: 11.5px;">Download</span>
              </a>
              <button type="button" class="btn-icon" onclick="App.closeMailPreviewModal()" title="Close preview" style="width: 28px; height: 28px;">
                ${Icons.close(16)}
              </button>
            </div>
          </div>
          <div class="mail-preview-dialog-body">
            ${bodyHtml}
          </div>
        </div>
      </div>
    `;

    let previewContainer = document.getElementById('mail-preview-container');
    if (!previewContainer) {
      previewContainer = document.createElement('div');
      previewContainer.id = 'mail-preview-container';
      document.body.appendChild(previewContainer);
    }
    previewContainer.innerHTML = modalHtml;
  },

  closeMailPreviewModal() {
    if (this._activePreviewBlobUrl) {
      try {
        URL.revokeObjectURL(this._activePreviewBlobUrl);
      } catch (e) {}
      this._activePreviewBlobUrl = null;
    }
    const el = document.getElementById('mail-preview-container');
    if (el) el.innerHTML = '';
  },

  openCreateMailLabelModal() {
    const colors = [
      { hex: '#00b69b', name: 'Teal' },
      { hex: '#5a8cff', name: 'Blue' },
      { hex: '#fd9a56', name: 'Orange' },
      { hex: '#d456fd', name: 'Purple' },
      { hex: '#ef4444', name: 'Red' },
      { hex: '#10b981', name: 'Emerald' },
    ];
    const html = `
      <div class="modal-header">
        <h3 style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          ${Icons.tag(16)} Create New Label
        </h3>
        <button class="btn-icon" onclick="App.closeModal()">${Icons.close(18)}</button>
      </div>
      <form onsubmit="App.submitCreateMailLabel(event)">
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px; padding-top: 12px;">
          <div class="form-group">
            <label>Label Name</label>
            <input type="text" id="new-mail-label-name" class="input" placeholder="e.g. Urgent, Proposals, Clients" required>
          </div>
          <div class="form-group">
            <label>Badge Color</label>
            <div style="display: flex; gap: 10px; margin-top: 6px;">
              ${colors.map((c, idx) => `
                <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12.5px;">
                  <input type="radio" name="new-mail-label-color" value="${c.hex}" ${idx === 1 ? 'checked' : ''}>
                  <span style="width: 16px; height: 16px; border-radius: 4px; background: ${c.hex}; display: inline-block;"></span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm" style="background: #4880ff; border-color: #4880ff; color: #fff;">Create Label</button>
        </div>
      </form>
    `;
    this.openModal(html);
  },

  async submitCreateMailLabel(event) {
    event.preventDefault();
    const name = document.getElementById('new-mail-label-name')?.value?.trim();
    const colorEl = document.querySelector('input[name="new-mail-label-color"]:checked');
    const color = colorEl ? colorEl.value : '#4880ff';
    if (!name) return;

    try {
      const res = await API.post('/api/mail/labels', { name, color });
      if (res && res.labels) {
        this._initMailState().labels = res.labels;
      }
      this.closeModal();
      API.showToast(`Label "${name}" created`, 'success');
      this.renderMailPageDOM();
    } catch (err) {
      console.error('Create label error:', err);
    }
  },

  renderMailPageDOM() {
    const pageEl = document.getElementById('page-content');
    if (!pageEl) return;

    const m = this._initMailState();
    const folderTitles = {
      inbox: 'Inbox',
      starred: 'Starred',
      sent: 'Sent',
      drafts: 'Draft',
      spam: 'Spam',
      important: 'Important',
      bin: 'Bin',
    };
    const activeTitle = folderTitles[m.folder] || 'Inbox';

    const folderItems = [
      { key: 'inbox', label: 'Inbox', icon: Icons.mail(16), count: m.folderCounts.inbox || 0 },
      { key: 'starred', label: 'Starred', icon: Icons.star(16), count: m.folderCounts.starred || 0 },
      { key: 'sent', label: 'Sent', icon: Icons.send(16), count: m.folderCounts.sent || 0 },
      { key: 'drafts', label: 'Draft', icon: Icons.edit(16), count: m.folderCounts.drafts || 0 },
      { key: 'spam', label: 'Spam', icon: Icons.alertTriangle(16), count: m.folderCounts.spam || 0 },
      { key: 'important', label: 'Important', icon: Icons.bell(16), count: m.folderCounts.important || 0 },
      { key: 'bin', label: 'Bin', icon: Icons.trash(16), count: m.folderCounts.bin || 0 },
    ];

    const labelsMap = {};
    (m.labels || []).forEach(l => {
      labelsMap[l.id] = l;
    });

    // Build Right Panel Content (Either Thread Reader OR Message List)
    let rightContentHtml = '';

    if (m.activeThread && m.activeThread.message) {
      const msg = m.activeThread.message;
      const threadList = m.activeThread.thread || [msg];
      const lblObj = labelsMap[msg.label] || { name: 'Primary', color: '#00b69b', bg: 'rgba(0, 182, 155, 0.14)' };
      const replyToAddr = msg.folderKey === 'sent' ? (msg.toEmails?.[0] || msg.toDisplay || '') : (msg.fromEmail || msg.fromDisplay || '');
      const defaultReplyAlias = (m.alias && m.alias !== 'all') ? m.alias : (msg.aliasEmail || 'admin@zero7.space');
      const allExpanded = threadList.length > 0 && threadList.every(t => m.expandedMessageIds ? m.expandedMessageIds.has(String(t.messageId)) : false);

      rightContentHtml = `
        <div class="mail-toolbar">
          <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
            <button class="btn btn-secondary btn-sm" onclick="App.closeMailThread()" style="display: inline-flex; align-items: center; gap: 6px;">
              ${Icons.arrowLeft(15)} Back
            </button>
            <div style="font-size: 15.5px; font-weight: 700; color: var(--color-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${this.escapeHtml(msg.subject || '(No Subject)')}
            </div>
            <span class="mail-tag-badge" style="background: ${lblObj.bg}; color: ${lblObj.color};">
              ${this.escapeHtml(lblObj.name)}
            </span>
            <span class="mail-alias-tag" title="Alias Mailbox">
              ${this.escapeHtml(msg.aliasName || 'Zero7')} (${this.escapeHtml(msg.aliasEmail || 'admin@zero7.space')})
            </span>
          </div>
          <div class="mail-action-group">
            ${threadList.length > 1 ? `
              <button id="mail-thread-toggle-all-btn" class="mail-action-btn" onclick="App.toggleAllThreadCards()" title="${allExpanded ? 'Collapse older messages' : 'Expand all messages in thread'}">
                ${allExpanded ? Icons.chevronUp(15) : Icons.chevronDown(15)}
              </button>
            ` : ''}
            <button class="mail-action-btn" onclick="App.bulkMailAction('archive', ['${msg.messageId}'])" title="Archive">
              ${Icons.archive(15)}
            </button>
            <button class="mail-action-btn" onclick="App.bulkMailAction('spam', ['${msg.messageId}'])" title="Report Spam">
              ${Icons.info(15)}
            </button>
            <button class="mail-action-btn" onclick="App.bulkMailAction('trash', ['${msg.messageId}'])" title="Move to Bin">
              ${Icons.trash(15)}
            </button>
          </div>
        </div>

        <div class="mail-thread-container">
          ${m.threadLoading ? `
            <div style="padding: 18px; display: flex; align-items: center; gap: 10px; color: var(--color-mid-gray); font-size: 13px;">
              ${Icons.loader(16)} Loading full thread conversation from Zoho Mail...
            </div>
          ` : ''}

          ${threadList.map((tItem, idx) => {
            const isMsgExpanded = m.expandedMessageIds ? m.expandedMessageIds.has(String(tItem.messageId)) : (idx === threadList.length - 1);
            const snippetText = this.getMailSnippet(tItem);
            return `
            <div class="mail-thread-card ${isMsgExpanded ? 'is-expanded' : 'is-collapsed'}" id="mail-thread-card-${this.escapeHtml(tItem.messageId || idx)}">
              <!-- Collapsed Pill Bar (Zoho & Gmail style compact row) -->
              <div class="mail-thread-pill-bar" onclick="App.toggleThreadCard('${this.escapeHtml(tItem.messageId || idx)}')">
                <div class="mail-thread-pill-left">
                  <div class="user-avatar" style="width: 28px; height: 28px; font-size: 11px; flex-shrink: 0; background: ${tItem.folderKey === 'sent' ? '#4880ff' : 'var(--color-primary)'}; color: #fff;">
                    ${this.escapeHtml((tItem.senderName || 'U').substring(0, 2).toUpperCase())}
                  </div>
                  <span class="mail-thread-pill-sender">${this.escapeHtml(tItem.senderName || tItem.fromDisplay || 'Sender')}</span>
                  ${tItem.folderKey === 'sent' ? `<span class="mail-alias-tag" style="background: rgba(72,128,255,0.12); color: #4880ff; border-color: transparent; font-size: 11px; padding: 1px 6px;">Sent</span>` : ''}
                  ${(tItem.attachments && tItem.attachments.length > 0) ? `
                    <span style="color: var(--color-mid-gray); display: inline-flex; align-items: center; gap: 3px; font-size: 11px;" title="${tItem.attachments.length} attachment(s)">
                      ${Icons.paperclip(13)}
                      <span>${tItem.attachments.length > 1 ? tItem.attachments.length : ''}</span>
                    </span>
                  ` : ''}
                  <span class="mail-thread-pill-snippet">${this.escapeHtml(snippetText)}</span>
                </div>
                <div class="mail-thread-pill-right">
                  <span class="mail-thread-pill-time">${this.formatMailFullDate(tItem.timestamp)}</span>
                  <button type="button" class="mail-thread-pill-chevron" title="Expand message">
                    ${Icons.chevronDown(14)}
                  </button>
                </div>
              </div>

              <!-- Expanded Message Card -->
              <div class="mail-thread-expanded-wrap">
                <div class="mail-thread-card-header" onclick="App.toggleThreadCard('${this.escapeHtml(tItem.messageId || idx)}')">
                  <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                    <div class="user-avatar" style="width: 32px; height: 32px; font-size: 12px; background: ${tItem.folderKey === 'sent' ? '#4880ff' : 'var(--color-primary)'}; color: #fff;">
                      ${this.escapeHtml((tItem.senderName || 'U').substring(0, 2).toUpperCase())}
                    </div>
                    <div style="min-width: 0;">
                      <div style="font-size: 13.5px; font-weight: 600; color: var(--color-ink); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span>${this.escapeHtml(tItem.senderName || tItem.fromDisplay || 'Sender')}</span>
                        <span style="font-size: 12px; font-weight: 400; color: var(--color-mid-gray);">&lt;${this.escapeHtml(tItem.fromEmail || tItem.fromDisplay)}&gt;</span>
                        ${tItem.folderKey === 'sent' ? `<span class="mail-alias-tag" style="background: rgba(72,128,255,0.12); color: #4880ff; border-color: transparent;">Sent via ${this.escapeHtml(tItem.fromEmail)}</span>` : ''}
                      </div>
                      <div style="font-size: 12px; color: var(--color-mid-gray); margin-top: 2px;">
                        To: ${this.escapeHtml(tItem.toDisplay || (tItem.toEmails && tItem.toEmails.length ? tItem.toEmails.join(', ') : (tItem.folderKey === 'sent' ? 'Recipient' : (tItem.aliasEmail || 'admin@zero7.space'))))}
                        ${tItem.ccDisplay ? ` &bull; Cc: ${this.escapeHtml(tItem.ccDisplay)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="font-size: 12px; color: var(--color-mid-gray); white-space: nowrap;">
                      ${this.formatMailFullDate(tItem.timestamp)}
                    </div>
                    <button type="button" class="mail-thread-pill-chevron" title="Collapse message" onclick="event.stopPropagation(); App.toggleThreadCard('${this.escapeHtml(tItem.messageId || idx)}')">
                      ${Icons.chevronUp(14)}
                    </button>
                  </div>
                </div>
                <div class="mail-thread-card-body">
                  ${this.renderMailMessageBodyHTML(tItem, tItem.messageId || idx)}

                  ${(tItem.attachments && tItem.attachments.length > 0) ? `
                    <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--color-hairline); display: flex; flex-wrap: wrap; gap: 8px;">
                      ${tItem.attachments.map(att => `
                        <button type="button"
                                class="mail-attachment-chip"
                                onclick="App.openMailAttachmentPreviewModal('${this.escapeHtml(tItem.folderId)}', '${this.escapeHtml(tItem.messageId)}', '${this.escapeHtml(att.attachmentId)}', '${this.escapeHtml(att.attachmentName)}', ${att.attachmentSize || 0})"
                                title="Click to preview ${this.escapeHtml(att.attachmentName)} inline">
                          ${Icons.paperclip(14)}
                          <span>${this.escapeHtml(att.attachmentName)}</span>
                          <span style="font-size: 11px; color: var(--color-mid-gray);">(${Math.max(1, Math.round((att.attachmentSize || 0) / 1024))} KB)</span>
                          <span style="font-size: 11px; color: #4880ff; font-weight: 600; margin-left: 2px;">Preview &rarr;</span>
                        </button>
                      `).join('')}
                    </div>

                    <!-- Inline Image Gallery for Attached Photos -->
                    ${(() => {
                      const imgAtts = (tItem.attachments || []).filter(a => {
                        const ext = (a.attachmentName || '').split('.').pop().toLowerCase();
                        return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
                      });
                      if (imgAtts.length === 0) return '';
                      return `
                        <div class="mail-attachment-gallery">
                          ${imgAtts.map(img => `
                            <div class="mail-attachment-thumbnail"
                                 onclick="App.openMailAttachmentPreviewModal('${this.escapeHtml(tItem.folderId)}', '${this.escapeHtml(tItem.messageId)}', '${this.escapeHtml(img.attachmentId)}', '${this.escapeHtml(img.attachmentName)}', ${img.attachmentSize || 0})"
                                 title="Click to preview ${this.escapeHtml(img.attachmentName)}">
                              <img src="/api/mail/attachments/${encodeURIComponent(tItem.folderId)}/${encodeURIComponent(tItem.messageId)}/${encodeURIComponent(img.attachmentId)}?name=${encodeURIComponent(img.attachmentName)}" alt="${this.escapeHtml(img.attachmentName)}" loading="lazy">
                              <div class="mail-attachment-thumbnail-badge">${this.escapeHtml(img.attachmentName)}</div>
                            </div>
                          `).join('')}
                        </div>
                      `;
                    })()}
                  ` : ''}
                </div>
              </div>
            </div>
            `;
          }).join('')}

          <!-- Inline Thread Reply Composer -->
          <div class="mail-thread-card" style="border-color: rgba(72, 128, 255, 0.35);">
            <form onsubmit="App.submitMailReply(event, '${this.escapeHtml(msg.messageId)}', '${this.escapeHtml(defaultReplyAlias)}', '${this.escapeHtml(replyToAddr)}', '${this.escapeHtml(msg.subject || '')}')">
              <div style="padding: 12px 16px; background: var(--color-surface-alt); border-bottom: 1px solid var(--color-hairline); display: flex; flex-wrap: wrap; align-items: center; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--color-ink-soft);">
                  ${Icons.reply(14)} Reply From Alias:
                  <select id="mail-reply-from" class="input" style="height: 30px; font-size: 12.5px; padding: 0 8px; width: auto;">
                    ${m.aliases.map(a => `
                      <option value="${this.escapeHtml(a.email)}" ${a.email === defaultReplyAlias ? 'selected' : ''}>
                        ${this.escapeHtml(a.displayName)} &lt;${this.escapeHtml(a.email)}&gt;
                      </option>
                    `).join('')}
                  </select>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--color-ink-soft); flex: 1; min-width: 200px;">
                  <span>To:</span>
                  <input type="text" id="mail-reply-to" class="input" style="height: 30px; font-size: 12.5px; flex: 1;" value="${this.escapeHtml(replyToAddr)}" required>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--color-ink-soft);">
                  <span>Cc:</span>
                  <input type="text" id="mail-reply-cc" class="input" style="height: 30px; font-size: 12.5px; width: 180px;" value="${this.escapeHtml(msg.ccDisplay || '')}" placeholder="Optional">
                </div>
              </div>
              <div style="padding: 14px 16px;">
                <textarea id="mail-reply-body" class="input" rows="4" placeholder="Write your reply here..." style="width: 100%; resize: vertical; font-family: var(--font-sans); line-height: 1.5; padding: 10px;" required></textarea>
                <div id="mail-reply-attachments-tray" class="mail-compose-tray" style="display: none; margin-top: 8px;"></div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="file" id="mail-reply-file-input" multiple onchange="App.onReplyFilesChanged(event)" style="display: none;">
                    <button type="button" class="btn btn-secondary btn-xs" onclick="document.getElementById('mail-reply-file-input').click()" style="display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px;">
                      ${Icons.paperclip(13)} Attach Files
                    </button>
                  </div>
                  <button type="submit" id="mail-reply-submit-btn" class="btn btn-primary btn-sm" style="background: #4880ff; border-color: #4880ff; color: #fff; padding: 0 18px; height: 34px; display: inline-flex; align-items: center; gap: 6px;">
                    ${Icons.send(14)} Send Reply
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      `;
    } else {
      rightContentHtml = `
        <div class="mail-toolbar">
          <div class="mail-search-pill">
            ${Icons.search(15)}
            <input type="text"
                   id="mail-search-input"
                   class="mail-search-input"
                   placeholder="Search mail"
                   value="${this.escapeHtml(m.search || '')}"
                   oninput="App.onMailSearchInput(this.value)">
          </div>

          <div style="display: flex; align-items: center; gap: 10px;">
            ${m.selectedIds.size > 0 ? `
              <select class="input" style="height: 36px; font-size: 12.5px; width: auto; padding: 0 10px;"
                      onchange="if(this.value){ App.bulkMailAction('assign_label', null, this.value); this.value=''; }">
                <option value="">Label (${m.selectedIds.size})...</option>
                ${m.labels.map(l => `<option value="${this.escapeHtml(l.id)}">${this.escapeHtml(l.name)}</option>`).join('')}
              </select>
            ` : ''}

            <button class="btn btn-secondary btn-sm" onclick="App.loadMailMessages(true)" title="Sync with Zoho Mail" style="height: 36px; padding: 0 10px;">
              ${m.loading ? Icons.loader(15) : Icons.refresh(15)}
            </button>

            <div class="mail-action-group">
              <button class="mail-action-btn" onclick="App.bulkMailAction('archive')" title="Archive Selected">
                ${Icons.archive(15)}
              </button>
              <button class="mail-action-btn" onclick="App.bulkMailAction('spam')" title="Mark as Spam">
                ${Icons.info(15)}
              </button>
              <button class="mail-action-btn" onclick="App.bulkMailAction('trash')" title="Delete / Move to Bin">
                ${Icons.trash(15)}
              </button>
            </div>
          </div>
        </div>

        <div class="mail-list-container">
          ${m.loading && m.messages.length === 0 ? `
            <div style="padding: 60px 20px; text-align: center; color: var(--color-mid-gray); font-size: 13.5px;">
              <div style="margin-bottom: 10px;">${Icons.loader(22)}</div>
              Syncing live emails from Zoho Mail...
            </div>
          ` : m.messages.length === 0 ? `
            <div style="padding: 64px 20px; text-align: center; color: var(--color-mid-gray);">
              <div style="margin-bottom: 10px; opacity: 0.5;">${Icons.mail(28)}</div>
              <div style="font-size: 14.5px; font-weight: 600; color: var(--color-ink);">No emails found</div>
              <div style="font-size: 12.5px; margin-top: 4px;">
                ${m.alias !== 'all' ? `No messages in ${activeTitle} for alias ${this.escapeHtml(m.alias)}.` : `Your ${activeTitle} folder is currently empty.`}
              </div>
            </div>
          ` : m.messages.map(msg => {
            const isChecked = m.selectedIds.has(String(msg.messageId));
            const lblObj = labelsMap[msg.label] || { name: 'Primary', color: '#00b69b', bg: 'rgba(0, 182, 155, 0.14)' };
            const displayPerson = m.folder === 'sent' ? `To: ${msg.recipientName || msg.toDisplay || 'Recipient'}` : (msg.senderName || msg.fromEmail || 'Unknown');
            return `
              <div class="mail-row ${isChecked ? 'selected' : ''} ${msg.isUnread ? 'unread' : ''}"
                   onclick="App.openMailThread('${this.escapeHtml(msg.folderId)}', '${this.escapeHtml(msg.messageId)}')">
                <input type="checkbox"
                       class="mail-checkbox"
                       ${isChecked ? 'checked' : ''}
                       onclick="App.toggleMailRowSelect(event, '${this.escapeHtml(msg.messageId)}')">

                <button type="button"
                        class="mail-star-btn"
                        onclick="App.toggleMailStar(event, '${this.escapeHtml(msg.messageId)}', ${msg.isStarred ? 'true' : 'false'})"
                        title="${msg.isStarred ? 'Starred' : 'Click to star'}">
                  ${msg.isStarred ? Icons.starFilled(16) : Icons.star(16)}
                </button>

                <div class="mail-sender-col">
                  <span class="mail-sender-name" title="${this.escapeHtml(msg.fromDisplay || displayPerson)}">
                    ${(msg.unreadCount && msg.unreadCount > 1) ? `<span style="color: #4880ff; font-weight: 700; margin-right: 4px;">(${msg.unreadCount})</span>` : ''}${this.escapeHtml(displayPerson)}
                  </span>
                  ${msg.threadCount > 1 ? `<span class="mail-thread-count-pill">${msg.threadCount}</span>` : ''}
                </div>

                <span class="mail-tag-badge" style="background: ${lblObj.bg}; color: ${lblObj.color};">
                  ${this.escapeHtml(lblObj.name)}
                </span>

                ${m.alias === 'all' ? `
                  <span class="mail-alias-tag" title="Alias: ${this.escapeHtml(msg.aliasEmail)}">
                    ${this.escapeHtml(msg.aliasName || 'Zero7')}
                  </span>
                ` : ''}

                <div class="mail-subject-col">
                  <span class="mail-subject-text">${this.escapeHtml(msg.subject || '(No Subject)')}</span>
                  ${msg.summary ? `<span class="mail-snippet-text"> &mdash; ${this.escapeHtml(msg.summary)}</span>` : ''}
                </div>

                ${msg.hasAttachment ? `
                  <span style="color: var(--color-mid-gray); display: inline-flex; align-items: center;" title="Has Attachment">
                    ${Icons.paperclip(14)}
                  </span>
                ` : ''}

                <div class="mail-time-col">
                  ${this.formatMailTimestamp(msg.timestamp)}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    pageEl.innerHTML = `
      <div class="mail-page-container">
        <!-- Top Header with Page Title & Alias Bifurcation Switcher -->
        <div class="mail-top-header">
          <div style="display: flex; align-items: baseline; gap: 12px;">
            <h1 class="mail-page-title">${this.escapeHtml(activeTitle)}</h1>
            ${m.alias !== 'all' ? `
              <span style="font-size: 13px; font-weight: 600; color: #4880ff; background: rgba(72, 128, 255, 0.1); padding: 3px 10px; border-radius: 999px;">
                Filtered by Alias: ${this.escapeHtml(m.alias)}
              </span>
            ` : ''}
          </div>

          <div class="mail-alias-switcher" title="Bifurcate incoming & outgoing mails by Zoho Alias">
            <button type="button"
                    class="mail-alias-pill ${m.alias === 'all' ? 'active' : ''}"
                    onclick="App.selectMailAlias('all')">
              <span>All Mailboxes</span>
              <span class="mail-alias-pill-count">${m.aliasCounts['all'] ?? 0}</span>
            </button>
            ${m.aliases.map(a => `
              <button type="button"
                      class="mail-alias-pill ${m.alias === a.email ? 'active' : ''}"
                      onclick="App.selectMailAlias('${this.escapeHtml(a.email)}')"
                      title="${this.escapeHtml(a.email)}">
                <span>${this.escapeHtml(a.displayName)}</span>
                <span class="mail-alias-pill-count">${m.aliasCounts[a.email] ?? 0}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Main Two-Column DashStack Inbox Layout -->
        <div class="mail-layout-grid">
          <!-- Left Mail Card -->
          <div class="mail-left-card">
            <button type="button" class="mail-compose-btn" onclick="App.openComposeMailModal()">
              ${Icons.plus(15)} Compose
            </button>

            <div class="mail-section-label">My Email</div>
            <div class="mail-folder-list">
              ${folderItems.map(f => `
                <button type="button"
                        class="mail-folder-item ${m.folder === f.key ? 'active' : ''}"
                        onclick="App.selectMailFolder('${f.key}')">
                  <span class="mail-folder-item-left">
                    ${f.icon}
                    <span>${this.escapeHtml(f.label)}</span>
                  </span>
                  <span class="mail-folder-count">${f.count}</span>
                </button>
              `).join('')}
            </div>

            <div class="mail-section-label" style="margin-top: 26px;">Label</div>
            <div class="mail-label-list">
              ${m.labels.map(l => `
                <button type="button"
                        class="mail-label-item ${m.label === l.id ? 'active' : ''}"
                        onclick="App.selectMailLabel('${this.escapeHtml(l.id)}')">
                  <span class="mail-label-box" style="color: ${this.escapeHtml(l.color)};">
                    ${m.label === l.id ? Icons.check(10, 3) : ''}
                  </span>
                  <span>${this.escapeHtml(l.name)}</span>
                </button>
              `).join('')}
            </div>

            <button type="button" class="mail-create-label-btn" onclick="App.openCreateMailLabelModal()">
              ${Icons.plus(14)} Create New Label
            </button>
          </div>

          <!-- Right Mail Column -->
          <div class="mail-right-column ${m.activeThread?.message ? 'has-reader' : ''}">
            ${m.activeThread?.message ? `
              <section class="mail-thread-index" aria-label="Messages in current folder">
                <div class="mail-thread-index-title">${this.escapeHtml(activeTitle)} <span>${m.pagination.total || m.messages.length}</span></div>
                ${m.messages.map(item => `
                  <button type="button" class="mail-thread-index-item ${String(item.messageId) === String(m.activeThread.message.messageId) ? 'active' : ''}"
                    data-mail-folder="${this.escapeHtml(item.folderId)}" data-mail-message="${this.escapeHtml(item.messageId)}"
                    onclick="App.openMailThread(this.dataset.mailFolder, this.dataset.mailMessage)">
                    <span class="mail-thread-index-person">${this.escapeHtml(m.folder === 'sent' ? (item.recipientName || item.toDisplay || 'Recipient') : (item.senderName || item.fromEmail || 'Unknown'))}</span>
                    <span class="mail-thread-index-subject">${this.escapeHtml(item.subject || '(No Subject)')}</span>
                    <span class="mail-thread-index-summary">${this.escapeHtml(item.summary || '')}</span>
                    <time>${this.formatMailTimestamp(item.timestamp)}</time>
                  </button>
                `).join('')}
              </section>
            ` : ''}
            <div class="mail-right-card">
              ${rightContentHtml}
            </div>

            ${!m.activeThread ? `
              <div class="mail-pagination-footer">
                <div>
                  Showing ${m.pagination.start}-${m.pagination.end} of ${m.pagination.total}
                </div>
                <div class="mail-page-nav-group">
                  <button type="button"
                          class="mail-page-nav-btn"
                          ${m.pagination.page <= 1 ? 'disabled' : ''}
                          onclick="App.changeMailPage(-1)"
                          title="Previous Page">
                    ${Icons.chevronLeft(15)}
                  </button>
                  <button type="button"
                          class="mail-page-nav-btn"
                          ${m.pagination.page >= (m.pagination.totalPages || 1) ? 'disabled' : ''}
                          onclick="App.changeMailPage(1)"
                          title="Next Page">
                    ${Icons.chevronRight(15)}
                  </button>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  // ==========================================================================
  // ZERO7 WHATSAPP CENTRAL INBOX INTEGRATION
  // ==========================================================================

  _initWhatsAppState() {
    if (!this._waCentralState) {
      this._waCentralState = {
        conversations: [],
        activePhone: null,
        activeConversation: null,
        messages: [],
        filter: 'all', // 'all', 'leads', 'unlinked'
        searchQuery: '',
        isNewChatView: false,
        newChatQuery: '',
        account: { online: false, status: 'disconnected', phone: '9479007951', userName: 'Zero7 Central' },
        loadingList: false,
        loadingChat: false,
        sending: false
      };
    }
    return this._waCentralState;
  },

  async renderWhatsAppView(forceRefresh = false) {
    const s = this._initWhatsAppState();
    this.renderWhatsAppPageDOM();
    await this.loadCentralWhatsAppChats(forceRefresh);
  },

  renderWhatsAppPageDOM() {
    const pageEl = document.getElementById('page-content');
    if (!pageEl) return;
    const s = this._initWhatsAppState();

    pageEl.innerHTML = `
      <div class="wa-central-container">

        <!-- Top Navigation Bar -->
        <div class="wa-central-topbar">
          <div class="wa-central-title-group">
            <span style="color: #16a34a; display: flex; align-items: center;">${Icons.whatsapp(22)}</span>
            <h2 style="font-size: 17px; font-weight: 700; color: var(--color-ink); margin: 0; letter-spacing: -0.02em;">Zero7 WhatsApp Central</h2>
            <div id="wa-central-status-badge" class="wa-central-badge ${s.account.status === 'connected' ? '' : 'disconnected'}">
              <span style="width: 7px; height: 7px; border-radius: 50%; background: currentColor;"></span>
              <span>+91 94790 07951 &bull; ${s.account.status === 'connected' ? 'Connected' : (s.account.status || 'Connecting...')}</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="App.refreshWhatsAppCentral()" title="Refresh Chats and Status" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 4px 10px;">
              ${Icons.refresh(13)}
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <!-- Main Workspace -->
        <div class="wa-central-layout">
          <!-- Left Panel: Chat List / New Chat Sidebar -->
          <div class="wa-chat-list-panel" id="wa-sidebar-panel">
            ${this.renderWhatsAppSidebarHTML()}
          </div>

          <!-- Right Panel: Conversation Stream or Empty State -->
          <div class="wa-chat-view-panel" id="wa-chat-view-container">
            ${this.renderWhatsAppChatDetailHTML()}
          </div>
        </div>
      </div>
    `;
  },

  async loadCentralWhatsAppChats(forceRefresh = false) {
    const s = this._initWhatsAppState();
    s.loadingList = true;
    try {
      const res = await API.get('/api/whatsapp/central/conversations');
      if (res && res.status === 'success') {
        s.conversations = res.conversations || [];
        if (res.account) {
          s.account = res.account;
          const badge = document.getElementById('wa-central-status-badge');
          if (badge) {
            badge.className = `wa-central-badge ${s.account.status === 'connected' ? '' : 'disconnected'}`;
            badge.innerHTML = `
              <span style="width: 7px; height: 7px; border-radius: 50%; background: currentColor;"></span>
              <span>+91 94790 07951 &bull; ${s.account.status === 'connected' ? 'Connected' : (s.account.status || 'Connecting...')}</span>
            `;
          }
        }
      }
    } catch (err) {
      console.error('[WHATSAPP CENTRAL] Error loading conversations:', err);
    } finally {
      s.loadingList = false;
      const listContainer = document.getElementById('wa-conversations-container');
      if (listContainer) {
        listContainer.innerHTML = this.renderWhatsAppConversationsListHTML();
      }
      // If we don't have an active phone yet, but have conversations, auto-select the first conversation
      if (!s.activePhone && s.conversations.length > 0 && window.innerWidth >= 768) {
        this.selectWhatsAppChat(s.conversations[0].phone);
      } else if (s.activePhone) {
        this.selectWhatsAppChat(s.activePhone, false);
      }
    }
  },

  formatWhatsAppDate(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      }
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  },

  _getLeadAvatarColor(str = '') {
    const colors = [
      '#059669', '#2563eb', '#7c3aed', '#db2777', '#d97706',
      '#0d9488', '#4f46e5', '#ea580c', '#0891b2', '#16a34a'
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  },

  renderWhatsAppSidebarHTML() {
    const s = this._initWhatsAppState();
    if (s.isNewChatView) {
      return this.renderWhatsAppNewChatSidebarHTML();
    }

    return `
      <div class="wa-search-header">
        <div style="display: flex; gap: 8px; align-items: center;">
          <div class="wa-search-box" style="flex: 1;">
            <span style="color: hsl(var(--muted-foreground)); display: flex; align-items: center;">${Icons.search(14)}</span>
            <input type="text" id="wa-chat-search" placeholder="Search or type phone number..." value="${this.escapeHtml(s.searchQuery)}" oninput="App.handleWhatsAppSearch(this.value)">
          </div>
          <button type="button" class="wa-new-chat-btn" onclick="App.openNewWhatsAppChatView()" title="Start New WhatsApp Chat">
            ${Icons.plus(13)}
            <span>New Chat</span>
          </button>
        </div>
        <div class="wa-filter-tabs">
          <button type="button" class="wa-filter-tab ${s.filter === 'all' ? 'active' : ''}" onclick="App.setWhatsAppFilter('all')">All</button>
          <button type="button" class="wa-filter-tab ${s.filter === 'leads' ? 'active' : ''}" onclick="App.setWhatsAppFilter('leads')">CRM Leads</button>
          <button type="button" class="wa-filter-tab ${s.filter === 'unlinked' ? 'active' : ''}" onclick="App.setWhatsAppFilter('unlinked')">Unlinked</button>
        </div>
      </div>

      <div class="wa-conversations-list" id="wa-conversations-container">
        ${this.renderWhatsAppConversationsListHTML()}
      </div>
    `;
  },

  renderWhatsAppNewChatSidebarHTML() {
    const s = this._initWhatsAppState();
    const hasQuery = !!(s.newChatQuery || '').trim();

    return `
      <div class="wa-new-chat-sidebar">
        <!-- Header with Back Arrow and Title -->
        <div class="wa-new-chat-header">
          <button type="button" class="btn-icon" onclick="App.closeNewWhatsAppChatView()" title="Back to chats" style="width: 32px; height: 32px; border-radius: 50%; color: hsl(var(--foreground));">
            ${Icons.arrowLeft(18)}
          </button>
          <span class="wa-new-chat-title">New chat</span>
        </div>

        <!-- Search Input -->
        <div class="wa-new-chat-search-wrap">
          <div class="wa-search-box" style="position: relative;">
            <span style="color: hsl(var(--muted-foreground)); display: flex; align-items: center;">${Icons.search(14)}</span>
            <input type="text"
                   id="wa-new-chat-search"
                   placeholder="Search name or number"
                   value="${this.escapeHtml(s.newChatQuery || '')}"
                   oninput="App.handleNewChatSearch(this.value)"
                   autocomplete="off">
            ${hasQuery ? `
              <button type="button" class="wa-new-chat-clear-btn" onclick="App.clearNewChatSearch()" title="Clear search" style="background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; align-items: center;">
                ${Icons.close(13)}
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Contact Results -->
        <div class="wa-new-chat-results" id="wa-new-chat-results-container">
          ${this.renderWhatsAppNewChatResultsHTML()}
        </div>
      </div>
    `;
  },

  renderWhatsAppNewChatResultsHTML() {
    const s = this._initWhatsAppState();
    const q = (s.newChatQuery || '').trim();
    const qLower = q.toLowerCase();
    const digits = q.replace(/\D/g, '');

    let html = '';

    // Direct phone dialing card if >= 7 digits entered
    if (digits.length >= 7) {
      const formattedNumber = digits.length === 10 ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : `+${digits}`;
      html += `
        <div class="wa-new-chat-direct-item" onclick="App.startWhatsAppChatWithPhone('${digits}')" title="Directly message ${formattedNumber}">
          <div class="wa-new-chat-direct-icon">
            ${Icons.whatsapp(18)}
          </div>
          <div class="wa-new-chat-direct-body">
            <div class="wa-new-chat-direct-title">Chat with ${formattedNumber}</div>
            <div class="wa-new-chat-direct-sub">Send direct message outside CRM</div>
          </div>
        </div>
      `;
    }

    // Filter CRM Leads
    const allLeads = this.state.leads || [];
    let matchedLeads = [];

    if (q) {
      matchedLeads = allLeads.filter(lead => {
        const name = (lead.name || '').toLowerCase();
        const biz = (lead.business_name || '').toLowerCase();
        const phone = (lead.phone || '').replace(/\D/g, '');
        const city = (lead.city || '').toLowerCase();
        return name.includes(qLower) || biz.includes(qLower) || (digits && phone.includes(digits)) || city.includes(qLower);
      });

      matchedLeads.sort((a, b) => {
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        const aStarts = aName.startsWith(qLower);
        const bStarts = bName.startsWith(qLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return aName.localeCompare(bName);
      });
    } else {
      matchedLeads = [...allLeads].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    if (matchedLeads.length > 0) {
      html += `
        <div class="wa-new-chat-section-label">CONTACTS ON CRM (${matchedLeads.length})</div>
      `;
      html += matchedLeads.map(lead => {
        const rawPhone = lead.phone ? String(lead.phone).replace(/\D/g, '') : '';
        const norm10 = rawPhone.length >= 10 ? rawPhone.slice(-10) : rawPhone;
        const displayPhone = norm10 ? `+91 ${norm10.slice(0, 5)} ${norm10.slice(5)}` : 'No phone';
        const cleanName = (lead.name || '').replace(/[^a-zA-Z0-9\s]/g, '').trim();
        const initials = (cleanName ? cleanName.split(/\s+/).map(p => p[0]).join('').substring(0, 2) : 'Z7').toUpperCase();
        const avatarColor = this._getLeadAvatarColor(lead.name || String(lead.id));

        return `
          <div class="wa-new-chat-contact-item" onclick="App.startWhatsAppChatFromLead('${lead.id}')">
            <div class="wa-new-chat-avatar" style="background: ${avatarColor};">
              ${this.escapeHtml(initials)}
            </div>
            <div class="wa-new-chat-contact-info">
              <div class="wa-new-chat-contact-top">
                <span class="wa-new-chat-contact-name">${this.escapeHtml(lead.name || 'Unnamed Lead')}</span>
                ${lead.city ? `<span style="font-size: 10px; color: hsl(var(--muted-foreground)); background: hsl(var(--muted)); padding: 1px 6px; border-radius: 4px;">${this.escapeHtml(lead.city)}</span>` : ''}
              </div>
              <div class="wa-new-chat-contact-sub">
                ${lead.business_name ? `<span class="wa-new-chat-biz">${this.escapeHtml(lead.business_name)}</span> &bull; ` : ''}
                <span class="wa-new-chat-phone">${displayPhone}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    if (!html) {
      return `
        <div style="text-align: center; padding: 40px 16px; color: hsl(var(--muted-foreground)); font-size: 13px;">
          ${Icons.search(22)}
          <div style="margin-top: 8px; font-weight: 500;">No contacts found</div>
          <div style="font-size: 12px; opacity: 0.8; margin-top: 3px;">
            ${q ? `No saved lead matches "${this.escapeHtml(q)}". Enter a 10-digit number to chat directly.` : 'No contacts available in CRM.'}
          </div>
        </div>
      `;
    }

    return html;
  },

  async startWhatsAppChatFromLead(leadId) {
    const lead = (this.state.leads || []).find(l => l.id === leadId);
    if (!lead) return;
    await this.startWhatsAppChatWithPhone(lead.phone, lead.name);
  },

  async openNewWhatsAppChatView(prefill = '') {
    const s = this._initWhatsAppState();
    s.isNewChatView = true;
    s.newChatQuery = prefill || '';

    if (!this.state.leads || this.state.leads.length === 0) {
      this.loadInitialData().then(() => {
        const resBox = document.getElementById('wa-new-chat-results-container');
        if (resBox && s.isNewChatView) {
          resBox.innerHTML = this.renderWhatsAppNewChatResultsHTML();
        }
      });
    }

    const sidebarEl = document.getElementById('wa-sidebar-panel');
    if (sidebarEl) {
      sidebarEl.innerHTML = this.renderWhatsAppSidebarHTML();
    }

    setTimeout(() => {
      const input = document.getElementById('wa-new-chat-search');
      if (input) {
        input.focus();
        if (prefill) {
          input.setSelectionRange(prefill.length, prefill.length);
        }
      }
    }, 50);
  },

  closeNewWhatsAppChatView() {
    const s = this._initWhatsAppState();
    s.isNewChatView = false;
    s.newChatQuery = '';
    const sidebarEl = document.getElementById('wa-sidebar-panel');
    if (sidebarEl) {
      sidebarEl.innerHTML = this.renderWhatsAppSidebarHTML();
    }
  },

  handleNewChatSearch(val) {
    const s = this._initWhatsAppState();
    s.newChatQuery = val;
    const resBox = document.getElementById('wa-new-chat-results-container');
    if (resBox) {
      resBox.innerHTML = this.renderWhatsAppNewChatResultsHTML();
    }
    const searchWrap = document.querySelector('.wa-new-chat-search-wrap');
    if (searchWrap) {
      const existingClear = searchWrap.querySelector('.wa-new-chat-clear-btn');
      if (val.trim()) {
        if (!existingClear) {
          const searchBox = searchWrap.querySelector('.wa-search-box');
          if (searchBox) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'wa-new-chat-clear-btn';
            btn.style.cssText = 'background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; align-items: center;';
            btn.title = 'Clear search';
            btn.innerHTML = Icons.close(13);
            btn.onclick = () => App.clearNewChatSearch();
            searchBox.appendChild(btn);
          }
        }
      } else if (existingClear) {
        existingClear.remove();
      }
    }
  },

  clearNewChatSearch() {
    const s = this._initWhatsAppState();
    s.newChatQuery = '';
    const input = document.getElementById('wa-new-chat-search');
    if (input) {
      input.value = '';
      input.focus();
    }
    const clearBtn = document.querySelector('.wa-new-chat-clear-btn');
    if (clearBtn) clearBtn.remove();

    const resBox = document.getElementById('wa-new-chat-results-container');
    if (resBox) {
      resBox.innerHTML = this.renderWhatsAppNewChatResultsHTML();
    }
  },

  renderWhatsAppConversationsListHTML() {
    const s = this._initWhatsAppState();
    let items = s.conversations || [];

    // Filter
    if (s.filter === 'leads') {
      items = items.filter(c => c.is_linked);
    } else if (s.filter === 'unlinked') {
      items = items.filter(c => !c.is_linked);
    }

    // Direct launch banner if user typed phone digits in search
    let directActionHTML = '';
    const cleanQueryDigits = (s.searchQuery || '').replace(/\D/g, '');
    if (cleanQueryDigits.length >= 7) {
      const displayDigits = cleanQueryDigits.length === 10 ? cleanQueryDigits : cleanQueryDigits.slice(-10);
      directActionHTML = `
        <div class="wa-direct-launch-banner" onclick="App.startWhatsAppChatWithPhone('${cleanQueryDigits}')" title="Start new WhatsApp chat with +91 ${displayDigits}">
          <div style="display: flex; align-items: center; gap: 9px;">
            <div style="width: 28px; height: 28px; border-radius: 50%; background: #16a34a; color: white; display: flex; align-items: center; justify-content: center;">
              ${Icons.whatsapp(15)}
            </div>
            <div>
              <div style="font-size: 12.5px; font-weight: 600; color: hsl(var(--foreground));">Start chat with +91 ${displayDigits}</div>
              <div style="font-size: 11px; color: hsl(var(--muted-foreground));">Direct outbound WhatsApp message</div>
            </div>
          </div>
          <span style="font-size: 11px; font-weight: 600; color: #16a34a; display: flex; align-items: center; gap: 2px;">Chat &rarr;</span>
        </div>
      `;
    }

    // Search
    if (s.searchQuery) {
      const q = s.searchQuery.toLowerCase().trim();
      items = items.filter(c => {
        const phone = (c.phone || '').toLowerCase();
        const name = (c.lead_name || '').toLowerCase();
        const bname = (c.business_name || '').toLowerCase();
        const msg = (c.last_message || '').toLowerCase();
        return phone.includes(q) || name.includes(q) || bname.includes(q) || msg.includes(q);
      });
    }

    if (items.length === 0) {
      return directActionHTML + `
        <div style="padding: 32px 16px; text-align: center; color: hsl(var(--muted-foreground)); font-size: 13px;">
          ${Icons.messageSquare(24)}
          <div style="margin-top: 8px; font-weight: 500;">No conversations found</div>
          <div style="font-size: 11.5px; opacity: 0.8; margin-top: 2px;">
            ${s.searchQuery ? 'Try clearing your search query or click New Chat' : 'Messages to Zero7 Central (+91 94790 07951) will appear here'}
          </div>
          <div style="margin-top: 14px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="App.openNewWhatsAppChatView('${this.escapeHtml(s.searchQuery || '')}')" style="font-size: 12px; display: inline-flex; align-items: center; gap: 4px;">
              ${Icons.plus(12)} Start New Chat
            </button>
          </div>
        </div>
      `;
    }

    return directActionHTML + items.map(c => {
      const isActive = c.phone === s.activePhone;
      const displayName = c.lead_name || `+${c.phone.startsWith('91') ? c.phone : '91 ' + c.phone}`;
      const initials = (c.lead_name ? c.lead_name.split(' ').map(p => p[0]).join('').substring(0, 2) : c.phone.slice(-2)).toUpperCase();
      const timeStr = this.formatWhatsAppDate(c.last_timestamp);
      const isOutgoing = c.last_direction === 'outgoing';


      return `
        <div class="wa-conv-item ${isActive ? 'active' : ''}" onclick="App.selectWhatsAppChat('${c.phone}')">
          <div class="wa-conv-avatar">
            ${initials}
          </div>
          <div class="wa-conv-content">
            <div class="wa-conv-header-row">
              <span class="wa-conv-name" title="${this.escapeHtml(displayName)}">${this.escapeHtml(displayName)}</span>
              <span class="wa-conv-time">${timeStr}</span>
            </div>
            <div class="wa-conv-meta-row">
              ${c.is_linked ? `
                <span class="wa-lead-tag" title="${this.escapeHtml(c.business_name || c.lead_name)}">
                  ${Icons.target(10)} ${this.escapeHtml(c.business_name || 'CRM Lead')}
                </span>
                ${c.status ? `<span style="font-size: 10px; color: hsl(var(--muted-foreground)); text-transform: uppercase;">&bull; ${c.status}</span>` : ''}
              ` : `
                <span class="wa-unlinked-tag">Unlinked</span>
              `}
            </div>
            <div class="wa-conv-snippet-row">
              <span class="wa-conv-snippet">
                ${isOutgoing ? `<span style="color: #53bdeb; font-weight: bold; margin-right: 2px;">&check;&check;</span>` : ''}
                ${this.escapeHtml(c.last_message || 'Media attachment')}
              </span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  async selectWhatsAppChat(phone, reloadMessages = true) {
    const s = this._initWhatsAppState();
    s.activePhone = phone;
    s.activeConversation = s.conversations.find(c => c.phone === phone) || null;

    // Update active highlight in left list
    document.querySelectorAll('.wa-conv-item').forEach(el => el.classList.remove('active'));
    const matchingEl = document.querySelector(`.wa-conv-item[onclick*="${phone}"]`);
    if (matchingEl) matchingEl.classList.add('active');

    if (reloadMessages) {
      s.loadingChat = true;
      const viewContainer = document.getElementById('wa-chat-view-container');
      if (viewContainer) {
        viewContainer.innerHTML = this.renderWhatsAppChatDetailHTML();
      }
      try {
        const res = await API.get(`/api/whatsapp/central/conversations/${encodeURIComponent(phone)}`);
        if (res && res.status === 'success') {
          s.messages = res.messages || [];
          if (res.lead) {
            s.activeLead = res.lead;
            if (s.activeConversation) {
              s.activeConversation.lead_id = res.lead.id;
              s.activeConversation.lead_name = res.lead.name;
              s.activeConversation.business_name = res.lead.business_name;
              s.activeConversation.is_linked = true;
            }
          }
        }
      } catch (err) {
        console.error('[WHATSAPP CENTRAL] Error fetching chat messages:', err);
      } finally {
        s.loadingChat = false;
        if (viewContainer) {
          viewContainer.innerHTML = this.renderWhatsAppChatDetailHTML();
          this.scrollWhatsAppToBottom();
        }
      }
    } else {
      const viewContainer = document.getElementById('wa-chat-view-container');
      if (viewContainer) {
        viewContainer.innerHTML = this.renderWhatsAppChatDetailHTML();
        this.scrollWhatsAppToBottom();
      }
    }
  },

  renderWhatsAppChatDetailHTML() {
    const s = this._initWhatsAppState();
    if (!s.activePhone) {
      return `
        <div class="wa-empty-selection">
          <div class="wa-empty-icon">
            ${Icons.whatsapp(36)}
          </div>
          <div style="font-size: 18px; font-weight: 600; color: hsl(var(--foreground));">Zero7 WhatsApp Central</div>
          <div style="max-width: 380px; font-size: 13px; line-height: 1.5; color: hsl(var(--muted-foreground));">
            Select a conversation on the left to review messages, link with CRM leads, and send real-time replies from <strong>+91 94790 07951</strong>.
          </div>
        </div>
      `;
    }

    const c = s.activeConversation || {};
    const lead = s.activeLead || (c.lead_id ? { id: c.lead_id, name: c.lead_name, business_name: c.business_name, status: c.status } : null);
    const displayName = (lead && lead.name) || c.lead_name || `+${s.activePhone.startsWith('91') ? s.activePhone : '91 ' + s.activePhone}`;
    const initials = displayName.split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase();

    // Group messages by date
    let lastDate = '';
    const messagesHTML = (s.messages || []).map(m => {
      const mDate = new Date(m.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      let dateDivider = '';
      if (mDate !== lastDate) {
        lastDate = mDate;
        const isToday = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) === mDate;
        dateDivider = `
          <div class="wa-date-separator">
            <span class="wa-date-pill">${isToday ? 'Today' : mDate}</span>
          </div>
        `;
      }

      const isOut = m.direction === 'outgoing';
      const timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

      return `
        ${dateDivider}
        <div class="wa-message-row ${isOut ? 'outgoing' : 'incoming'}">
          <div class="wa-bubble ${isOut ? 'outgoing' : 'incoming'}">
            <div class="wa-bubble-text">${this.escapeHtml(m.message_text || '')}</div>
            <div class="wa-bubble-meta">
              <span>${timeStr}</span>
              ${isOut ? `
                <span class="wa-ticks read" title="Delivered">&check;&check;</span>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <!-- Active Conversation Header -->
      <div class="wa-chat-view-header">
        <div class="wa-chat-view-contact">
          <div class="wa-conv-avatar" style="width: 38px; height: 38px; font-size: 13.5px;">
            ${initials}
          </div>
          <div class="wa-chat-view-info">
            <h3 class="wa-chat-view-title">
              <span>${this.escapeHtml(displayName)}</span>
              ${lead ? `
                <span class="wa-lead-tag" style="font-size: 11px; padding: 2px 8px;">
                  ${Icons.target(11)} ${this.escapeHtml(lead.business_name || lead.name)}
                </span>
              ` : `
                <span class="wa-unlinked-tag">Unlinked</span>
              `}
            </h3>
            <div class="wa-chat-view-subtitle">
              <span>+${s.activePhone.startsWith('91') ? s.activePhone : '91 ' + s.activePhone}</span>
              ${lead ? `
                <span>&bull;</span>
                <a href="#/leads/${lead.id}" onclick="App.viewLead('${lead.id}'); return false;" style="color: #2563eb; text-decoration: none; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;">
                  Open CRM Lead &rarr;
                </a>
              ` : `
                <span>&bull;</span>
                <button type="button" class="btn btn-secondary btn-sm" onclick="App.openLinkLeadModal('${s.activePhone}')" style="font-size: 11px; padding: 1px 7px; height: 22px;">
                  ${Icons.link(10)} Link Lead
                </button>
                <button type="button" class="btn btn-primary btn-sm" onclick="App.openCreateLeadModal('${s.activePhone}')" style="font-size: 11px; padding: 1px 7px; height: 22px;">
                  ${Icons.plus(10)} New Lead
                </button>
              `}
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 6px;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.selectWhatsAppChat('${s.activePhone}', true)" title="Refresh Conversation" style="padding: 6px 9px;">
            ${Icons.refresh(14)}
          </button>
        </div>
      </div>

      <!-- Messages Body Stream -->
      <div class="wa-chat-body-stream" id="wa-stream-box">
        ${s.loadingChat ? `
          <div style="text-align: center; padding: 40px; color: hsl(var(--muted-foreground));">
            ${Icons.refresh(20)}
            <div style="margin-top: 8px; font-size: 13px;">Loading messages...</div>
          </div>
        ` : (
          messagesHTML || `
            <div class="wa-date-separator">
              <span class="wa-date-pill">Conversation Started</span>
            </div>
            <div style="text-align: center; color: hsl(var(--muted-foreground)); font-size: 12.5px; padding: 20px;">
              No messages exchanged yet with this contact. Send a message below to start chatting.
            </div>
          `
        )}
      </div>

      <!-- Composer Bar -->
      <div class="wa-chat-composer-bar">
        <button type="button" class="wa-composer-btn" title="Attach file or photo" onclick="API.showToast('Attaching media via Zero7 Central will be enabled in next release.', 'info')">
          ${Icons.paperclip(18)}
        </button>
        <button type="button" class="wa-composer-btn" title="Add emoji" onclick="API.showToast('Emoji picker ready', 'info')">
          ${Icons.smile(18)}
        </button>

        <div class="wa-composer-input-container">
          <textarea id="wa-composer-input"
                    class="wa-composer-textarea"
                    placeholder="Type a message"
                    rows="1"
                    onkeydown="App.handleWhatsAppComposerKeydown(event)"
                    oninput="this.style.height = ''; this.style.height = Math.min(this.scrollHeight, 100) + 'px';"></textarea>
        </div>

        <button type="button"
                id="wa-send-btn"
                class="wa-send-btn"
                onclick="App.sendCentralWhatsAppMessage()"
                title="Send Message (Enter)">
          ${Icons.send(16)}
        </button>
      </div>
    `;
  },

  scrollWhatsAppToBottom() {
    setTimeout(() => {
      const box = document.getElementById('wa-stream-box');
      if (box) box.scrollTop = box.scrollHeight;
    }, 50);
  },

  handleWhatsAppComposerKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendCentralWhatsAppMessage();
    }
  },

  async sendCentralWhatsAppMessage() {
    const s = this._initWhatsAppState();
    if (!s.activePhone || s.sending) return;

    const input = document.getElementById('wa-composer-input');
    const sendBtn = document.getElementById('wa-send-btn');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    s.sending = true;
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.innerHTML = Icons.refresh(16);
    }

    const streamBox = document.getElementById('wa-stream-box');
    const tempId = 'temp_' + Date.now();
    const nowTime = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

    // Optimistic UI append
    if (streamBox) {
      const tempRow = document.createElement('div');
      tempRow.id = tempId;
      tempRow.className = 'wa-message-row outgoing';
      tempRow.innerHTML = `
        <div class="wa-bubble outgoing">
          <div class="wa-bubble-text">${this.escapeHtml(text)}</div>
          <div class="wa-bubble-meta">
            <span>${nowTime}</span>
            <span class="wa-ticks delivered">&check;</span>
          </div>
        </div>
      `;
      streamBox.appendChild(tempRow);
      this.scrollWhatsAppToBottom();
    }

    try {
      const payload = {
        recipient_phone: s.activePhone,
        message_text: text,
        lead_id: s.activeLead?.id || s.activeConversation?.lead_id || null
      };

      const res = await API.post('/api/whatsapp/central/send', payload);
      if (res && res.status === 'success') {
        input.value = '';
        input.style.height = 'auto';

        // Update tick to double tick
        const tempEl = document.getElementById(tempId);
        if (tempEl) {
          const tickEl = tempEl.querySelector('.wa-ticks');
          if (tickEl) {
            tickEl.className = 'wa-ticks read';
            tickEl.innerHTML = '&check;&check;';
          }
        }

        // Add to local message list
        if (res.message) {
          s.messages.push(res.message);
        } else {
          s.messages.push({
            direction: 'outgoing',
            message_text: text,
            timestamp: new Date().toISOString(),
            status: 'delivered'
          });
        }

        // Update conversation snippet in left list
        if (s.activeConversation) {
          s.activeConversation.last_message = text;
          s.activeConversation.last_direction = 'outgoing';
          s.activeConversation.last_timestamp = new Date().toISOString();
        }

        const listContainer = document.getElementById('wa-conversations-container');
        if (listContainer) {
          listContainer.innerHTML = this.renderWhatsAppConversationsListHTML();
        }
      } else {
        API.showToast(res?.detail || 'Failed to send WhatsApp message.', 'error');
        const tempEl = document.getElementById(tempId);
        if (tempEl) tempEl.remove();
      }
    } catch (err) {
      console.error('[WHATSAPP CENTRAL] Send error:', err);
      API.showToast(err.message || 'Failed to dispatch message via WhatsApp socket.', 'error');
      const tempEl = document.getElementById(tempId);
      if (tempEl) tempEl.remove();
    } finally {
      s.sending = false;
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = Icons.send(16);
      }
      if (input) input.focus();
    }
  },

  setWhatsAppFilter(filter) {
    const s = this._initWhatsAppState();
    s.filter = filter;
    document.querySelectorAll('.wa-filter-tab').forEach(btn => {
      btn.classList.toggle('active', btn.textContent.toLowerCase().includes(filter));
    });
    const listContainer = document.getElementById('wa-conversations-container');
    if (listContainer) {
      listContainer.innerHTML = this.renderWhatsAppConversationsListHTML();
    }
  },

  handleWhatsAppSearch(query) {
    const s = this._initWhatsAppState();
    s.searchQuery = query;
    const listContainer = document.getElementById('wa-conversations-container');
    if (listContainer) {
      listContainer.innerHTML = this.renderWhatsAppConversationsListHTML();
    }
  },

  async refreshWhatsAppCentral() {
    API.showToast('Refreshing WhatsApp chats and daemon status...', 'info');
    await this.loadCentralWhatsAppChats(true);
    API.showToast('WhatsApp Central refreshed.', 'success');
  },

  openNewWhatsAppChatModal(prefill = '') {
    this.openNewWhatsAppChatView(prefill);
  },

  async submitStartNewWhatsAppChat() {
    // Deprecated modal handler kept as compatibility stub
  },

  async startWhatsAppChatWithPhone(phone, optionalName = '', initialMsg = '') {
    const s = this._initWhatsAppState();
    s.isNewChatView = false;
    s.newChatQuery = '';

    const sidebarEl = document.getElementById('wa-sidebar-panel');
    if (sidebarEl) {
      sidebarEl.innerHTML = this.renderWhatsAppSidebarHTML();
    }

    let cleanDigits = String(phone).replace(/\D/g, '');
    if (cleanDigits.length === 10) cleanDigits = '91' + cleanDigits;
    const norm10 = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;

    // Check if existing conversation exists in s.conversations
    let existing = s.conversations.find(c => {
      const cDigits = (c.phone || '').replace(/\D/g, '');
      return cDigits === cleanDigits || (cDigits.length >= 10 && cDigits.slice(-10) === norm10);
    });

    if (existing) {
      await this.selectWhatsAppChat(existing.phone, true);
      if (initialMsg) {
        const input = document.getElementById('wa-composer-input');
        if (input) {
          input.value = initialMsg;
          await this.sendCentralWhatsAppMessage();
        }
      } else {
        const input = document.getElementById('wa-composer-input');
        if (input) input.focus();
      }
      return;
    }

    // Check if matches an existing CRM lead
    const matchedLead = (this.state.leads || []).find(l => {
      const lDigits = (l.phone || '').replace(/\D/g, '');
      return lDigits === cleanDigits || (lDigits.length >= 10 && lDigits.slice(-10) === norm10);
    });

    // Create new virtual conversation entry in local state
    const newConv = {
      phone: cleanDigits,
      phone_10: norm10,
      lead_id: matchedLead ? matchedLead.id : null,
      lead_name: matchedLead ? matchedLead.name : (optionalName || null),
      business_name: matchedLead ? matchedLead.business_name : null,
      last_message: initialMsg || 'Starting chat...',
      last_direction: 'outgoing',
      last_timestamp: new Date().toISOString(),
      unread_count: 0,
      is_linked: !!matchedLead,
      total_messages: initialMsg ? 1 : 0
    };

    s.conversations.unshift(newConv);
    s.activePhone = cleanDigits;
    s.activeConversation = newConv;
    s.activeLead = matchedLead || null;
    s.messages = [];

    const listContainer = document.getElementById('wa-conversations-container');
    if (listContainer) {
      listContainer.innerHTML = this.renderWhatsAppConversationsListHTML();
    }
    const viewContainer = document.getElementById('wa-chat-view-container');
    if (viewContainer) {
      viewContainer.innerHTML = this.renderWhatsAppChatDetailHTML();
    }

    if (initialMsg) {
      const input = document.getElementById('wa-composer-input');
      if (input) {
        input.value = initialMsg;
        await this.sendCentralWhatsAppMessage();
      }
    } else {
      setTimeout(() => {
        const input = document.getElementById('wa-composer-input');
        if (input) input.focus();
      }, 50);
    }
  },

  openLinkLeadModal(phone) {
    const leads = this.state.leads || [];
    const html = `
      <div class="modal-header">
        <h3 style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          <span style="color: #2563eb; display: flex; align-items: center;">${Icons.link(18)}</span>
          <span>Link Contact to CRM Lead</span>
        </h3>
        <button class="modal-close" onclick="App.closeModal()" title="Close">${Icons.close(16)}</button>
      </div>
      <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px; padding: 20px;">
        <p style="font-size: 13px; color: var(--color-mid-gray); margin: 0;">
          Select an existing CRM lead to link with WhatsApp number <strong>+91 ${this.escapeHtml(phone)}</strong>:
        </p>
        <div class="form-group" style="margin: 0;">
          <label style="font-size: 12px; font-weight: 600;">Choose CRM Lead</label>
          <select id="modal-link-lead-select" class="select" style="width: 100%; font-size: 13px;">
            ${leads.map(l => `
              <option value="${l.id}">${this.escapeHtml(l.name)} ${l.business_name ? `(${this.escapeHtml(l.business_name)})` : ''} - ${l.phone || 'No phone'}</option>
            `).join('')}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="App.submitLinkLead('${phone}')">Link Lead</button>
      </div>
    `;
    this.openModal(html, { size: 'sm' });
  },

  async submitLinkLead(phone) {
    const select = document.getElementById('modal-link-lead-select');
    if (!select || !select.value) return;
    const leadId = select.value;

    try {
      const res = await API.post('/api/whatsapp/central/link', { phone, lead_id: leadId });
      if (res && res.status === 'success') {
        API.showToast('Contact linked to CRM lead successfully!', 'success');
        this.closeModal();
        await this.loadCentralWhatsAppChats(true);
        if (this._waCentralState?.activePhone === phone) {
          await this.selectWhatsAppChat(phone, true);
        }
      }
    } catch (err) {
      API.showToast('Failed to link lead: ' + err.message, 'error');
    }
  },

  openCreateLeadModal(phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    const norm10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    const html = `
      <div class="modal-header">
        <h3 style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          <span style="color: #16a34a; display: flex; align-items: center;">${Icons.plus(18)}</span>
          <span>Create New CRM Lead</span>
        </h3>
        <button class="modal-close" onclick="App.closeModal()" title="Close">${Icons.close(16)}</button>
      </div>
      <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px; padding: 20px;">
        <p style="font-size: 13px; color: var(--color-mid-gray); margin: 0;">
          Create a new CRM lead for WhatsApp contact <strong>+91 ${this.escapeHtml(norm10)}</strong>:
        </p>
        <div class="form-group" style="margin: 0;">
          <label style="font-size: 12px; font-weight: 600;">Contact Name *</label>
          <input type="text" id="modal-new-lead-name" class="input" placeholder="e.g. Hersh Pitroda" style="width: 100%; font-size: 13px;">
        </div>
        <div class="form-group" style="margin: 0;">
          <label style="font-size: 12px; font-weight: 600;">Company / Business Name</label>
          <input type="text" id="modal-new-lead-business" class="input" placeholder="e.g. Burosys Furniture" style="width: 100%; font-size: 13px;">
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="App.submitCreateLead('${phone}')">Create Lead</button>
      </div>
    `;
    this.openModal(html, { size: 'sm' });
  },

  async submitCreateLead(phone) {
    const nameEl = document.getElementById('modal-new-lead-name');
    const bizEl = document.getElementById('modal-new-lead-business');
    if (!nameEl || !nameEl.value.trim()) {
      API.showToast('Contact Name is required.', 'error');
      return;
    }

    try {
      const res = await API.post('/api/whatsapp/central/create-lead', {
        phone: phone,
        name: nameEl.value.trim(),
        business_name: bizEl ? bizEl.value.trim() : ''
      });
      if (res && res.status === 'success') {
        API.showToast('CRM Lead created and linked!', 'success');
        this.closeModal();
        if (res.lead) {
          this.state.leads.unshift(res.lead);
        }
        await this.loadCentralWhatsAppChats(true);
        if (this._waCentralState?.activePhone === phone) {
          await this.selectWhatsAppChat(phone, true);
        }
      }
    } catch (err) {
      API.showToast('Failed to create lead: ' + err.message, 'error');
    }
  },

  async sendLeadWhatsAppMessage(leadId) {
    const input = document.getElementById('lead-wa-quick-input');
    if (!input || !input.value.trim()) return;

    const text = input.value.trim();
    const lead = this.state.selectedLead || this.state.leads.find(l => l.id === leadId);
    if (!lead || !lead.phone) {
      API.showToast('This lead does not have a valid phone number.', 'error');
      return;
    }

    try {
      input.disabled = true;
      const res = await API.post('/api/whatsapp/central/send', {
        recipient_phone: lead.phone,
        message_text: text,
        lead_id: leadId
      });
      if (res && res.status === 'success') {
        input.value = '';
        API.showToast('WhatsApp message sent via Zero7 Central!', 'success');
        // Refresh the lead's conversation view
        this.loadWhatsAppConversation(leadId, 'all');
      } else {
        API.showToast(res?.detail || 'Failed to send message.', 'error');
      }
    } catch (err) {
      API.showToast(err.message || 'Failed to send message via WhatsApp daemon.', 'error');
    } finally {
      input.disabled = false;
      input.focus();
    }
  },

  escapeHtml(str) {

    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  // ==========================================================================
  // CAPITAL-PER-UNIT-TIME DAILY SCHEDULE (BATTLE PLAN)
  // ==========================================================================

  async loadScheduleData(forceRefresh = false) {
    if (this.state.scheduleData && !forceRefresh) return this.state.scheduleData;
    try {
      const data = await API.get('/api/schedule/daily?capacity=50');
      this.state.scheduleData = data;
      return data;
    } catch (err) {
      console.error('Failed to load daily schedule:', err);
      API.showToast('Failed to load daily schedule', 'error');
      return null;
    }
  },

  async regenerateDailySchedule() {
    try {
      API.showToast('Recalculating Capital-Per-Unit-Time priorities...', 'info');
      const res = await API.post('/api/schedule/regenerate');
      if (res && res.plan) {
        this.state.scheduleData = res.plan;
        this.renderScheduleView();
        API.showToast(res.message || 'Battle plan updated!', 'success');
      }
    } catch (err) {
      console.error('Failed to regenerate schedule:', err);
      API.showToast('Error regenerating schedule', 'error');
    }
  },

  async completeScheduleAction(leadId, taskAction = '') {
    try {
      const todayKey = 'zero7_completed_schedule_' + new Date().toISOString().slice(0, 10);
      if (!this.state.completedScheduleIds.includes(leadId)) {
        this.state.completedScheduleIds.push(leadId);
        localStorage.setItem(todayKey, JSON.stringify(this.state.completedScheduleIds));
      }

      await API.post(`/api/schedule/${leadId}/complete`, { outcome: taskAction });
      API.showToast('Scheduled needle mover completed and logged!', 'success');
      this.renderScheduleView();
    } catch (err) {
      console.error('Failed to complete action:', err);
      API.showToast('Action marked done locally', 'info');
      this.renderScheduleView();
    }
  },

  setScheduleTab(tab) {
    this.state.scheduleTab = tab;
    this.renderScheduleView();
  },

  async renderScheduleView() {
    const mainEl = document.getElementById('page-content') || document.querySelector('.main-viewport');
    if (!mainEl) return;

    mainEl.innerHTML = `
      <div class="schedule-view-container">
        <div style="display: flex; align-items: center; justify-content: center; padding: 48px; color: var(--color-mid-gray);">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="spinner" style="width: 20px; height: 20px; border: 2px solid var(--color-hairline); border-top-color: var(--color-ink); border-radius: 50%; animation: spin 0.8s linear infinite;"></span>
            <span>Calculating Capital-Per-Unit-Time Daily Schedule...</span>
          </div>
        </div>
      </div>
    `;

    const plan = await this.loadScheduleData();
    if (!plan) {
      mainEl.innerHTML = `
        <div class="schedule-view-container">
          <div class="card" style="padding: 32px; text-align: center;">
            <p style="color: var(--color-danger); font-weight: 600;">Unable to load daily battle plan.</p>
            <button class="btn btn-primary" onclick="App.loadScheduleData(true).then(() => App.renderScheduleView())" style="margin-top: 12px;">Retry</button>
          </div>
        </div>
      `;
      return;
    }

    const completed = this.state.completedScheduleIds || [];
    const completedCount = completed.length;
    const maxCap = plan.max_capacity || 50;
    const progressPercent = Math.min(100, Math.round((completedCount / maxCap) * 100));

    // Filter items based on active tab
    const allItems = plan.schedule || [];
    let displayedItems = allItems;
    const curTab = this.state.scheduleTab || 'all';

    if (curTab === 'top10') {
      displayedItems = allItems.slice(0, 10);
    } else if (curTab === 'disproportionate') {
      displayedItems = allItems.filter(it => it.tier === 'disproportionate');
    } else if (curTab === 'necessity') {
      displayedItems = allItems.filter(it => it.tier === 'necessity');
    } else if (curTab === 'squeeze') {
      displayedItems = allItems.filter(it => it.tier === 'squeeze');
    }

    mainEl.innerHTML = `
      <div class="schedule-view-container">
        <!-- Battle Plan Header -->
        <div class="battle-plan-header">
          <div>
            <h1 class="battle-plan-title">
              ${Icons.zap(22)} Capital-Per-Unit-Time Daily Schedule
            </h1>
            <p class="battle-plan-subtitle">
              Strictly capped at <strong>50 daily actions</strong>. First 10 slots move the bank account the most. Disproportionate returns first, then necessity commitments, squeezing minor tasks into response gaps.
            </p>
          </div>

          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button class="btn-pill" onclick="App.regenerateDailySchedule()" title="Recalculate priorities using latest Sheet remarks & Dropet signals">
              ${Icons.refresh(13)} Regenerate Plan
            </button>
            <button class="btn-pill" onclick="App.syncSheetPriorities().then(() => App.regenerateDailySchedule())" title="Pull latest Meta leads & priorities from Google Sheet">
              ${Icons.arrowRight(13)} Sync Sheet
            </button>
          </div>
        </div>

        <!-- KPI Grid -->
        <div class="battle-kpi-grid">
          <div class="battle-kpi-card highlight">
            <span class="battle-kpi-lbl">Top 10 Needle Movers</span>
            <span class="battle-kpi-val" style="color: #d97706;">${plan.top10_pipeline_in_play}</span>
            <span style="font-size: 11.5px; color: hsl(var(--muted-foreground));">First 10 calls with maximum bank account impact</span>
          </div>

          <div class="battle-kpi-card">
            <span class="battle-kpi-lbl">Total Capital In Play</span>
            <span class="battle-kpi-val">${plan.total_pipeline_in_play}</span>
            <span style="font-size: 11.5px; color: hsl(var(--muted-foreground));">Across ${plan.scheduled_count} scheduled accounts today</span>
          </div>

          <div class="battle-kpi-card">
            <span class="battle-kpi-lbl">Disproportionate Returns</span>
            <span class="battle-kpi-val">${plan.disproportionate_count}</span>
            <span style="font-size: 11.5px; color: hsl(var(--muted-foreground));">High-scale whales, late proposals & demo closes</span>
          </div>

          <div class="battle-kpi-card">
            <span class="battle-kpi-lbl">Necessity & Commitments</span>
            <span class="battle-kpi-val">${plan.necessity_count}</span>
            <span style="font-size: 11.5px; color: hsl(var(--muted-foreground));">Hard scheduled meetings & fatigue guards</span>
          </div>
        </div>

        <!-- 50-Action Daily Execution Budget Meter -->
        <div class="capacity-progress-container">
          <div class="capacity-progress-header">
            <span>Daily Execution Budget: 50 Actions Maximum</span>
            <span style="color: ${completedCount >= 10 ? '#10b981' : 'hsl(var(--foreground))'};">
              <strong>${completedCount} / ${maxCap}</strong> Actions Executed (${progressPercent}%)
            </span>
          </div>
          <div class="capacity-progress-bar-bg">
            <div class="capacity-progress-bar-fill" style="width: ${progressPercent}%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: hsl(var(--muted-foreground));">
            <span>Slots 1-10: Top Needle Movers</span>
            <span>Slots 11-20: Necessity Commitments</span>
            <span>Slots 21-35: High Yield Deals</span>
            <span>Slots 36-50: Squeeze Queue</span>
          </div>
        </div>

        <!-- Tab Filters -->
        <div class="ui-segmented" style="overflow-x: auto;">
          <button class="btn-pill ${curTab === 'all' ? 'active' : ''}" onclick="App.setScheduleTab('all')">
            All 50 Scheduled (${allItems.length})
          </button>
          <button class="btn-pill ${curTab === 'top10' ? 'active' : ''}" onclick="App.setScheduleTab('top10')" style="color: #d97706;">
            ${Icons.flame(13)} Top 10 Needle Movers (10)
          </button>
          <button class="btn-pill ${curTab === 'disproportionate' ? 'active' : ''}" onclick="App.setScheduleTab('disproportionate')">
            ${Icons.zap(13)} Disproportionate (${plan.disproportionate_count})
          </button>
          <button class="btn-pill ${curTab === 'necessity' ? 'active' : ''}" onclick="App.setScheduleTab('necessity')">
            ${Icons.alertTriangle(13)} Necessity Commitments (${plan.necessity_count})
          </button>
          <button class="btn-pill ${curTab === 'squeeze' ? 'active' : ''}" onclick="App.setScheduleTab('squeeze')">
            ${Icons.rotateCcw(13)} Squeeze Queue (${plan.squeeze_count})
          </button>
        </div>

        <!-- Schedule Items Table -->
        <div class="table-container" style="background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: var(--radius-card); overflow: hidden;">
          <table class="table" style="width: 100%;">
            <thead>
              <tr style="background: hsl(var(--muted) / 0.35); text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 12px;">
                <th style="width: 48px; text-align: center;">Rank</th>
                <th style="min-width: 180px;">Prospect & enterprise</th>
                <th style="min-width: 220px;">Sharp action (3-7 words)</th>
                <th style="width: 110px;">Est. deal</th>
                <th style="min-width: 280px;">Commercial rationale</th>
                <th style="text-align: right; min-width: 170px;">Execution</th>
              </tr>
            </thead>
            <tbody>
              ${displayedItems.length > 0 ? displayedItems.map(it => {
                const isDone = completed.includes(it.lead_id);
                const isTop10 = it.rank <= 10;
                const cleanPhone = (it.phone || '').replace(/[^0-9]/g, '');

                return `
                  <tr style="${isDone ? 'opacity: 0.45; background: hsl(var(--muted) / 0.15);' : (isTop10 ? 'background: rgba(245, 158, 11, 0.03);' : '')}">
                    <td style="text-align: center; vertical-align: middle;">
                      <span class="rank-badge ${isTop10 ? 'top10' : ''}">#${it.rank}</span>
                    </td>

                    <td style="vertical-align: middle;">
                      <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span style="font-weight: 600; font-size: 13.5px; color: hsl(var(--foreground)); cursor: pointer;" onclick="App.viewLead('${it.lead_id}')">
                          ${this.escapeHtml(it.lead_name)}
                        </span>
                        <div style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: hsl(var(--muted-foreground));">
                          <span>${this.escapeHtml(it.business_name || 'Independent')}</span>
                          ${it.city ? `<span>• ${this.escapeHtml(it.city)}</span>` : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px; margin-top: 2px;">
                          ${it.tier === 'disproportionate' ? `<span class="badge-disproportionate">${Icons.zap(10)} Disproportionate</span>` : ''}
                          ${it.tier === 'necessity' ? `<span class="badge-necessity">${Icons.alertTriangle(10)} Necessity</span>` : ''}
                          ${it.tier === 'squeeze' ? `<span class="badge-squeeze">${Icons.rotateCcw(10)} Squeeze</span>` : ''}
                          ${it.employee_count && it.employee_count !== '2-10' ? `<span style="font-size: 10px; background: hsl(var(--muted)); padding: 1px 5px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;">${Icons.users(12)} ${it.employee_count}</span>` : ''}
                        </div>
                      </div>
                    </td>

                    <td style="vertical-align: middle;">
                      <div style="display: flex; flex-direction: column; gap: 4px;">
                        <span style="font-weight: 600; font-size: 13px; color: ${isTop10 ? '#d97706' : 'hsl(var(--foreground))'};">
                          ${this.escapeHtml(it.task_action)}
                        </span>
                        <span style="font-size: 11px; color: hsl(var(--muted-foreground));">
                          Stage: <strong>${this.escapeHtml(it.momentum_tag)}</strong>
                        </span>
                      </div>
                    </td>

                    <td class="lead-number" style="vertical-align: middle; font-weight: 600; font-size: 12.5px; color: #10b981; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';">
                      ${it.estimated_deal_value}
                    </td>

                    <td style="vertical-align: middle; font-size: 12px; color: hsl(var(--muted-foreground)); line-height: 1.4;">
                      ${this.escapeHtml(it.why)}
                    </td>

                    <td style="vertical-align: middle; text-align: right;">
                      <div style="display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end;">
                        ${cleanPhone ? `
                          <a href="tel:+${cleanPhone}" class="battle-action-btn call-btn" title="Call ${it.phone}">
                            ${Icons.phone(12)} Call
                          </a>
                          <a href="https://wa.me/${cleanPhone}" target="_blank" class="battle-action-btn" title="Open WhatsApp chat" style="color: #25d366;">
                            ${Icons.whatsapp(12)}
                          </a>
                        ` : ''}
                        <button class="battle-action-btn" onclick="App.viewLead('${it.lead_id}')" title="Open lead details & prototype">
                          ${Icons.chevronRight(12)}
                        </button>
                        <button class="battle-action-btn ${isDone ? '' : 'done-btn'}" onclick="App.completeScheduleAction('${it.lead_id}', '${this.escapeHtml(it.task_action)}')" title="${isDone ? 'Action Completed' : 'Mark Action Done'}">
                          ${isDone ? Icons.check(12) : Icons.check(12)}
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr>
                  <td colspan="6" style="text-align: center; padding: 48px; color: hsl(var(--muted-foreground));">
                    No scheduled items match the selected filter.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

};


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}
