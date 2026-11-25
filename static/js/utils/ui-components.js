/* HeroUI appearance for existing native selects. The native field remains the
 * form value and change-event owner, preserving every existing API handler. */
(() => {
  let active = null;
  let nextId = 0;
  let search = '';
  let searchTimer;
  let currentDialog = null;
  let returnFocus = null;

  function close(restoreFocus = false) {
    if (!active) return;
    const { button, popup } = active;
    active = null;
    popup.remove();
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-activedescendant');
    if (restoreFocus && button.isConnected) button.focus();
  }

  function refresh(select) {
    const wrapper = select.parentElement;
    const button = wrapper?.querySelector(':scope > .ui-select-trigger');
    if (!button) return;
    const label = button.querySelector('.ui-select-value');
    const text = select.selectedOptions[0]?.textContent || 'Select an option';
    if (label.textContent !== text) label.textContent = text;
    button.disabled = select.disabled;
    wrapper.classList.toggle('is-disabled', select.disabled);
    const invalid = select.getAttribute('aria-invalid') === 'true' || (!select.validity.valid && select.classList.contains('was-validated'));
    wrapper.classList.toggle('is-invalid', invalid);
    if (button.getAttribute('aria-invalid') !== String(invalid)) button.setAttribute('aria-invalid', String(invalid));
  }

  function position() {
    if (!active) return;
    if (!active.button.isConnected) return close();
    const r = active.button.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 180), window.innerWidth - 24);
    const roomBelow = window.innerHeight - r.bottom - 12;
    const roomAbove = r.top - 12;
    const above = roomBelow < 180 && roomAbove > roomBelow;
    const height = Math.min(300, Math.max(80, above ? roomAbove : roomBelow));
    Object.assign(active.popup.style, {
      width: width + 'px', maxHeight: height + 'px',
      left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)) + 'px',
      top: above ? 'auto' : r.bottom + 6 + 'px',
      bottom: above ? window.innerHeight - r.top + 6 + 'px' : 'auto'
    });
  }

  function highlight(index) {
    if (!active) return;
    const options = active.options;
    active.index = Math.max(0, Math.min(index, options.length - 1));
    options.forEach((option, i) => option.classList.toggle('is-focused', i === active.index));
    const current = options[active.index];
    if (current) {
      active.button.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    }
  }

  function choose(option) {
    if (!active || option.disabled) return;
    const { select, button } = active;
    const changed = select.value !== option.value;
    select.value = option.value;
    close();
    refresh(select);
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (button.isConnected) button.focus();
  }

  function open(select, button) {
    if (select.disabled) return;
    close();
    const popup = document.createElement('div');
    popup.id = button.getAttribute('aria-controls');
    popup.className = 'ui-select-popover';
    popup.setAttribute('role', 'listbox');
    popup.setAttribute('aria-label', button.getAttribute('aria-label'));
    active = { select, button, popup, options: [], index: 0 };
    for (const option of select.options) {
      if (option.hidden) continue;
      const item = document.createElement('div');
      item.id = popup.id + '-option-' + option.index;
      item.className = 'ui-select-option';
      item.textContent = option.textContent;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.setAttribute('aria-disabled', String(option.disabled));
      item.addEventListener('mousedown', event => event.preventDefault());
      item.addEventListener('click', event => { event.stopPropagation(); choose(option); });
      popup.appendChild(item);
      if (!option.disabled) {
        if (option.selected) active.index = active.options.length;
        active.options.push(item);
      }
    }
    document.body.appendChild(popup);
    button.setAttribute('aria-expanded', 'true');
    position();
    highlight(active.index);
  }

  function enhance(select) {
    if (select.dataset.uiSelect || select.multiple || select.size > 1 || select.querySelector('optgroup')) return;
    if (select.hidden || select.style.display === 'none') return;
    select.dataset.uiSelect = 'true';
    const wrapper = document.createElement('span');
    wrapper.className = 'ui-select-field';
    wrapper.style.width = select.style.width || '';
    const label = select.labels?.[0]?.textContent.trim() || select.getAttribute('aria-label')
      || select.closest('.form-group')?.querySelector('label')?.textContent.trim()
      || select.title || select.options[0]?.textContent || 'Select an option';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-select-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'ui-options-' + ++nextId);
    const value = document.createElement('span');
    value.className = 'ui-select-value';
    button.appendChild(value);
    select.before(wrapper);
    wrapper.append(select, button);
    select.classList.add('ui-native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (active?.select === select) close(); else open(select, button);
    });
    button.addEventListener('keydown', event => {
      if (event.key === 'Tab') return close();
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return close(true); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        if (!active || active.select !== select) return open(select, button);
        if (event.key === 'ArrowDown') highlight(active.index + 1);
        else if (event.key === 'ArrowUp') highlight(active.index - 1);
        else if (event.key === 'Home') highlight(0);
        else if (event.key === 'End') highlight(active.options.length - 1);
        else active.options[active.index]?.click();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        if (!active || active.select !== select) open(select, button);
        search += event.key.toLowerCase();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { search = ''; }, 700);
        const index = active.options.findIndex(item => item.textContent.trim().toLowerCase().startsWith(search));
        if (index >= 0) highlight(index);
      }
    });
    select.addEventListener('change', () => refresh(select));
    select.addEventListener('invalid', event => {
      event.preventDefault(); select.classList.add('was-validated'); refresh(select); button.focus();
    });
    select.form?.addEventListener('reset', () => setTimeout(() => refresh(select), 0));
    refresh(select);
  }

  function scan() {
    if (active && !active.select.isConnected) close();
    document.querySelectorAll('#app select, #modal-container select, .mail-compose-dialog-card select').forEach(select => {
      enhance(select);
      if (select.dataset.uiSelect) refresh(select);
    });
    document.querySelectorAll('button[title]:not([aria-label])').forEach(button => {
      if (!button.textContent.trim() && button.title) button.setAttribute('aria-label', button.title);
    });
    const dialog = document.querySelector('.modal[aria-modal="true"], .mail-compose-dialog-card, .mail-preview-dialog-card');
    if (dialog !== currentDialog) {
      if (dialog && !currentDialog) returnFocus = document.activeElement;
      if (!dialog && returnFocus?.isConnected) returnFocus.focus();
      currentDialog = dialog;
    }
    if (dialog) {
      const heading = dialog.querySelector('.modal-header h3');
      if (heading) {
        if (!heading.id) heading.id = 'ui-dialog-title';
        dialog.setAttribute('aria-labelledby', heading.id);
      }
      dialog.querySelectorAll('button[onclick*="closeModal"]').forEach(button => {
        if (!button.textContent.trim()) { button.setAttribute('aria-label', 'Close dialog'); button.title = 'Close dialog'; }
      });
    }
  }
  document.addEventListener('pointerdown', event => {
    if (active && !active.popup.contains(event.target) && !active.button.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    const tab = event.target.closest?.('[data-deal-tab][role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); tabs[next].focus(); tabs[next].click(); return;
    }
    if (event.key !== 'Tab') return;
    const dialog = document.querySelector('.modal[aria-modal="true"], .mail-compose-dialog-card, .mail-preview-dialog-card');
    if (!dialog) return;
    const fields = [...dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')]
      .filter(field => field.getClientRects().length && field.getAttribute('aria-hidden') !== 'true');
    if (!fields.length) return;
    const first = fields[0], last = fields[fields.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, true);
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
