const API = {
  async request(endpoint, options = {}) {
    const token = localStorage.getItem('zero7_token');
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (token) {
      defaultHeaders['Authorization'] = `Bearer ${token}`;
    }
    
    try {
      const response = await fetch(endpoint, {
        ...options,
        headers: {
          ...defaultHeaders,
          ...options.headers
        }
      });
      
      const isJson = response.headers.get('content-type')?.includes('application/json');
      const data = isJson ? await response.json() : null;
      
      if (!response.ok) {
        if (response.status === 401 && !endpoint.includes('/api/auth/login') && !endpoint.includes('/api/auth/token')) {
          localStorage.removeItem('zero7_token');
          if (typeof App !== 'undefined' && App.renderLogin) {
            App.renderLogin();
          }
        }
        throw new Error(data?.detail || data?.message || response.statusText || 'API Error');
      }
      
      return data;
    } catch (error) {
      if (!endpoint.includes('/api/auth/me')) {
        this.showToast(error.message, 'error');
      }
      throw error;
    }
  },
  
  async get(endpoint) { return this.request(endpoint); },
  async post(endpoint, data) { return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) }); },
  async put(endpoint, data) { return this.request(endpoint, { method: 'PUT', body: JSON.stringify(data) }); },
  async delete(endpoint) { return this.request(endpoint, { method: 'DELETE' }); },
  
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconSvg = '';
    if (window.Icons) {
      if (type === 'success') iconSvg = window.Icons.check(13, 2.5);
      else if (type === 'error') iconSvg = window.Icons.close(13, 2.5);
      else iconSvg = window.Icons.info(13, 2);
    } else {
      iconSvg = type === 'success' 
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : type === 'error'
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }
    const iconBg = type === 'success' ? 'rgba(34, 197, 94, 0.15)' : type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)';
    const iconColor = type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6';
    
    const cleanMsg = String(message || '').replace(/^[\u2713\u2715\u26a1\u2139\u26a0\ufe0f]\s*/, '');

    toast.innerHTML = `
      <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${iconBg};color:${iconColor};flex-shrink:0;">${iconSvg}</span>
      <span style="font-size:13px;font-weight:500;color:var(--color-ink);">${cleanMsg}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.transition = 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px) scale(0.96)';
      setTimeout(() => toast.remove(), 260);
    }, 3200);
  }
};
