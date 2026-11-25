/**
 * Zero7 Mail — High-Precision Standalone Webmail Client
 * Multi-tenant alias sandboxing, real-time Zoho sync, and distraction-free communication.
 */

const Zero7Mail = {
  state: {
    token: localStorage.getItem('zero7_token') || '',
    user: null,
    overview: null,
    currentFolder: 'inbox',
    currentAlias: 'all',
    searchQuery: '',
    currentPage: 1,
    limit: 15,
    messages: [],
    pagination: { total: 0, totalPages: 1 },
    selectedMessageId: null,
    activeThread: null,
    filter: 'all', // all | unread | starred
    isSyncing: false,
    pollTimer: null,
  },

  async init() {
    console.log('[ZMAIL] Initializing Zero7 Mail application...');
    if (this.state.token) {
      const authenticated = await this.checkSession();
      if (authenticated) {
        await this.loadOverview();
        await this.loadMessages();
        this.startBackgroundPoller();
        return;
      }
    }
    this.renderLogin();
  },

  // ── Network / API Layer ──
  async request(method, path, body = null, isFormData = false) {
    const headers = {};
    if (this.state.token) {
      headers['Authorization'] = `Bearer ${this.state.token}`;
    }
    if (!isFormData && body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
    }

    const options = { method, headers };
    if (body) {
      options.body = isFormData ? body : JSON.stringify(body);
    }

    try {
      const res = await fetch(path, options);
      if (res.status === 401) {
        this.logout();
        throw new Error('Session expired. Please sign in again.');
      }
      if (res.status === 403) {
        const err = await res.json().catch(() => ({ detail: 'Access denied' }));
        throw new Error(err.detail || 'Access forbidden');
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(err.detail || `Request failed with HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.error(`[ZMAIL API ERROR] ${method} ${path}:`, err);
      throw err;
    }
  },

  async checkSession() {
    try {
      const user = await this.request('GET', '/api/auth/me');
      this.state.user = user;
      // If member, set default alias to user email
      if (user.role !== 'admin') {
        this.state.currentAlias = user.email.toLowerCase();
      }
      return true;
    } catch (e) {
      this.state.token = '';
      localStorage.removeItem('zero7_token');
      return false;
    }
  },

  async login(email, password) {
    const data = await this.request('POST', '/api/auth/login', { email, password });
    if (!data.token) throw new Error('Invalid login response');
    this.state.token = data.token;
    localStorage.setItem('zero7_token', data.token);
    this.state.user = data.user;
    if (data.user.role !== 'admin') {
      this.state.currentAlias = data.user.email.toLowerCase();
    }
    this.showToast('Signed in successfully', 'success');
    await this.loadOverview();
    await this.loadMessages();
    this.startBackgroundPoller();
  },

  logout() {
    this.state.token = '';
    this.state.user = null;
    this.state.selectedMessageId = null;
    this.state.activeThread = null;
    localStorage.removeItem('zero7_token');
    if (this.state.pollTimer) clearInterval(this.state.pollTimer);
    this.renderLogin();
  },

  startBackgroundPoller() {
    if (this.state.pollTimer) clearInterval(this.state.pollTimer);
    // Poll every 60 seconds
    this.state.pollTimer = setInterval(() => {
      this.loadMessages(false, true);
    }, 60000);
  },

  // ── Data Operations ──
  async loadOverview(forceRefresh = false) {
    try {
      const data = await this.request('GET', `/api/mail/overview?force_refresh=${forceRefresh ? 'true' : 'false'}`);
      this.state.overview = data;
    } catch (err) {
      console.warn('[ZMAIL] Overview load warning:', err);
    }
  },

  async loadMessages(forceRefresh = false, silent = false) {
    if (!silent) this.setSyncing(true);
    try {
      const params = new URLSearchParams({
        folder: this.state.currentFolder,
        alias: this.state.user && this.state.user.role === 'admin' ? this.state.currentAlias : (this.state.user ? this.state.user.email : 'all'),
        search: this.state.searchQuery,
        page: this.state.currentPage,
        limit: this.state.limit,
        force_refresh: forceRefresh ? 'true' : 'false',
      });

      const res = await this.request('GET', `/api/mail/messages?${params.toString()}`);
      this.state.messages = res.messages || [];
      this.state.pagination = res.pagination || { total: 0, totalPages: 1 };
      
      // Update sidebar counts if returned
      if (res.folderCounts) {
        this.updateFolderCounts(res.folderCounts);
      }

      this.renderMailApp();
    } catch (err) {
      this.showToast(err.message || 'Failed to fetch messages', 'error');
    } finally {
      if (!silent) this.setSyncing(false);
    }
  },

  async selectMessage(messageId, folderId) {
    this.state.selectedMessageId = messageId;
    this.renderThreadLoading();
    try {
      const fid = folderId || (this.state.overview && this.state.overview.folders && this.state.overview.folders.inbox ? this.state.overview.folders.inbox.folderId : '');
      const data = await this.request('GET', `/api/mail/messages/${encodeURIComponent(fid)}/${encodeURIComponent(messageId)}`);
      this.state.activeThread = data.thread || [data.message];
      
      // Mark as read in local list
      const msgItem = this.state.messages.find(m => m.messageId === messageId);
      if (msgItem) msgItem.isUnread = false;

      this.renderThreadReader();
    } catch (err) {
      this.showToast(err.message || 'Error opening message', 'error');
      this.renderThreadEmpty('Could not open this message');
    }
  },

  async triggerAction(action, messageIds = null) {
    const ids = messageIds || (this.state.selectedMessageId ? [this.state.selectedMessageId] : []);
    if (!ids.length) return;

    try {
      await this.request('POST', '/api/mail/messages/action', {
        action: action,
        messageIds: ids
      });
      this.showToast(`Message marked as ${action}`, 'success');
      
      // Refresh current folder
      await this.loadMessages(false, true);
      
      // If deleted or moved to trash, clear thread view
      if (['delete', 'trash', 'spam'].includes(action)) {
        this.state.selectedMessageId = null;
        this.state.activeThread = null;
        this.renderThreadEmpty();
      }
    } catch (err) {
      this.showToast(err.message || 'Action failed', 'error');
    }
  },

  setSyncing(isSyncing) {
    this.state.isSyncing = isSyncing;
    const btn = document.getElementById('btn-sync-zoho');
    if (btn) {
      if (isSyncing) btn.classList.add('syncing');
      else btn.classList.remove('syncing');
    }
  },

  updateFolderCounts(counts) {
    const unreadInbox = counts.unreadInbox || counts.inbox || 0;
    const badge = document.getElementById('count-inbox');
    if (badge) {
      badge.textContent = unreadInbox;
      badge.style.display = unreadInbox > 0 ? 'inline-block' : 'none';
    }
  },

  // ── Render Views ──

  renderLogin() {
    const appEl = document.getElementById('app');
    appEl.innerHTML = `
      <div class="login-screen-wrapper">
        <div class="login-card">
          <div class="login-header-branding">
            <div class="login-logo-box">Z7</div>
            <h2 class="login-title">Zero7 Mail</h2>
            <p class="login-subtitle">Secure Multi-Tenant Webmail Workspace</p>
          </div>

          <form id="mail-login-form" class="login-form-group">
            <div id="login-error-box" style="display: none;" class="login-error-banner"></div>

            <div class="login-field">
              <label>Work Email</label>
              <input type="email" id="mail-login-email" placeholder="name@zero7.space" required autofocus autocomplete="username">
            </div>

            <div class="login-field">
              <label>Password</label>
              <input type="password" id="mail-login-password" placeholder="••••••••••••" required autocomplete="current-password">
            </div>

            <button type="submit" id="mail-login-btn" class="login-btn-submit">
              Sign In to Mailbox
            </button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('mail-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('mail-login-email').value.trim();
      const password = document.getElementById('mail-login-password').value;
      const btn = document.getElementById('mail-login-btn');
      const errBox = document.getElementById('login-error-box');

      btn.disabled = true;
      btn.textContent = 'Authenticating...';
      errBox.style.display = 'none';

      try {
        await this.login(email, password);
      } catch (err) {
        errBox.textContent = err.message || 'Invalid email or password';
        errBox.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Sign In to Mailbox';
      }
    });
  },

  renderMailApp() {
    const appEl = document.getElementById('app');
    const u = this.state.user || { name: 'User', email: 'user@zero7.space', role: 'member' };
    const isAdmin = u.role === 'admin';
    const aliases = (this.state.overview && this.state.overview.aliases) || [];

    // Filter messages based on tab filter
    let displayedMessages = this.state.messages;
    if (this.state.filter === 'unread') {
      displayedMessages = displayedMessages.filter(m => m.isUnread);
    } else if (this.state.filter === 'starred') {
      displayedMessages = displayedMessages.filter(m => m.isStarred);
    }

    appEl.innerHTML = `
      <div class="mail-layout">
        <!-- Top Header -->
        <header class="mail-header">
          <div class="mail-brand" onclick="Zero7Mail.loadMessages(false)">
            <div class="mail-brand-logo">Z7</div>
            <span>Zero7 Mail</span>
          </div>

          <div class="mail-search-bar">
            <span class="mail-search-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </span>
            <input type="text" id="mail-search-input" placeholder="Search emails, senders, subjects..." value="${this.escapeHtml(this.state.searchQuery)}">
          </div>

          <div class="mail-header-actions">
            <!-- Active Alias indicator or dropdown for Admin -->
            ${isAdmin ? `
              <select id="admin-alias-selector" class="alias-selector-select" title="Switch Mailbox View">
                <option value="all" ${this.state.currentAlias === 'all' ? 'selected' : ''}>All Mailboxes</option>
                ${aliases.map(a => `
                  <option value="${a.email}" ${this.state.currentAlias === a.email ? 'selected' : ''}>${a.displayName} (${a.email})</option>
                `).join('')}
              </select>
            ` : `
              <div class="alias-badge" title="Sandboxed Alias Account">
                <span class="alias-badge-dot"></span>
                <span>${this.escapeHtml(u.email)}</span>
              </div>
            `}

            <!-- Refresh Button -->
            <button id="btn-sync-zoho" class="btn-icon ${this.state.isSyncing ? 'syncing' : ''}" title="Sync with Zoho Mail" onclick="Zero7Mail.loadMessages(true)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
            </button>

            <!-- Admin COS CRM Link -->
            ${isAdmin ? `
              <a href="https://cos.zero7.space" target="_blank" class="btn-secondary" style="font-size: 11px; padding: 5px 10px; text-decoration: none;" title="Open Founder CRM">
                CRM Portal ↗
              </a>
            ` : ''}

            <!-- User Profile & Logout -->
            <div class="user-profile-badge" onclick="if(confirm('Sign out of Zero7 Mail?')) Zero7Mail.logout()" title="Click to Sign Out">
              <div class="user-avatar-initial">${u.name ? u.name[0].toUpperCase() : 'U'}</div>
              <div class="user-meta" style="display: flex; flex-direction: column;">
                <span class="user-meta-name">${this.escapeHtml(u.name || 'User')}</span>
                <span class="user-meta-role">${u.role.toUpperCase()}</span>
              </div>
            </div>
          </div>
        </header>

        <!-- Body Split View -->
        <div class="mail-body">
          <!-- Sidebar -->
          <aside class="mail-sidebar">
            <button class="btn-compose" onclick="Zero7Mail.openComposeModal()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              <span>Compose</span>
            </button>

            <nav class="folder-nav-group">
              <div class="folder-nav-title">Mailboxes</div>
              
              <div class="folder-nav-item ${this.state.currentFolder === 'inbox' ? 'active' : ''}" onclick="Zero7Mail.switchFolder('inbox')">
                <div class="folder-nav-left">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  <span>Inbox</span>
                </div>
                <span id="count-inbox" class="unread-count-pill" style="display: none;">0</span>
              </div>

              <div class="folder-nav-item ${this.state.currentFolder === 'starred' ? 'active' : ''}" onclick="Zero7Mail.switchFolder('starred')">
                <div class="folder-nav-left">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  <span>Starred</span>
                </div>
              </div>

              <div class="folder-nav-item ${this.state.currentFolder === 'sent' ? 'active' : ''}" onclick="Zero7Mail.switchFolder('sent')">
                <div class="folder-nav-left">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  <span>Sent</span>
                </div>
              </div>

              <div class="folder-nav-item ${this.state.currentFolder === 'drafts' ? 'active' : ''}" onclick="Zero7Mail.switchFolder('drafts')">
                <div class="folder-nav-left">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                  <span>Drafts</span>
                </div>
              </div>

              <div class="folder-nav-item ${this.state.currentFolder === 'spam' ? 'active' : ''}" onclick="Zero7Mail.switchFolder('spam')">
                <div class="folder-nav-left">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
                  <span>Spam</span>
                </div>
              </div>

              <div class="folder-nav-item ${this.state.currentFolder === 'bin' || this.state.currentFolder === 'trash' ? 'active' : ''}" onclick="Zero7Mail.switchFolder('bin')">
                <div class="folder-nav-left">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  <span>Trash</span>
                </div>
              </div>
            </nav>
          </aside>

          <!-- Split Content (Message List + Reader) -->
          <div class="mail-content-split">
            <!-- Message List Column -->
            <div class="mail-list-col">
              <!-- Toolbar -->
              <div class="mail-list-toolbar">
                <div class="filter-tab-pills">
                  <button class="filter-tab-pill ${this.state.filter === 'all' ? 'active' : ''}" onclick="Zero7Mail.setFilter('all')">All</button>
                  <button class="filter-tab-pill ${this.state.filter === 'unread' ? 'active' : ''}" onclick="Zero7Mail.setFilter('unread')">Unread</button>
                  <button class="filter-tab-pill ${this.state.filter === 'starred' ? 'active' : ''}" onclick="Zero7Mail.setFilter('starred')">Starred</button>
                </div>

                <div class="pagination-controls">
                  <span>${displayedMessages.length} emails</span>
                  <button class="pagination-btn" ${this.state.currentPage <= 1 ? 'disabled' : ''} onclick="Zero7Mail.prevPage()">‹</button>
                  <button class="pagination-btn" ${this.state.currentPage >= this.state.pagination.totalPages ? 'disabled' : ''} onclick="Zero7Mail.nextPage()">›</button>
                </div>
              </div>

              <!-- Messages List Items -->
              <div class="mail-items-container">
                ${displayedMessages.length === 0 ? `
                  <div class="mail-empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    <p style="font-size: 14px; font-weight: 500;">No emails found</p>
                    <p style="font-size: 12px; color: var(--text-muted);">Your ${this.state.currentFolder} mailbox is currently clear.</p>
                  </div>
                ` : displayedMessages.map(m => `
                  <div class="mail-item ${m.isUnread ? 'unread' : ''} ${this.state.selectedMessageId === m.messageId ? 'selected' : ''}" onclick="Zero7Mail.selectMessage('${m.messageId}', '${m.folderId}')">
                    <div class="mail-item-avatar">
                      ${m.senderName ? m.senderName[0].toUpperCase() : 'Z'}
                    </div>

                    <div class="mail-item-content">
                      <div class="mail-item-top">
                        <span class="mail-item-sender">${this.escapeHtml(m.senderName || m.fromDisplay || 'Unknown')}</span>
                        <span class="mail-item-date">${this.formatDate(m.timestamp)}</span>
                      </div>

                      <div class="mail-item-subject">
                        ${this.escapeHtml(m.subject || '(No Subject)')}
                      </div>

                      <div class="mail-item-snippet">
                        ${this.escapeHtml(m.summary || '')}
                      </div>

                      <div class="mail-item-badges">
                        ${m.hasAttachment ? `
                          <span class="mail-badge-tag">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                            File
                          </span>
                        ` : ''}

                        ${isAdmin && m.aliasEmail ? `
                          <span class="mail-badge-alias">${this.escapeHtml(m.aliasEmail.split('@')[0])}</span>
                        ` : ''}
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Message Detail Reader Column -->
            <div id="thread-reader-panel" class="mail-reader-col">
              ${this.state.activeThread ? '' : `
                <div class="reader-empty">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  <p style="font-size: 14px; font-weight: 500;">Select an email from the list to read</p>
                </div>
              `}
            </div>
          </div>
        </div>
      </div>
    `;

    // Attach search event
    const searchInput = document.getElementById('mail-search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.state.searchQuery = searchInput.value.trim();
          this.state.currentPage = 1;
          this.loadMessages();
        }
      });
    }

    // Attach Admin alias switcher
    const aliasSelect = document.getElementById('admin-alias-selector');
    if (aliasSelect) {
      aliasSelect.addEventListener('change', (e) => {
        this.state.currentAlias = e.target.value;
        this.state.currentPage = 1;
        this.loadMessages();
      });
    }

    // If an active thread is loaded, render it inside the reader panel
    if (this.state.activeThread) {
      this.renderThreadReader();
    }
  },

  renderThreadLoading() {
    const readerEl = document.getElementById('thread-reader-panel');
    if (readerEl) {
      readerEl.innerHTML = `
        <div class="reader-empty">
          <div class="spinner"></div>
          <p>Loading email thread...</p>
        </div>
      `;
    }
  },

  renderThreadEmpty(msg = 'Select an email from the list to read') {
    const readerEl = document.getElementById('thread-reader-panel');
    if (readerEl) {
      readerEl.innerHTML = `
        <div class="reader-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          <p style="font-size: 14px; font-weight: 500;">${this.escapeHtml(msg)}</p>
        </div>
      `;
    }
  },

  renderThreadReader() {
    const readerEl = document.getElementById('thread-reader-panel');
    if (!readerEl || !this.state.activeThread || !this.state.activeThread.length) return;

    const latest = this.state.activeThread[this.state.activeThread.length - 1];
    const subject = latest.subject || '(No Subject)';

    readerEl.innerHTML = `
      <div class="reader-header">
        <div class="reader-header-top">
          <h2 class="reader-subject">${this.escapeHtml(subject)}</h2>

          <div class="reader-actions-bar">
            <button class="btn-icon" title="Reply" onclick="Zero7Mail.replyToMessage(false)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            </button>
            <button class="btn-icon" title="Reply All" onclick="Zero7Mail.replyToMessage(true)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 17 2 12 7 7"/><polyline points="12 17 7 12 12 7"/><path d="M22 18v-2a4 4 0 0 0-4-4H7"/></svg>
            </button>
            <button class="btn-icon" title="Forward" onclick="Zero7Mail.forwardMessage()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
            </button>
            <button class="btn-icon" title="Star Thread" onclick="Zero7Mail.triggerAction('star')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
            <button class="btn-icon" title="Move to Trash" onclick="Zero7Mail.triggerAction('trash')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div class="thread-messages-list">
        ${this.state.activeThread.map(m => `
          <div class="message-card">
            <div class="message-card-header">
              <div class="sender-info-cluster">
                <div class="sender-avatar">
                  ${m.senderName ? m.senderName[0].toUpperCase() : 'Z'}
                </div>
                <div class="sender-details">
                  <div class="sender-name-line">
                    <span class="sender-name">${this.escapeHtml(m.senderName || m.fromDisplay || 'Sender')}</span>
                    <span class="sender-email">&lt;${this.escapeHtml(m.fromEmail || '')}&gt;</span>
                  </div>
                  <div class="recipient-line">
                    to ${this.escapeHtml(m.toDisplay || 'Recipient')} ${m.ccDisplay ? `cc ${this.escapeHtml(m.ccDisplay)}` : ''}
                  </div>
                </div>
              </div>

              <div class="message-date">
                ${new Date(m.timestamp).toLocaleString()}
              </div>
            </div>

            <!-- Email Body Content -->
            <div class="message-body-content">
              ${m.htmlContent ? m.htmlContent : `<p>${this.escapeHtml(m.summary || '')}</p>`}
            </div>

            <!-- Attachments -->
            ${(m.attachments && m.attachments.length) ? `
              <div class="attachments-tray">
                ${m.attachments.map(att => `
                  <a href="/api/mail/attachments/${encodeURIComponent(m.folderId)}/${encodeURIComponent(m.messageId)}/${encodeURIComponent(att.attachmentId)}?download=1" 
                     target="_blank" class="attachment-chip" download="${this.escapeHtml(att.attachmentName)}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    <span>${this.escapeHtml(att.attachmentName)}</span>
                    <span style="font-size: 10px; color: var(--text-muted);">${this.formatBytes(att.attachmentSize)}</span>
                  </a>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;
  },

  // ── Compose & Send ──

  openComposeModal(opts = {}) {
    const modalEl = document.getElementById('modal-container');
    const u = this.state.user || {};
    const fromAddr = (u.role === 'admin' && this.state.currentAlias !== 'all') ? this.state.currentAlias : u.email;

    modalEl.innerHTML = `
      <div class="modal-backdrop" id="compose-backdrop">
        <div class="compose-dialog" onclick="event.stopPropagation()">
          <div class="compose-dialog-header">
            <span class="compose-dialog-title">${opts.title || 'New Message'}</span>
            <button class="btn-icon" onclick="Zero7Mail.closeComposeModal()" title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
            </button>
          </div>

          <form id="compose-form" class="compose-form">
            <div class="form-row">
              <label class="form-label">From:</label>
              <input type="text" class="form-input locked" value="${this.escapeHtml(fromAddr)}" readonly title="Locked to your authenticated alias">
            </div>

            <div class="form-row">
              <label class="form-label">To:</label>
              <input type="email" id="compose-to" class="form-input" placeholder="recipient@example.com" value="${this.escapeHtml(opts.to || '')}" required multiple>
            </div>

            <div class="form-row">
              <label class="form-label">Cc:</label>
              <input type="text" id="compose-cc" class="form-input" placeholder="Optional CC recipients" value="${this.escapeHtml(opts.cc || '')}">
            </div>

            <div class="form-row">
              <label class="form-label">Subject:</label>
              <input type="text" id="compose-subject" class="form-input" placeholder="Subject" value="${this.escapeHtml(opts.subject || '')}" required>
            </div>

            <textarea id="compose-body" class="compose-textarea" placeholder="Type your message here...">${this.escapeHtml(opts.body || '')}</textarea>

            <div class="form-row" style="align-items: center;">
              <label class="form-label">Files:</label>
              <input type="file" id="compose-files" multiple style="font-size: 12px; color: var(--text-secondary);">
            </div>
          </form>

          <div class="compose-dialog-footer">
            <button type="button" class="btn-secondary" onclick="Zero7Mail.closeComposeModal()">Discard</button>
            <button type="button" id="btn-send-mail" class="btn-primary" onclick="Zero7Mail.submitSend('${opts.inReplyTo || ''}', '${opts.action || ''}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              <span>Send Message</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('compose-backdrop').addEventListener('click', () => {
      this.closeComposeModal();
    });
  },

  closeComposeModal() {
    document.getElementById('modal-container').innerHTML = '';
  },

  async submitSend(inReplyTo = '', action = '') {
    const to = document.getElementById('compose-to').value.trim();
    const cc = document.getElementById('compose-cc').value.trim();
    const subject = document.getElementById('compose-subject').value.trim();
    const content = document.getElementById('compose-body').value;
    const fileInput = document.getElementById('compose-files');
    const sendBtn = document.getElementById('btn-send-mail');

    if (!to) {
      this.showToast('Recipient (To) email is required', 'error');
      return;
    }

    sendBtn.disabled = true;
    sendBtn.innerHTML = `<span>Sending...</span>`;

    const formData = new FormData();
    formData.append('toAddress', to);
    if (cc) formData.append('ccAddress', cc);
    formData.append('subject', subject);
    formData.append('content', content);
    if (inReplyTo) formData.append('inReplyTo', inReplyTo);
    if (action) formData.append('action', action);

    // Append files
    if (fileInput && fileInput.files.length) {
      for (let i = 0; i < fileInput.files.length; i++) {
        formData.append('files', fileInput.files[i]);
      }
    }

    try {
      await this.request('POST', '/api/mail/send', formData, true);
      this.showToast('Message sent successfully', 'success');
      this.closeComposeModal();
      await this.loadMessages(true);
    } catch (err) {
      this.showToast(err.message || 'Failed to send email', 'error');
      sendBtn.disabled = false;
      sendBtn.innerHTML = `<span>Send Message</span>`;
    }
  },

  replyToMessage(replyAll = false) {
    if (!this.state.activeThread || !this.state.activeThread.length) return;
    const latest = this.state.activeThread[this.state.activeThread.length - 1];
    const to = latest.fromEmail || latest.fromDisplay;
    const cc = replyAll ? (latest.ccDisplay || '') : '';
    const subject = latest.subject.toLowerCase().startsWith('re:') ? latest.subject : `Re: ${latest.subject}`;
    
    this.openComposeModal({
      title: replyAll ? 'Reply All' : 'Reply',
      to: to,
      cc: cc,
      subject: subject,
      inReplyTo: latest.messageId,
      action: replyAll ? 'replyall' : 'reply',
      body: `\n\n--- On ${new Date(latest.timestamp).toLocaleString()}, ${latest.senderName || latest.fromEmail} wrote:\n> ${this.stripHtml(latest.summary || latest.htmlContent || '')}`
    });
  },

  forwardMessage() {
    if (!this.state.activeThread || !this.state.activeThread.length) return;
    const latest = this.state.activeThread[this.state.activeThread.length - 1];
    const subject = latest.subject.toLowerCase().startsWith('fwd:') ? latest.subject : `Fwd: ${latest.subject}`;

    this.openComposeModal({
      title: 'Forward Message',
      to: '',
      subject: subject,
      inReplyTo: latest.messageId,
      action: 'forward',
      body: `\n\n--- Forwarded message ---\nFrom: ${latest.senderName} <${latest.fromEmail}>\nDate: ${new Date(latest.timestamp).toLocaleString()}\nSubject: ${latest.subject}\nTo: ${latest.toDisplay}\n\n${this.stripHtml(latest.summary || latest.htmlContent || '')}`
    });
  },

  // ── Navigation & Filter Helpers ──

  switchFolder(folder) {
    this.state.currentFolder = folder;
    this.state.currentPage = 1;
    this.state.selectedMessageId = null;
    this.state.activeThread = null;
    this.loadMessages();
  },

  setFilter(filter) {
    this.state.filter = filter;
    this.renderMailApp();
  },

  prevPage() {
    if (this.state.currentPage > 1) {
      this.state.currentPage--;
      this.loadMessages();
    }
  },

  nextPage() {
    if (this.state.currentPage < this.state.pagination.totalPages) {
      this.state.currentPage++;
      this.loadMessages();
    }
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  },

  // ── Utility Functions ──

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  },

  formatDate(ts) {
    if (!ts) return '';
    const date = new Date(Number(ts));
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  },

  formatBytes(bytes) {
    if (!bytes) return '';
    const n = Number(bytes);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
};

window.Zero7Mail = Zero7Mail;
document.addEventListener('DOMContentLoaded', () => {
  Zero7Mail.init();
});
