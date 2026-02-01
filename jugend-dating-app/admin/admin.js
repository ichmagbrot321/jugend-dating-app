// ==================== ADMIN PANEL LOGIC ====================

class AdminPanel {
  constructor() {
    this.currentAdmin = null;
    this.reports = [];
    this.users = [];
    this.logs = [];
    this.stats = {};
    this.init();
  }

  async init() {
    // Check Session
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
      await this.checkAdminAccess(session.user);
    } else {
      this.showLoginScreen();
    }

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Login
    document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleLogin();
    });

    // Navigation
    document.querySelectorAll('.admin-nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        this.switchSection(section);
      });
    });

    // Logout
    document.getElementById('admin-logout').addEventListener('click', async () => {
      await this.logout();
    });

    // Filters
    document.getElementById('report-filter-status')?.addEventListener('change', () => {
      this.loadReports();
    });

    document.getElementById('report-filter-reason')?.addEventListener('change', () => {
      this.loadReports();
    });

    document.getElementById('user-search')?.addEventListener('input', (e) => {
      this.searchUsers(e.target.value);
    });

    document.getElementById('user-filter-status')?.addEventListener('change', () => {
      this.loadUsers();
    });

    // Settings
    document.getElementById('add-moderator-btn')?.addEventListener('click', () => {
      this.addModerator();
    });

    // Modal Close
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.modal-overlay').classList.remove('show');
      });
    });
  }

  async handleLogin() {
    const email = document.getElementById('admin-email').value;
    const password = document.getElementById('admin-password').value;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      await this.checkAdminAccess(data.user);

    } catch (error) {
      this.showError('Login fehlgeschlagen: ' + error.message);
    }
  }

  async checkAdminAccess(user) {
    try {
      const { data: userData, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      // Prüfe Rolle
      if (!['moderator', 'admin', 'owner'].includes(userData.role)) {
        await supabase.auth.signOut();
        this.showError('Keine Berechtigung für das Admin-Panel');
        return;
      }

      this.currentAdmin = userData;
      await this.showAdminPanel();

    } catch (error) {
      this.showError('Fehler beim Laden der Daten');
    }
  }

  async showAdminPanel() {
    document.getElementById('admin-login-screen').classList.remove('active');
    document.getElementById('admin-panel').classList.add('active');

    // Update User Info
    document.getElementById('admin-username').textContent = this.currentAdmin.username;
    document.getElementById('admin-role').textContent = this.currentAdmin.role;
    document.getElementById('admin-avatar').src = this.currentAdmin.profilbild_url || '../images/default-avatar.png';

    // Zeige Settings nur für Admin/Owner
    if (['admin', 'owner'].includes(this.currentAdmin.role)) {
      document.getElementById('settings-nav').style.display = 'flex';
    }

    // Lade Dashboard
    await this.loadDashboard();

    // Subscribe zu Updates
    this.subscribeToUpdates();
  }

  async loadDashboard() {
    try {
      // Stats laden
      await this.loadStats();

      // Recent Actions
      await this.loadRecentActions();

      // Activity Chart
      await this.loadActivityChart();

    } catch (error) {
      console.error('Fehler beim Laden des Dashboards:', error);
    }
  }

  async loadStats() {
    // Total Users
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    document.getElementById('stat-total-users').textContent = totalUsers || 0;

    // Online Users (letzte 5 Minuten)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count: onlineUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('online_status', true)
      .gte('last_active_at', fiveMinutesAgo);

    document.getElementById('stat-online-users').textContent = onlineUsers || 0;

    // Pending Reports
    const { count: pendingReports } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    document.getElementById('stat-pending-reports').textContent = pendingReports || 0;
    
    // Update Badge
    if (pendingReports > 0) {
      document.getElementById('reports-badge').textContent = pendingReports;
      document.getElementById('reports-badge').style.display = 'block';
    }

    // Strikes Today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: strikesToday } = await supabase
      .from('moderation_logs')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'strike')
      .gte('created_at', today.toISOString());

    document.getElementById('stat-strikes-today').textContent = strikesToday || 0;

    // Banned Users
    const { count: bannedUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('account_status', 'banned');

    document.getElementById('stat-banned-users').textContent = bannedUsers || 0;

    // Messages Today
    const { count: messagesToday } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    document.getElementById('stat-messages-today').textContent = messagesToday || 0;

    // Appeals
    const { count: appeals } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('appealed', true)
      .eq('status', 'pending');

    if (appeals > 0) {
      document.getElementById('appeals-badge').textContent = appeals;
      document.getElementById('appeals-badge').style.display = 'block';
    }
  }

  async loadRecentActions() {
    const { data: actions, error } = await supabase
      .from('moderation_logs')
      .select(`
        *,
        user:users!moderation_logs_user_id_fkey(username),
        moderator:users!moderation_logs_moderator_id_fkey(username)
      `)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Fehler:', error);
      return;
    }

    const container = document.getElementById('recent-actions-list');
    
    if (!actions || actions.length === 0) {
      container.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 20px;">Keine Aktionen</p>';
      return;
    }

    container.innerHTML = actions.map(action => {
      const icons = {
        strike: '⚠️',
        restrict: '🔒',
        ban: '🚫',
        unban: '✅'
      };

      return `
        <div class="action-item">
          <div class="action-icon">${icons[action.action] || '📋'}</div>
          <div class="action-details">
            <strong>${action.moderator?.username || 'System'}</strong>
            <span>${action.action} für ${action.user.username}: ${action.reason}</span>
          </div>
          <div class="action-time">${this.formatTime(action.created_at)}</div>
        </div>
      `;
    }).join('');
  }

  async loadActivityChart() {
    // Lade Daten für letzte 7 Tage
    const days = 7;
    const labels = [];
    const messagesData = [];
    const usersData = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      labels.push(date.toLocaleDateString('de-DE', { weekday: 'short' }));

      // Messages
      const { count: messages } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', date.toISOString())
        .lt('created_at', nextDate.toISOString());

      messagesData.push(messages || 0);

      // New Users
      const { count: newUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', date.toISOString())
        .lt('created_at', nextDate.toISOString());

      usersData.push(newUsers || 0);
    }

    // Chart erstellen
    const ctx = document.getElementById('activity-chart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Nachrichten',
            data: messagesData,
            borderColor: '#6c5ce7',
            backgroundColor: 'rgba(108, 92, 231, 0.1)',
            tension: 0.4
          },
          {
            label: 'Neue Nutzer',
            data: usersData,
            borderColor: '#00d2d3',
            backgroundColor: 'rgba(0, 210, 211, 0.1)',
            tension: 0.4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: '#ffffff'
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#a0a0b0'
            },
            grid: {
              color: '#2e2e45'
            }
          },
          x: {
            ticks: {
              color: '#a0a0b0'
            },
            grid: {
              color: '#2e2e45'
            }
          }
        }
      }
    });
  }

  async loadReports() {
    const status = document.getElementById('report-filter-status').value;
    const reason = document.getElementById('report-filter-reason').value;

    let query = supabase
      .from('reports')
      .select(`
        *,
        reporter:users!reports_reporter_id_fkey(username, profilbild_url),
        reported_user:users!reports_reported_user_id_fkey(username, profilbild_url),
        message:messages(content)
      `)
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    if (reason !== 'all') {
      query = query.eq('reason', reason);
    }

    const { data: reports, error } = await query;

    if (error) {
      console.error('Fehler:', error);
      return;
    }

    this.reports = reports;
    this.renderReports();
  }

  renderReports() {
    const container = document.getElementById('reports-list');

    if (!this.reports || this.reports.length === 0) {
      container.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 40px;">Keine Meldungen gefunden</p>';
      return;
    }

    container.innerHTML = this.reports.map(report => {
      const priorityClass = report.reason === 'grooming' || report.reason === 'sexual' 
        ? 'priority-critical' 
        : report.reason === 'violence' ? 'priority-high' : '';

      return `
        <div class="report-card ${priorityClass}" data-report-id="${report.id}">
          <div class="report-header">
            <div class="report-info">
              <h4>${report.reporter.username} meldet ${report.reported_user.username}</h4>
              <p>${this.formatTime(report.created_at)}</p>
            </div>
            <span class="report-status ${report.status}">${this.translateStatus(report.status)}</span>
          </div>
          
          ${report.message?.content ? `
            <div class="report-content">"${report.message.content}"</div>
          ` : ''}
          
          <div class="report-meta">
            <span class="report-reason">${this.translateReason(report.reason)}</span>
            ${report.appealed ? '<span style="color: var(--warning);">⚖️ Widerspruch</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    // Event Listeners
    container.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => {
        const reportId = card.dataset.reportId;
        this.showReportDetail(reportId);
      });
    });
  }

  async showReportDetail(reportId) {
    const report = this.reports.find(r => r.id === reportId);
    if (!report) return;

    // Lade Chat-Verlauf falls vorhanden
    let chatMessages = [];
    if (report.chat_id) {
      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', report.chat_id)
        .order('created_at', { ascending: true })
        .limit(50);

      chatMessages = messages || [];
    }

    const content = `
      <h2>Meldung Details</h2>

      <div class="modal-section">
        <h3>Informationen</h3>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Gemeldet von</div>
            <div class="info-value">${report.reporter.username}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Gemeldeter Nutzer</div>
            <div class="info-value">${report.reported_user.username}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Grund</div>
            <div class="info-value">${this.translateReason(report.reason)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Status</div>
            <div class="info-value">${this.translateStatus(report.status)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Zeitpunkt</div>
            <div class="info-value">${new Date(report.created_at).toLocaleString('de-DE')}</div>
          </div>
          ${report.appealed ? `
            <div class="info-item">
              <div class="info-label">Widerspruch</div>
              <div class="info-value" style="color: var(--warning);">Ja</div>
            </div>
          ` : ''}
        </div>
      </div>

      ${report.details ? `
        <div class="modal-section">
          <h3>Details vom Melder</h3>
          <div class="message-preview">${report.details}</div>
        </div>
      ` : ''}

      ${report.appeal_reason ? `
        <div class="modal-section">
          <h3>Widerspruchsbegründung</h3>
          <div class="message-preview">${report.appeal_reason}</div>
        </div>
      ` : ''}

      ${report.message?.content ? `
        <div class="modal-section">
          <h3>Gemeldete Nachricht</h3>
          <div class="message-preview">${report.message.content}</div>
        </div>
      ` : ''}

      ${chatMessages.length > 0 ? `
        <div class="modal-section">
          <h3>Chat-Verlauf</h3>
          <div class="chat-replay">
            ${chatMessages.map(msg => `
              <div class="replay-message ${msg.sender_id === report.reported_user_id ? 'received' : 'sent'}">
                ${msg.content}
                <div style="font-size: 11px; opacity: 0.7; margin-top: 5px;">
                  ${new Date(msg.created_at).toLocaleTimeString('de-DE')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${report.status === 'pending' ? `
        <div class="modal-section">
          <h3>Aktionen</h3>
          <div class="action-buttons">
            <button class="btn-warning" data-action="warn">Verwarnung aussprechen</button>
            <button class="btn-warning" data-action="restrict">Account einschränken</button>
            <button class="btn-danger" data-action="ban">Account sperren</button>
            <button class="btn-secondary" data-action="reject">Meldung ablehnen</button>
            <button class="btn-success" data-action="dismiss">Keine Maßnahme</button>
          </div>
        </div>
      ` : ''}

      ${report.reviewed_by ? `
        <div class="modal-section">
          <h3>Bearbeitung</h3>
          <p>Bearbeitet am: ${new Date(report.reviewed_at).toLocaleString('de-DE')}</p>
          ${report.action_taken ? `<p>Maßnahme: ${report.action_taken}</p>` : ''}
          ${report.rejection_reason ? `<p>Ablehnungsgrund: ${report.rejection_reason}</p>` : ''}
        </div>
      ` : ''}
    `;

    document.getElementById('report-modal-content').innerHTML = content;
    document.getElementById('report-modal').classList.add('show');

    // Event Listeners
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        await this.handleReportAction(report.id, report.reported_user_id, action);
      });
    });
  }

  async handleReportAction(reportId, userId, action) {
    let actionTaken = '';
    let reason = '';

    if (action === 'warn') {
      reason = prompt('Grund für die Verwarnung:');
      if (!reason) return;

      // Strike hinzufügen
      const { data: user } = await supabase
        .from('users')
        .select('strikes')
        .eq('id', userId)
        .single();

      const newStrikes = (user.strikes || 0) + 1;

      await supabase
        .from('users')
        .update({ strikes: newStrikes })
        .eq('id', userId);

      // Log
      await supabase
        .from('moderation_logs')
        .insert({
          user_id: userId,
          moderator_id: this.currentAdmin.id,
          action: 'strike',
          reason: reason,
          strikes_after: newStrikes
        });

      // Benachrichtigung
      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          type: 'warning',
          title: 'Verwarnung',
          message: `Du hast eine Verwarnung erhalten: ${reason}`,
          data: { strikes: newStrikes, report_id: reportId }
        });

      actionTaken = `Verwarnung ausgesprochen (${newStrikes} Strikes)`;

    } else if (action === 'restrict') {
      reason = prompt('Grund für die Einschränkung:');
      if (!reason) return;

      await supabase
        .from('users')
        .update({ account_status: 'restricted' })
        .eq('id', userId);

      await supabase
        .from('moderation_logs')
        .insert({
          user_id: userId,
          moderator_id: this.currentAdmin.id,
          action: 'restrict',
          reason: reason
        });

      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          type: 'restriction',
          title: 'Account eingeschränkt',
          message: `Dein Account wurde eingeschränkt: ${reason}`,
          data: { report_id: reportId }
        });

      actionTaken = 'Account eingeschränkt';

    } else if (action === 'ban') {
      reason = prompt('Grund für die Sperrung:');
      if (!reason) return;

      await supabase
        .from('users')
        .update({ 
          account_status: 'banned',
          ban_reason: reason
        })
        .eq('id', userId);

      await supabase
        .from('moderation_logs')
        .insert({
          user_id: userId,
          moderator_id: this.currentAdmin.id,
          action: 'ban',
          reason: reason
        });

      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          type: 'ban',
          title: 'Account gesperrt',
          message: `Dein Account wurde gesperrt: ${reason}`,
          data: { report_id: reportId }
        });

      actionTaken = 'Account gesperrt';

    } else if (action === 'reject') {
      reason = prompt('Grund für die Ablehnung:');
      if (!reason) return;

      await supabase
        .from('reports')
        .update({
          status: 'rejected',
          reviewed_by: this.currentAdmin.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: reason
        })
        .eq('id', reportId);

      // Benachrichtige Reporter
      const report = this.reports.find(r => r.id === reportId);
      await supabase
        .from('notifications')
        .insert({
          user_id: report.reporter_id,
          type: 'report_update',
          title: 'Meldung abgelehnt',
          message: `Deine Meldung wurde abgelehnt: ${reason}. Du kannst Widerspruch einlegen.`,
          data: { report_id: reportId }
        });

      this.showToast('Meldung abgelehnt', 'success');
      document.getElementById('report-modal').classList.remove('show');
      await this.loadReports();
      return;

    } else if (action === 'dismiss') {
      await supabase
        .from('reports')
        .update({
          status: 'reviewed',
          reviewed_by: this.currentAdmin.id,
          reviewed_at: new Date().toISOString(),
          action_taken: 'Keine Maßnahme erforderlich'
        })
        .eq('id', reportId);

      this.showToast('Meldung als geprüft markiert', 'success');
      document.getElementById('report-modal').classList.remove('show');
      await this.loadReports();
      return;
    }

    // Update Report
    await supabase
      .from('reports')
      .update({
        status: 'action_taken',
        reviewed_by: this.currentAdmin.id,
        reviewed_at: new Date().toISOString(),
        action_taken: actionTaken
      })
      .eq('id', reportId);

    // Benachrichtige Reporter
    const report = this.reports.find(r => r.id === reportId);
    await supabase
      .from('notifications')
      .insert({
        user_id: report.reporter_id,
        type: 'report_update',
        title: 'Meldung bearbeitet',
        message: `Deine Meldung wurde bearbeitet. Maßnahme: ${actionTaken}`,
        data: { report_id: reportId }
      });

    this.showToast('Maßnahme durchgeführt', 'success');
    document.getElementById('report-modal').classList.remove('show');
    await this.loadReports();
    await this.loadDashboard();
  }

  async loadUsers() {
    const status = document.getElementById('user-filter-status').value;

    let query = supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      query = query.eq('account_status', status);
    }

    const { data: users, error } = await query;

    if (error) {
      console.error('Fehler:', error);
      return;
    }

    this.users = users;
    this.renderUsers();
  }

  renderUsers() {
    const container = document.getElementById('users-table');

    if (!this.users || this.users.length === 0) {
      container.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 40px;">Keine Nutzer gefunden</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Nutzer</th>
            <th>Alter</th>
            <th>Region</th>
            <th>Strikes</th>
            <th>Status</th>
            <th>Registriert</th>
          </tr>
        </thead>
        <tbody>
          ${this.users.map(user => {
            const age = this.calculateAge(user.geburtsdatum);
            return `
              <tr data-user-id="${user.id}">
                <td>
                  <div class="user-cell">
                    <img src="${user.profilbild_url || '../images/default-avatar.png'}" alt="${user.username}">
                    <div>
                      <div>${user.username}</div>
                      <div style="font-size: 12px; color: var(--text-secondary);">${user.role}</div>
                    </div>
                  </div>
                </td>
                <td>${age} Jahre</td>
                <td>${user.region}</td>
                <td>${user.strikes || 0}</td>
                <td><span class="status-badge ${user.account_status}">${this.translateStatus(user.account_status)}</span></td>
                <td>${new Date(user.created_at).toLocaleDateString('de-DE')}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    // Event Listeners
    container.querySelectorAll('tr[data-user-id]').forEach(row => {
      row.addEventListener('click', () => {
        const userId = row.dataset.userId;
        this.showUserDetail(userId);
      });
    });
  }

  async showUserDetail(userId) {
    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    // Lade zusätzliche Daten
    const { data: reports } = await supabase
      .from('reports')
      .select('*')
      .eq('reported_user_id', userId);

    const { data: logs } = await supabase
      .from('moderation_logs')
      .select('*, moderator:users!moderation_logs_moderator_id_fkey(username)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    const age = this.calculateAge(user.geburtsdatum);

    const content = `
      <h2>Nutzer Details</h2>

      <div class="modal-section">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="${user.profilbild_url || '../images/default-avatar.png'}" 
               style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; border: 3px solid var(--primary);">
          <h3 style="margin-top: 10px;">${user.username}</h3>
          <span class="status-badge ${user.account_status}">${this.translateStatus(user.account_status)}</span>
        </div>

        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Alter</div>
            <div class="info-value">${age} Jahre</div>
          </div>
          <div class="info-item">
            <div class="info-label">Region</div>
            <div class="info-value">${user.region}${user.stadt ? ', ' + user.stadt : ''}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Rolle</div>
            <div class="info-value">${user.role}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Verwarnungen</div>
            <div class="info-value" style="color: ${user.strikes > 2 ? 'var(--error)' : 'inherit'}">${user.strikes || 0}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Registriert</div>
            <div class="info-value">${new Date(user.created_at).toLocaleDateString('de-DE')}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Letzte Aktivität</div>
            <div class="info-value">${this.formatTime(user.last_active_at)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Eltern verifiziert</div>
            <div class="info-value">${user.verified_parent ? '✅ Ja' : '❌ Nein'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">VPN erkannt</div>
            <div class="info-value">${user.vpn_detected ? '⚠️ Ja' : '✅ Nein'}</div>
          </div>
        </div>

        ${user.interessen ? `
          <div class="info-item" style="margin-top: 15px;">
            <div class="info-label">Interessen</div>
            <div class="info-value">${user.interessen}</div>
          </div>
        ` : ''}

        ${user.ban_reason ? `
          <div class="info-item" style="margin-top: 15px; background: rgba(255, 107, 107, 0.1); border-left: 3px solid var(--error);">
            <div class="info-label">Sperrgrund</div>
            <div class="info-value">${user.ban_reason}</div>
          </div>
        ` : ''}
      </div>

      <div class="modal-section">
        <h3>Meldungen (${reports?.length || 0})</h3>
        ${reports && reports.length > 0 ? `
          <p style="color: var(--text-secondary); font-size: 13px;">
            ${reports.filter(r => r.status === 'action_taken').length} Maßnahmen ergriffen,
            ${reports.filter(r => r.status === 'pending').length} offen
          </p>
        ` : '<p style="color: var(--text-secondary);">Keine Meldungen</p>'}
      </div>

      ${logs && logs.length > 0 ? `
        <div class="modal-section">
          <h3>Moderations-Historie</h3>
          <div style="max-height: 300px; overflow-y: auto;">
            ${logs.map(log => `
              <div style="padding: 10px; background: var(--surface-light); border-radius: 8px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                  <strong>${log.action}</strong>
                  <span style="font-size: 12px; color: var(--text-secondary);">${this.formatTime(log.created_at)}</span>
                </div>
                <div style="font-size: 13px; color: var(--text-secondary);">
                  ${log.reason}
                </div>
                <div style="font-size: 12px; color: var(--text-secondary); margin-top: 5px;">
                  von ${log.moderator?.username || 'System'}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="modal-section">
        <h3>Aktionen</h3>
        <div class="action-buttons">
          ${user.account_status === 'active' ? `
            <button class="btn-warning" data-action="warn">Verwarnung</button>
            <button class="btn-warning" data-action="restrict">Einschränken</button>
            <button class="btn-danger" data-action="ban">Sperren</button>
          ` : ''}
          ${user.account_status === 'banned' ? `
            <button class="btn-success" data-action="unban">Entsperren</button>
          ` : ''}
          ${user.account_status === 'restricted' ? `
            <button class="btn-success" data-action="unrestrict">Einschränkung aufheben</button>
          ` : ''}
          ${user.strikes > 0 ? `
            <button class="btn-secondary" data-action="reset-strikes">Strikes zurücksetzen</button>
          ` : ''}
        </div>
      </div>
    `;

    document.getElementById('user-modal-content').innerHTML = content;
    document.getElementById('user-modal').classList.add('show');

    // Event Listeners
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        await this.handleUserAction(userId, action);
      });
    });
  }

  async handleUserAction(userId, action) {
    let reason = '';

    if (action === 'warn') {
      reason = prompt('Grund für die Verwarnung:');
      if (!reason) return;

      const { data: user } = await supabase
        .from('users')
        .select('strikes')
        .eq('id', userId)
        .single();

      const newStrikes = (user.strikes || 0) + 1;

      await supabase
        .from('users')
        .update({ strikes: newStrikes })
        .eq('id', userId);

      await supabase
        .from('moderation_logs')
        .insert({
          user_id: userId,
          moderator_id: this.currentAdmin.id,
          action: 'strike',
          reason: reason,
          strikes_after: newStrikes
        });

      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          type: 'warning',
          title: 'Verwarnung',
          message: `Du hast eine Verwarnung erhalten: ${reason}`,
          data: { strikes: newStrikes }
        });

      this.showToast('Verwarnung ausgesprochen', 'success');

    } else if (action === 'restrict') {
      reason = prompt('Grund für die Einschränkung:');
      if (!reason) return;

      await supabase
        .from('users')
        .update({ account_status: 'restricted' })
        .eq('id', userId);

      await supabase
        .from('moderation_logs')
        .insert({
          user_id: userId,
          moderator_id: this.currentAdmin.id,
          action: 'restrict',
          reason: reason
        });

      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          type: 'restriction',
          title: 'Account eingeschränkt',
          message: `Dein Account wurde eingeschränkt: ${reason}`,
          data: {}
        });

      this.showToast('Account eingeschränkt', 'success');

    } else if (action === 'ban') {
      reason = prompt('Grund für die Sperrung:');
      if (!reason) return;

      await supabase
        .from('users')
        .update({ 
          account_status: 'banned',
          ban_reason: reason
        })
        .eq('id', userId);

      await supabase
        .from('moderation_logs')
        .insert({
          user_id: userId,
          moderator_id: this.currentAdmin.id,
          action: 'ban',
          reason: reason
        });

      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          type: 'ban',
          title: 'Account gesperrt',
          message: `Dein Account wurde gesperrt: ${reason}`,
          data: {}
        });

      this.showToast('Account gesperrt', 'success');

    } else if (action === 'unban') {
      await supabase
        .from('users')
        .update({ 
          account_status: 'active',
          ban_reason: null
        })
        .eq('id', userId);

      await supabase
        .from('moderation_logs')
        .insert({
          user_id: userId,
          moderator_id: this.currentAdmin.id,
          action: 'unban',
          reason: 'Entsperrt durch Moderator'
        });

      this.showToast('Account entsperrt', 'success');

    } else if (action === 'unrestrict') {
      await supabase
        .from('users')
        .update({ account_status: 'active' })
        .eq('id', userId);

      await supabase
        .from('moderation_logs')
        .insert({
          user_id: userId,
          moderator_id: this.currentAdmin.id,
          action: 'unrestrict',
          reason: 'Einschränkung aufgehoben'
        });

      this.showToast('Einschränkung aufgehoben', 'success');

    } else if (action === 'reset-strikes') {
      await supabase
        .from('users')
        .update({ strikes: 0 })
        .eq('id', userId);

      await supabase
        .from('moderation_logs')
        .insert({
          user_id: userId,
          moderator_id: this.currentAdmin.id,
          action: 'reset_strikes',
          reason: 'Strikes zurückgesetzt'
        });

      this.showToast('Strikes zurückgesetzt', 'success');
    }

    document.getElementById('user-modal').classList.remove('show');
    await this.loadUsers();
    await this.loadDashboard();
  }

  async loadModerationLogs() {
    const dateFrom = document.getElementById('log-date-from').value;
    const dateTo = document.getElementById('log-date-to').value;
    const action = document.getElementById('log-filter-action').value;

    let query = supabase
      .from('moderation_logs')
      .select(`
        *,
        user:users!moderation_logs_user_id_fkey(username),
        moderator:users!moderation_logs_moderator_id_fkey(username)
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (action !== 'all') {
      query = query.eq('action', action);
    }

    if (dateFrom) {
      query = query.gte('created_at', new Date(dateFrom).toISOString());
    }

    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59);
      query = query.lte('created_at', endDate.toISOString());
    }

    const { data: logs, error } = await query;

    if (error) {
      console.error('Fehler:', error);
      return;
    }

    this.logs = logs;
    this.renderLogs();
  }

  renderLogs() {
    const container = document.getElementById('logs-table');

    if (!this.logs || this.logs.length === 0) {
      container.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 40px;">Keine Logs gefunden</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Zeitpunkt</th>
            <th>Nutzer</th>
            <th>Aktion</th>
            <th>Grund</th>
            <th>Moderator</th>
          </tr>
        </thead>
        <tbody>
          ${this.logs.map(log => `
            <tr>
              <td>${new Date(log.created_at).toLocaleString('de-DE')}</td>
              <td>${log.user.username}</td>
              <td><span class="status-badge ${log.action}">${log.action}</span></td>
              <td>${log.reason}</td>
              <td>${log.moderator?.username || 'System'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  async loadAppeals() {
    const { data: appeals, error } = await supabase
      .from('reports')
      .select(`
        *,
        reporter:users!reports_reporter_id_fkey(username),
        reported_user:users!reports_reported_user_id_fkey(username)
      `)
      .eq('appealed', true)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fehler:', error);
      return;
    }

    const container = document.getElementById('appeals-list');

    if (!appeals || appeals.length === 0) {
      container.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 40px;">Keine Widersprüche</p>';
      return;
    }

    container.innerHTML = appeals.map(appeal => `
      <div class="report-card priority-high" data-report-id="${appeal.id}">
        <div class="report-header">
          <div class="report-info">
            <h4>⚖️ Widerspruch: ${appeal.reporter.username} vs. ${appeal.reported_user.username}</h4>
            <p>Original-Meldung: ${this.formatTime(appeal.created_at)}</p>
          </div>
          <span class="report-status pending">Widerspruch</span>
        </div>
        
        <div class="report-content">
          <strong>Original-Grund:</strong> ${this.translateReason(appeal.reason)}<br>
          <strong>Ablehnungsgrund:</strong> ${appeal.rejection_reason}<br>
          <strong>Widerspruch:</strong> ${appeal.appeal_reason}
        </div>
        
        <div class="report-meta">
          <span class="report-reason">Erneute Prüfung erforderlich</span>
        </div>
      </div>
    `).join('');

    // Event Listeners
    container.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => {
        const reportId = card.dataset.reportId;
        this.showReportDetail(reportId);
      });
    });
  }

  async addModerator() {
    const email = document.getElementById('new-moderator-email').value.trim();
    if (!email) {
      this.showToast('Bitte E-Mail eingeben', 'error');
      return;
    }

    // Nur Owner kann Moderatoren hinzufügen
    if (this.currentAdmin.role !== 'owner' && this.currentAdmin.role !== 'admin') {
      this.showToast('Keine Berechtigung', 'error');
      return;
    }

    try {
      // Suche User
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', (await supabase.auth.admin.getUserByEmail(email)).data.user.id)
        .single();

      if (error) throw error;

      // Update Rolle
      await supabase
        .from('users')
        .update({ role: 'moderator' })
        .eq('id', user.id);

      this.showToast('Moderator hinzugefügt', 'success');
      document.getElementById('new-moderator-email').value = '';
      await this.loadModerators();

    } catch (error) {
      this.showToast('Fehler: ' + error.message, 'error');
    }
  }

  async loadModerators() {
    const { data: moderators, error } = await supabase
      .from('users')
      .select('*')
      .in('role', ['moderator', 'admin'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fehler:', error);
      return;
    }

    const container = document.getElementById('moderators-list');
    
    container.innerHTML = moderators.map(mod => `
      <div class="moderator-item">
        <div class="moderator-info">
          <img src="${mod.profilbild_url || '../images/default-avatar.png'}" alt="${mod.username}">
          <div>
            <div style="font-weight: 600;">${mod.username}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">${mod.role}</div>
          </div>
        </div>
        ${this.currentAdmin.role === 'owner' && mod.role !== 'owner' ? `
          <button class="btn-danger" data-user-id="${mod.id}">Entfernen</button>
        ` : ''}
      </div>
    `).join('');

    // Event Listeners
    container.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        await this.removeModerator(userId);
      });
    });
  }

  async removeModerator(userId) {
    if (!confirm('Moderator wirklich entfernen?')) return;

    await supabase
      .from('users')
      .update({ role: 'user' })
      .eq('id', userId);

    this.showToast('Moderator entfernt', 'success');
    await this.loadModerators();
  }

  subscribeToUpdates() {
    // Subscribe zu neuen Reports
    supabase
      .channel('admin_reports')
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'reports'
        },
        () => {
          this.loadDashboard();
          if (document.getElementById('section-reports').classList.contains('active')) {
            this.loadReports();
          }
        }
      )
      .subscribe();
  }

  switchSection(section) {
    // Update Navigation
    document.querySelectorAll('.admin-nav-item').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelector(`[data-section="${section}"]`).classList.add('active');

    // Update Sections
    document.querySelectorAll('.admin-section').forEach(sec => {
      sec.classList.remove('active');
    });
    document.getElementById(`section-${section}`).classList.add('active');

    // Lade Daten
    if (section === 'reports') {
      this.loadReports();
    } else if (section === 'users') {
      this.loadUsers();
    } else if (section === 'moderation-logs') {
      this.loadModerationLogs();
    } else if (section === 'appeals') {
      this.loadAppeals();
    } else if (section === 'settings') {
      this.loadModerators();
    }
  }

  searchUsers(query) {
    const filtered = this.users.filter(user => 
      user.username.toLowerCase().includes(query.toLowerCase())
    );
    
    const temp = this.users;
    this.users = filtered;
    this.renderUsers();
    this.users = temp;
  }

  async logout() {
    await supabase.auth.signOut();
    location.reload();
  }

  showLoginScreen() {
    document.getElementById('admin-login-screen').classList.add('active');
    document.getElementById('admin-panel').classList.remove('active');
  }

  showError(message) {
    const errorEl = document.getElementById('admin-error');
    errorEl.textContent = message;
    errorEl.classList.add('show');
    
    setTimeout(() => {
      errorEl.classList.remove('show');
    }, 5000);
  }

  showToast(message, type = 'info') {
    const toast = document.getElementById('admin-toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 4000);
  }

  translateStatus(status) {
    const translations = {
      pending: 'Offen',
      reviewed: 'Geprüft',
      action_taken: 'Maßnahme ergriffen',
      rejected: 'Abgelehnt',
      active: 'Aktiv',
      restricted: 'Eingeschränkt',
      banned: 'Gesperrt'
    };
    return translations[status] || status;
  }

  translateReason(reason) {
    const translations = {
      grooming: 'Grooming/Belästigung',
      sexual: 'Sexuelle Inhalte',
      violence: 'Gewalt/Drohung',
      drugs: 'Drogen',
      personal_data: 'Persönliche Daten',
      spam: 'Spam',
      harassment: 'Belästigung',
      fake_profile: 'Fake-Profil',
      inappropriate: 'Unangemessen',
      underage: 'Minderjährig',
      other: 'Sonstiges'
    };
    return translations[reason] || reason;
  }

  calculateAge(birthdate) {
    const today = new Date();
    const birth = new Date(birthdate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    
    return age;
  }

  formatTime(timestamp) {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'gerade eben';
    if (diffMins < 60) return `vor ${diffMins}min`;
    if (diffHours < 24) return `vor ${diffHours}h`;
    if (diffDays < 7) return `vor ${diffDays}d`;
    
    return date.toLocaleDateString('de-DE');
  }
}

// Init
const adminPanel = new AdminPanel();
