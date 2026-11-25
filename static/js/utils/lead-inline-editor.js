/**
 * Zero7 CRM — Inline Leads Grid Editor & Singleton Floating Popover Controller
 * Handles inline enum popovers, hybrid Next Action presets + custom entry,
 * Internal Notes modal-free composer, click-to-edit text/numeric cells,
 * column reordering helpers, and surgical row updates without touching full table scroll.
 */
(() => {
  const NEXT_ACTION_PRESETS = [
    { label: 'Prototype needed', hint: 'Build or prepare client prototype' },
    { label: 'Proposal to be sent', hint: 'Share structured scope & proposal' },
    { label: 'Send quotation / costing', hint: 'Prepare and dispatch commercial quote' },
    { label: 'Present prototype demo', hint: 'Walk client through live prototype' },
    { label: 'Schedule discovery meeting', hint: 'Align scope & technical requirements' },
    { label: 'Follow-up callback', hint: 'Check in on pending decision' },
    { label: 'Send company profile / breakdown', hint: 'Share Zero7 capabilities & overview' },
    { label: 'Collect advance / token', hint: 'Finalize closing & onboarding advance' }
  ];

  const PRIORITY_OPTIONS = [
    { value: 'unexplored', label: 'Unexplored' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
    { value: 'won', label: 'Won' },
    { value: 'lost', label: 'Lost' }
  ];

  const STATUS_OPTIONS = [
    { value: 'new', label: 'New' },
    { value: 'contacted', label: 'Contacted' },
    { value: 'qualified', label: 'Qualified' },
    { value: 'proposal', label: 'Proposal' },
    { value: 'won', label: 'Won' },
    { value: 'lost', label: 'Lost' }
  ];

  const CALL_STAGE_OPTIONS = [
    { value: 'uncontacted', label: 'Uncontacted' },
    { value: 'first_call', label: 'First Call' },
    { value: 'follow_up', label: 'Follow-up' },
    { value: 'dnp', label: 'DNP' },
    { value: 'connected', label: 'Connected' },
    { value: 'interested', label: 'Interested' },
    { value: 'not_interested', label: 'Not Interested' }
  ];

  const TEMPERATURE_OPTIONS = [
    { value: 'hot', label: 'Hot' },
    { value: 'warm', label: 'Warm' },
    { value: 'cold', label: 'Cold' }
  ];

  let activePopover = null; // { el, anchorEl, leadId, field, keyHandler, scrollEl }
  let activeTextEdit = null; // { td, leadId, field, commit }
  let listenersBound = false;

  function esc(str) {
    return App.escapeHtml ? App.escapeHtml(str) : String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function closePopover(restoreFocus = false) {
    if (!activePopover) return;
    const { el, anchorEl, scrollEl, onScroll } = activePopover;
    activePopover = null;
    if (el && el.isConnected) el.remove();
    if (scrollEl && onScroll) scrollEl.removeEventListener('scroll', onScroll);
    if (anchorEl && anchorEl.isConnected) {
      anchorEl.setAttribute('aria-expanded', 'false');
      if (restoreFocus) anchorEl.focus();
    }
  }

  function positionPopover(el, anchorEl, preferredWidth) {
    if (!el || !anchorEl || !anchorEl.isConnected) {
      closePopover(false);
      return;
    }
    const r = anchorEl.getBoundingClientRect();
    const maxW = Math.min(preferredWidth || Math.max(r.width, 195), window.innerWidth - 24);
    el.style.width = maxW + 'px';
    el.style.visibility = 'hidden';

    const popRect = el.getBoundingClientRect();
    const popH = Math.min(popRect.height || 260, 380);
    const roomBelow = window.innerHeight - r.bottom - 10;
    const roomAbove = r.top - 10;
    const openAbove = roomBelow < Math.min(popH, 200) && roomAbove > roomBelow;

    const left = Math.max(12, Math.min(r.left, window.innerWidth - maxW - 12));
    el.style.left = left + 'px';
    el.style.maxHeight = Math.max(120, Math.min(390, openAbove ? roomAbove : roomBelow)) + 'px';
    if (openAbove) {
      el.style.top = 'auto';
      el.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    } else {
      el.style.bottom = 'auto';
      el.style.top = (r.bottom + 6) + 'px';
    }
    el.style.visibility = 'visible';
  }

  function bindGlobalListeners() {
    if (listenersBound || typeof document === 'undefined') return;
    listenersBound = true;

    document.addEventListener('pointerdown', (e) => {
      if (!activePopover) return;
      if (activePopover.el.contains(e.target) || activePopover.anchorEl.contains(e.target)) return;
      closePopover(false);
    });

    document.addEventListener('keydown', (e) => {
      if (!activePopover) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePopover(true);
      }
    }, true);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        if (activePopover) positionPopover(activePopover.el, activePopover.anchorEl, activePopover.width);
      });
    }
  }

  function refreshLeadKpisAndBadge() {
    const kpiValues = document.querySelectorAll('.lead-kpi-grid .fluid-kpi-value');
    if (kpiValues.length >= 4 && Array.isArray(App.state.leads)) {
      const leads = App.state.leads;
      const totalLeads = leads.length;
      const hotLeads = leads.filter(l => (l.temperature || '').toLowerCase() === 'hot' || (l.priority || '').toLowerCase() === 'high').length;
      const qualifiedLeads = leads.filter(l => ['qualified', 'proposal'].includes((l.status || '').toLowerCase())).length;
      const wonCount = (App.state.deals || []).filter(d => (d.stage || '').toLowerCase() === 'won').length
        || leads.filter(l => (l.status || '').toLowerCase() === 'won').length;
      kpiValues[0].textContent = String(totalLeads);
      kpiValues[1].textContent = String(hotLeads);
      kpiValues[2].textContent = String(qualifiedLeads);
      kpiValues[3].textContent = String(wonCount);
    }
    if (App.updateFollowUpBadge) App.updateFollowUpBadge();
  }

  function updateLeadRowInDom(updated, changedKeys = []) {
    if (!updated || !updated.id) return;
    App.applyLeadUpdate(updated);
    refreshLeadKpisAndBadge();

    const activeFilterMatch = changedKeys.some(k => Boolean(App.state.filters && App.state.filters[k]));
    const scrollContainer = document.querySelector('.ui-records-table .ui-table-scroll');
    const prevTop = scrollContainer ? scrollContainer.scrollTop : 0;
    const prevLeft = scrollContainer ? scrollContainer.scrollLeft : 0;

    if (activeFilterMatch) {
      App.renderLeadsTableBody();
      if (scrollContainer) {
        scrollContainer.scrollTop = prevTop;
        scrollContainer.scrollLeft = prevLeft;
      }
      return;
    }

    const row = document.querySelector(`#leads-table-body tr[data-lead-id="${CSS.escape ? CSS.escape(updated.id) : updated.id}"]`);
    if (row) {
      const temp = document.createElement('tbody');
      temp.innerHTML = App.renderLeadRow(updated);
      const freshRow = temp.firstElementChild;
      if (freshRow) {
        const editingSameRow = activeTextEdit && activeTextEdit.leadId === updated.id ? activeTextEdit.field : null;
        if (editingSameRow) {
          // Patch every non-editing column in-place so active <input> survives untouched
          [...freshRow.children].forEach(freshCell => {
            const col = freshCell.getAttribute('data-column');
            if (!col || col === editingSameRow) return;
            const curCell = row.querySelector(`td[data-column="${col}"]`);
            if (curCell) curCell.replaceWith(freshCell);
          });
        } else {
          row.replaceWith(freshRow);
        }
        if (activePopover && activePopover.leadId === updated.id) {
          const nextAnchor = (editingSameRow ? row : freshRow).querySelector(`td[data-column="${activePopover.field}"] button`);
          if (nextAnchor) {
            activePopover.anchorEl = nextAnchor;
            nextAnchor.setAttribute('aria-expanded', 'true');
            positionPopover(activePopover.el, nextAnchor, activePopover.width);
          }
        }
      }
    } else {
      App.renderLeadsTableBody();
    }
    if (scrollContainer) {
      scrollContainer.scrollTop = prevTop;
      scrollContainer.scrollLeft = prevLeft;
    }
  }

  async function saveInlineLeadFields(leadId, fields, options = {}) {
    const { toastMessage = null, alsoLogNote = null, skipIfUnchangedLead = null } = options;
    if (skipIfUnchangedLead) {
      const same = Object.entries(fields).every(([k, v]) => (skipIfUnchangedLead[k] ?? null) === (v ?? null));
      if (same) return skipIfUnchangedLead;
    }

    const updated = await API.put(`/api/leads/${leadId}`, fields);
    if (alsoLogNote && String(alsoLogNote).trim()) {
      await API.post(`/api/leads/${leadId}/notes`, { content: String(alsoLogNote).trim() }).catch(() => null);
    }
    if (updated) {
      updateLeadRowInDom(updated, Object.keys(fields));
    }
    if (toastMessage) {
      API.showToast(toastMessage, 'success');
    }
    return updated;
  }

  function renderEnumOptions(el, lead, field, options, renderBadge) {
    const currentVal = String(lead[field] || options[0].value).toLowerCase();
    el.innerHTML = `
      <div class="lead-popover-header">${esc(fieldLabel(field))}</div>
      <div class="lead-popover-list" role="listbox" aria-label="${esc(fieldLabel(field))}">
        ${options.map((opt, idx) => {
          const selected = currentVal === opt.value;
          return `
            <button type="button" class="lead-popover-option${selected ? ' is-selected' : ''}" role="option"
                    aria-selected="${selected}" data-value="${esc(opt.value)}" data-index="${idx}">
              <span class="lead-popover-opt-visual">${renderBadge(opt.value)}</span>
              ${selected ? `<span class="lead-popover-check">${Icons.check(13)}</span>` : ''}
            </button>
          `;
        }).join('')}
      </div>
    `;

    const buttons = [...el.querySelectorAll('.lead-popover-option')];
    const applyChoice = async (val) => {
      closePopover(true);
      try {
        const patch = { [field]: val };
        const hasDeal = (App.state.deals || []).some(d => d.lead_id === lead.id);
        let msg = `${fieldLabel(field)} updated`;
        if (field === 'status' && val === 'won' && !hasDeal) {
          msg = 'Marked Won — open lead to Promote to Deal';
        }
        await saveInlineLeadFields(lead.id, patch, { toastMessage: msg, skipIfUnchangedLead: lead });
      } catch (err) {
        console.error(`Failed updating ${field}:`, err);
      }
    };

    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyChoice(btn.dataset.value);
      });
    });

    bindListKeyboard(el, buttons, currentVal);
  }

  function renderOwnerPopover(el, lead) {
    const isAdmin = App.state.currentUser?.role === 'admin';
    if (!isAdmin) return closePopover(false);

    const users = App.state.users || [];
    const currentOwner = lead.assigned_to || '';
    const showSearch = users.length > 5;

    el.innerHTML = `
      <div class="lead-popover-header">Assign Owner</div>
      ${showSearch ? `
        <div class="lead-popover-search-wrap">
          <input type="text" class="lead-popover-search" placeholder="Filter team member..." aria-label="Filter team members">
        </div>
      ` : ''}
      <div class="lead-popover-list" role="listbox" aria-label="Assign Owner">
        <button type="button" class="lead-popover-option${!currentOwner ? ' is-selected' : ''}" role="option"
                aria-selected="${!currentOwner}" data-user-id="">
          <span class="lead-popover-owner-row">
            <span class="lead-cell-empty">Unassigned (Queue)</span>
          </span>
          ${!currentOwner ? `<span class="lead-popover-check">${Icons.check(13)}</span>` : ''}
        </button>
        ${users.map(u => {
          const selected = currentOwner === u.id;
          return `
            <button type="button" class="lead-popover-option${selected ? ' is-selected' : ''}" role="option"
                    aria-selected="${selected}" data-user-id="${esc(u.id)}" data-search="${esc((u.name + ' ' + (u.role || '')).toLowerCase())}">
              <span class="lead-popover-owner-row">
                <span class="lead-popover-owner-name">${esc(u.name || u.email)}</span>
                <span class="lead-popover-owner-role">${esc(u.role || 'member')}</span>
              </span>
              ${selected ? `<span class="lead-popover-check">${Icons.check(13)}</span>` : ''}
            </button>
          `;
        }).join('')}
      </div>
    `;

    const allButtons = [...el.querySelectorAll('.lead-popover-option')];
    const searchInput = el.querySelector('.lead-popover-search');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 10);
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        allButtons.forEach(btn => {
          if (!btn.dataset.userId && !q) { btn.style.display = ''; return; }
          if (!btn.dataset.userId && q) { btn.style.display = 'none'; return; }
          btn.style.display = (btn.dataset.search || '').includes(q) ? '' : 'none';
        });
      });
    }

    allButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const nextOwner = btn.dataset.userId || null;
        closePopover(true);
        try {
          const ownerObj = users.find(u => u.id === nextOwner);
          await saveInlineLeadFields(
            lead.id,
            { assigned_to: nextOwner },
            {
              toastMessage: ownerObj ? `Assigned to ${ownerObj.name}` : 'Lead unassigned to Queue',
              skipIfUnchangedLead: { assigned_to: lead.assigned_to || null }
            }
          );
        } catch (err) {
          console.error('Failed updating owner:', err);
        }
      });
    });

    if (!searchInput) bindListKeyboard(el, allButtons, currentOwner);
  }

  function renderNextActionPopover(el, lead) {
    const call = App.getScheduledCall ? App.getScheduledCall(lead) : null;
    const isPlaceholder = App.isPlaceholderAction ? App.isPlaceholderAction(lead) : false;
    const editableCurrent = call
      ? (call.purpose || '')
      : (isPlaceholder ? '' : (lead.next_action || ''));
    const lowerCurrent = editableCurrent.trim().toLowerCase();

    el.innerHTML = `
      <div class="lead-popover-header">Next Action</div>
      <form class="lead-next-custom-form">
        <input type="text" class="lead-popover-input" placeholder="Type custom next action..." value="${esc(editableCurrent)}" aria-label="Custom next action">
        <button type="submit" class="btn btn-primary btn-xs">Save</button>
      </form>
      <div class="lead-popover-section-label">Quick Presets</div>
      <div class="lead-popover-list" role="listbox" aria-label="Next action presets">
        ${NEXT_ACTION_PRESETS.map(p => {
          const selected = lowerCurrent === p.label.toLowerCase();
          return `
            <button type="button" class="lead-popover-option lead-next-preset-btn${selected ? ' is-selected' : ''}"
                    role="option" aria-selected="${selected}" data-preset="${esc(p.label)}">
              <span class="lead-next-preset-text">
                <strong>${esc(p.label)}</strong>
                <small>${esc(p.hint)}</small>
              </span>
              ${selected ? `<span class="lead-popover-check">${Icons.check(13)}</span>` : ''}
            </button>
          `;
        }).join('')}
      </div>
      <div class="lead-popover-footer">
        ${call ? `
          <div class="lead-popover-call-status">
            <span>${Icons.phone(12)} ${esc(App.formatCallTime(call.at))} IST</span>
            <div style="display:flex; gap:6px;">
              <button type="button" class="lead-popover-link-btn" data-action="reschedule">Reschedule</button>
              <button type="button" class="lead-popover-link-btn is-danger" data-action="clear-time">Clear time</button>
            </div>
          </div>
        ` : `
          <button type="button" class="lead-popover-footer-btn" data-action="schedule-call">
            ${Icons.calendar(12)} Set IST call time
          </button>
          <button type="button" class="lead-popover-footer-btn" data-action="ai-suggest">
            ${Icons.sparkles(12)} AI Suggest
          </button>
        `}
      </div>
    `;

    const form = el.querySelector('.lead-next-custom-form');
    const input = el.querySelector('.lead-popover-input');
    setTimeout(() => {
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }, 10);

    const commitAction = async (rawText) => {
      const text = String(rawText || '').trim();
      closePopover(true);
      const nextVal = text;
      try {
        await saveInlineLeadFields(
          lead.id,
          { next_action: nextVal },
          { toastMessage: nextVal ? 'Next action updated' : 'Next action cleared' }
        );
      } catch (err) {
        console.error('Failed updating next action:', err);
      }
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      commitAction(input.value);
    });

    el.querySelectorAll('.lead-next-preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        commitAction(btn.dataset.preset);
      });
    });

    const schedBtn = el.querySelector('[data-action="schedule-call"], [data-action="reschedule"]');
    if (schedBtn) {
      schedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closePopover(false);
        App.openScheduleCallModal(lead.id);
      });
    }

    const clearTimeBtn = el.querySelector('[data-action="clear-time"]');
    if (clearTimeBtn) {
      clearTimeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        closePopover(true);
        try {
          await saveInlineLeadFields(lead.id, { next_action_date: '' }, { toastMessage: 'Scheduled call time cleared' });
        } catch (err) {
          console.error('Failed clearing call time:', err);
        }
      });
    }

    const aiBtn = el.querySelector('[data-action="ai-suggest"]');
    if (aiBtn) {
      aiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closePopover(false);
        App.generateLeadTask(lead.id);
      });
    }
  }

  function renderInternalNotePopover(el, lead) {
    const existing = lead.last_update_notes || '';
    el.innerHTML = `
      <div class="lead-popover-header">Internal Note</div>
      <form class="lead-note-popover-form">
        <textarea class="lead-popover-textarea" rows="3" placeholder="Record latest call context, objections, or pricing notes...">${esc(existing)}</textarea>
        <div class="lead-popover-note-actions">
          <span class="lead-popover-hint">Enter to save · Shift+Enter newline</span>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-secondary btn-xs" data-action="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary btn-xs">Save Note</button>
          </div>
        </div>
      </form>
    `;

    const textarea = el.querySelector('.lead-popover-textarea');
    const form = el.querySelector('.lead-note-popover-form');
    const cancelBtn = el.querySelector('[data-action="cancel"]');

    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    }, 10);

    const submitNote = async () => {
      const nextNote = textarea.value.trim();
      closePopover(true);
      if (nextNote === existing.trim()) return;
      try {
        await saveInlineLeadFields(
          lead.id,
          { last_update_notes: nextNote },
          {
            toastMessage: nextNote ? 'Internal note saved' : 'Internal note cleared',
            alsoLogNote: nextNote || null
          }
        );
      } catch (err) {
        console.error('Failed saving internal note:', err);
      }
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitNote();
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitNote();
      }
    });

    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePopover(true);
    });
  }

  function bindListKeyboard(el, buttons, currentVal) {
    if (!buttons.length) return;
    let idx = Math.max(0, buttons.findIndex(b => (b.dataset.value ?? b.dataset.userId) === currentVal));
    const focusAt = (next) => {
      idx = (next + buttons.length) % buttons.length;
      buttons[idx].focus();
    };
    setTimeout(() => buttons[idx]?.focus(), 10);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(idx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(idx - 1); }
    });
  }

  function fieldLabel(field) {
    const labels = {
      priority: 'Priority',
      status: 'Status',
      call_stage: 'Call stage',
      temperature: 'Temperature',
      assigned_to: 'Owner',
      next_task: 'Next action',
      internal_note: 'Internal note',
      company: 'Company',
      phone: 'Phone',
      email: 'Email',
      city: 'City',
      deal_value: 'Est. value'
    };
    return labels[field] || field;
  }

  function openLeadInlinePopover(anchorEl, leadId, field) {
    bindGlobalListeners();
    if (activeTextEdit) activeTextEdit.commit(false);

    if (activePopover && activePopover.anchorEl === anchorEl && activePopover.field === field) {
      closePopover(false);
      return;
    }

    const lead = App.findLead ? App.findLead(leadId) : (App.state.leads || []).find(l => l.id === leadId);
    if (!lead) return;

    closePopover(false);

    const el = document.createElement('div');
    el.id = 'lead-inline-popover';
    el.className = 'lead-inline-popover';

    let width = 200;
    if (field === 'priority') {
      renderEnumOptions(el, lead, 'priority', PRIORITY_OPTIONS, v => App.getPriorityBadge(v));
    } else if (field === 'status') {
      renderEnumOptions(el, lead, 'status', STATUS_OPTIONS, v => App.getStatusBadge(v));
    } else if (field === 'call_stage') {
      renderEnumOptions(el, lead, 'call_stage', CALL_STAGE_OPTIONS, v => App.getCallStageBadge(v));
    } else if (field === 'temperature') {
      renderEnumOptions(el, lead, 'temperature', TEMPERATURE_OPTIONS, v => App.getTemperatureBadge(v));
    } else if (field === 'assigned_to') {
      width = 230;
      renderOwnerPopover(el, lead);
    } else if (field === 'next_task') {
      width = 320;
      renderNextActionPopover(el, lead);
    } else if (field === 'internal_note') {
      width = 320;
      renderInternalNotePopover(el, lead);
    } else {
      return;
    }

    document.body.appendChild(el);
    anchorEl.setAttribute('aria-expanded', 'true');

    const scrollEl = document.querySelector('.ui-records-table .ui-table-scroll');
    const onScroll = () => {
      if (!activePopover || !activePopover.anchorEl.isConnected) return closePopover(false);
      if (scrollEl) {
        const sr = scrollEl.getBoundingClientRect();
        const ar = activePopover.anchorEl.getBoundingClientRect();
        if (ar.bottom < sr.top + 30 || ar.top > sr.bottom || ar.right < sr.left || ar.left > sr.right) {
          return closePopover(false);
        }
      }
      positionPopover(activePopover.el, activePopover.anchorEl, activePopover.width);
    };
    if (scrollEl) scrollEl.addEventListener('scroll', onScroll, { passive: true });

    activePopover = { el, anchorEl, leadId, field, width, scrollEl, onScroll };
    positionPopover(el, anchorEl, width);
  }

  function startLeadInlineEdit(triggerEl, leadId, column) {
    bindGlobalListeners();
    closePopover(false);
    if (activeTextEdit && activeTextEdit.td) {
      activeTextEdit.commit(false);
    }

    const lead = App.findLead ? App.findLead(leadId) : (App.state.leads || []).find(l => l.id === leadId);
    const td = triggerEl?.closest('td');
    if (!lead || !td) return;

    const fieldMap = {
      deal_value: { apiKey: 'deal_value', type: 'number', placeholder: '0', initial: lead.deal_value ?? '' }
    };
    const cfg = fieldMap[column];
    if (!cfg) return;

    const originalHtml = td.innerHTML;
    const input = document.createElement('input');
    input.type = cfg.type;
    input.className = 'lead-inline-input';
    input.placeholder = cfg.placeholder;
    input.value = cfg.initial === null || cfg.initial === undefined ? '' : String(cfg.initial);
    if (cfg.type === 'number') {
      input.min = '0';
      input.step = '1000';
    }
    input.setAttribute('aria-label', `Edit ${fieldLabel(column)}`);

    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    input.select();

    let settled = false;
    const restore = () => {
      if (td.isConnected) td.innerHTML = originalHtml;
      if (activeTextEdit?.td === td) activeTextEdit = null;
    };

    const commit = async (cancel = false) => {
      if (settled) return;
      settled = true;
      if (cancel) {
        restore();
        return;
      }

      const raw = input.value.trim();
      const prevRaw = cfg.initial === null || cfg.initial === undefined ? '' : String(cfg.initial).trim();
      if (raw === prevRaw) {
        restore();
        return;
      }

      let payloadVal = raw;
      if (cfg.apiKey === 'deal_value') {
        if (raw === '') {
          payloadVal = null;
        } else {
          const parsed = Number(raw);
          if (Number.isNaN(parsed) || parsed < 0) {
            API.showToast('Enter a valid non-negative deal value', 'error');
            restore();
            return;
          }
          payloadVal = parsed;
        }
      }

      input.disabled = true;
      if (activeTextEdit?.td === td) activeTextEdit = null;
      try {
        await saveInlineLeadFields(
          leadId,
          { [cfg.apiKey]: payloadVal },
          { toastMessage: `${fieldLabel(column)} updated` }
        );
      } catch (err) {
        console.error(`Failed saving inline ${column}:`, err);
        restore();
      }
    };

    activeTextEdit = { td, leadId, field: column, commit };

    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commit(true);
      }
    });
    input.addEventListener('blur', () => commit(false));
  }

  Object.assign(App, {
    NEXT_ACTION_PRESETS,
    openLeadInlinePopover,
    closeLeadInlinePopover: closePopover,
    startLeadInlineEdit,
    saveInlineLeadFields,
    hasActiveLeadInlineEdit() {
      return Boolean(activePopover || activeTextEdit);
    }
  });
})();
