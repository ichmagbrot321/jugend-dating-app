// ==================== MAIN APP ====================

class App {
  constructor() {
    this.currentUser = null;
    this.users = [];
    this.allUsers = []; // Für Filter-Reset
    this.init();
  }

  async init(user = null) {
    if (user) {
      this.currentUser = user;
      await this.loadApp();
    }

    this.setupEventListeners();
    this.registerServiceWorker();
    this.requestNotificationPermission();
  }

  setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const screen = e.currentTarget.dataset.screen;
        this.switchView(screen);
      });
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await this.logout();
    });

    // Profilbild ändern
    document.getElementById('change-picture-btn').addEventListener('click', () => {
      document.getElementById('picture-upload').click();
    });

    document.getElementById('picture-upload').addEventListener('change', async (e) => {
      await this.uploadProfilePicture(e.target.files[0]);
    });

    // Privacy Toggles
    document.getElementById('toggle-online').addEventListener('change', async (e) => {
      await this.updatePrivacySetting('online_status', e.target.checked);
    });

    document.getElementById('toggle-read').addEventListener('change', async (e) => {
      await this.updatePrivacySetting('gelesen_status', e.target.checked);
    });

    document.getElementById('toggle-typing').addEventListener('change', async (e) => {
      await this.updatePrivacySetting('schreibstatus', e.target.checked);
    });

    // Settings Button
    document.getElementById('settings-btn').addEventListener('click', () => {
      this.showSettings();
    });

    // Filter Button
    document.getElementById('filter-btn').addEventListener('click', () => {
      this.showFilters();
    });
  }

  async loadApp() {
    // Zeige Loading
    document.getElementById('loading-screen').classList.add('active');

    try {
      // Lade Profil
      await this.loadProfile();

      // Lade Discover Users
      await this.loadDiscoverUsers();

      // Lade Chats
      if (typeof chatManager !== 'undefined') {
        await chatManager.loadChats(this.currentUser.id);
      }

      // Subscribe zu Notifications
      this.subscribeToNotifications();

      // Hide Loading
      setTimeout(() => {
        document.getElementById('loading-screen').classList.remove('active');
      }, 500);

    } catch (error) {
      console.error('Fehler beim Laden der App:', error);
      authManager.showToast('Fehler beim Laden', 'error');
      document.getElementById('loading-screen').classList.remove('active');
    }
  }

  async loadProfile() {
    // Update Profil-Ansicht
    document.getElementById('profile-username').textContent = this.currentUser.username;
    
    const age = authManager.calculateAge(this.currentUser.geburtsdatum);
    document.getElementById('profile-age').textContent = `${age} Jahre`;
    
    document.getElementById('profile-region').textContent = 
      `${this.currentUser.region}${this.currentUser.stadt ? ', ' + this.currentUser.stadt : ''}`;
    
    document.getElementById('profile-interests').textContent = 
      this.currentUser.interessen || 'Keine Angaben';

    // Profilbild
    const profileImg = this.currentUser.profilbild_url || '/images/default-avatar.png';
    document.getElementById('profile-img').src = profileImg;

    // Privacy Toggles
    document.getElementById('toggle-online').checked = this.currentUser.online_status ?? true;
    document.getElementById('toggle-read').checked = this.currentUser.gelesen_status ?? true;
    document.getElementById('toggle-typing').checked = this.currentUser.schreibstatus ?? true;
  }

  async loadDiscoverUsers() {
    try {
      // Hole blockierte User IDs
      const { data: blocks } = await supabase
        .from('blocks')
        .select('blocked_id')
        .eq('blocker_id', this.currentUser.id);

      const blockedIds = blocks ? blocks.map(b => b.blocked_id) : [];

      // Lade User (nicht blockiert, nicht selbst)
      let query = supabase
        .from('users')
        .select('id, username, geburtsdatum, profilbild_url, region, stadt, interessen, online_status, zuletzt_online, latitude, longitude')
        .neq('id', this.currentUser.id)
        .eq('account_status', 'active')
        .limit(100);

      // Filter blockierte
      if (blockedIds.length > 0) {
        query = query.not('id', 'in', `(${blockedIds.join(',')})`);
      }

      const { data: users, error } = await query;

      if (error) throw error;

      this.allUsers = users; // Speichere alle für Filter-Reset
      this.users = users;
      this.renderDiscoverUsers();

    } catch (error) {
      console.error('Fehler beim Laden der User:', error);
    }
  }

  renderDiscoverUsers() {
    const container = document.getElementById('user-cards');

    if (this.users.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center; color: var(--text-secondary);">
          <p style="font-size: 48px; margin-bottom: 10px;">🔍</p>
          <p>Keine neuen Nutzer gefunden</p>
          <p style="font-size: 14px; margin-top: 10px;">Versuche die Filter anzupassen</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.users.map(user => {
      const age = authManager.calculateAge(user.geburtsdatum);
      const isOnline = user.online_status && chatManager.isRecentlyActive(user.zuletzt_online);

      // Berechne Entfernung falls möglich
      let distanceText = '';
      if (this.currentUser.latitude && this.currentUser.longitude && 
          user.latitude && user.longitude && 
          typeof calculateDistance === 'function') {
        const distance = calculateDistance(
          this.currentUser.latitude,
          this.currentUser.longitude,
          user.latitude,
          user.longitude
        );
        distanceText = `<div class="user-card-distance">📍 ${Math.round(distance)} km</div>`;
      }

      return `
        <div class="user-card" data-user-id="${user.id}">
          <img src="${user.profilbild_url || '/images/default-avatar.png'}" 
               alt="${user.username}" 
               class="user-card-img">
          <div class="user-card-info">
            <div class="user-card-name">
              ${isOnline ? '<span class="user-card-online"></span>' : ''}
              ${user.username}
            </div>
            <div class="user-card-age">${age} Jahre</div>
            <div class="user-card-region">${user.region}</div>
            ${distanceText}
          </div>
        </div>
      `;
    }).join('');

    // Event Listeners
    container.querySelectorAll('.user-card').forEach(card => {
      card.addEventListener('click', () => {
        const userId = card.dataset.userId;
        this.showUserProfile(userId);
      });
    });
  }

  async showUserProfile(userId) {
    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    const age = authManager.calculateAge(user.geburtsdatum);
    const isOnline = user.online_status && chatManager.isRecentlyActive(user.zuletzt_online);

    // Berechne Entfernung
    let distanceHTML = '';
    if (this.currentUser.latitude && this.currentUser.longitude && 
        user.latitude && user.longitude && 
        typeof calculateDistance === 'function') {
      const distance = calculateDistance(
        this.currentUser.latitude,
        this.currentUser.longitude,
        user.latitude,
        user.longitude
      );
      distanceHTML = `<p style="margin-bottom: 10px;"><strong>Entfernung:</strong> ca. ${Math.round(distance)} km</p>`;
    }

    const content = `
      <div style="text-align: center;">
        <img src="${user.profilbild_url || '/images/default-avatar.png'}" 
             style="width: 120px; height: 120px; border-radius: 50%; object-fit: cover; border: 3px solid var(--primary); margin-bottom: 20px;">
        <h2 style="margin-bottom: 5px;">
          ${isOnline ? '<span style="color: var(--success);">● </span>' : ''}
          ${user.username}
        </h2>
        <p style="color: var(--text-secondary); margin-bottom: 20px;">${age} Jahre</p>
        
        <div style="background: var(--surface-light); padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: left;">
          <p style="margin-bottom: 10px;"><strong>Region:</strong> ${user.region}${user.stadt ? ', ' + user.stadt : ''}</p>
          ${distanceHTML}
          <p><strong>Interessen:</strong> ${user.interessen || 'Keine Angaben'}</p>
        </div>

        <div style="display: flex; gap: 10px;">
          <button class="btn-primary" data-action="chat" style="flex: 1;">
            💬 Chat starten
          </button>
          <button class="btn-secondary" data-action="block">
            🚫 Blockieren
          </button>
        </div>
      </div>
    `;

    authManager.showModal(content);

    // Event Listeners
    document.querySelector('[data-action="chat"]').addEventListener('click', async () => {
      await this.startChat(userId);
      document.getElementById('modal-overlay').classList.remove('show');
    });

    document.querySelector('[data-action="block"]').addEventListener('click', async () => {
      if (typeof chatManager !== 'undefined') {
        await chatManager.blockUser(userId);
      }
      document.getElementById('modal-overlay').classList.remove('show');
      await this.loadDiscoverUsers();
    });
  }

  async startChat(partnerId) {
    try {
      // Prüfe ob Chat bereits existiert
      const { data: existingChat } = await supabase
        .from('chats')
        .select('id')
        .or(`and(user1_id.eq.${this.currentUser.id},user2_id.eq.${partnerId}),and(user1_id.eq.${partnerId},user2_id.eq.${this.currentUser.id})`)
        .single();

      let chatId;

      if (existingChat) {
        chatId = existingChat.id;
      } else {
        // Erstelle neuen Chat
        const { data: newChat, error } = await supabase
          .from('chats')
          .insert({
            user1_id: this.currentUser.id,
            user2_id: partnerId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;
        chatId = newChat.id;
      }

      // Öffne Chat
      if (typeof chatManager !== 'undefined') {
        await chatManager.openChat(chatId, partnerId);
      }

      // Wechsel zu Chats-View
      this.switchView('chats');

    } catch (error) {
      console.error('Fehler beim Starten des Chats:', error);
      authManager.showToast('Chat konnte nicht gestartet werden', 'error');
    }
  }

  async uploadProfilePicture(file) {
    if (!file) return;

    // Validierung
    if (!file.type.startsWith('image/')) {
      authManager.showToast('Bitte wähle ein Bild aus', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB
      authManager.showToast('Bild ist zu groß (max. 5MB)', 'error');
      return;
    }

    try {
      authManager.showToast('Bild wird überprüft...', 'info');

      // Moderation Check
      if (typeof moderationManager !== 'undefined') {
        const moderationResult = await moderationManager.checkProfileImage(file, this.currentUser.id);

        if (!moderationResult.allowed) {
          authManager.showToast(moderationResult.reason, 'error');
          return;
        }
      }

      // Upload zu Supabase Storage
      const fileName = `${this.currentUser.id}-${Date.now()}.jpg`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('profile-pictures')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) throw uploadError;

      // Hole Public URL
      const { data: urlData } = supabase.storage
        .from('profile-pictures')
        .getPublicUrl(fileName);

      // Update User
      const { error: updateError } = await supabase
        .from('users')
        .update({ profilbild_url: urlData.publicUrl })
        .eq('id', this.currentUser.id);

      if (updateError) throw updateError;

      // Update UI
      this.currentUser.profilbild_url = urlData.publicUrl;
      document.getElementById('profile-img').src = urlData.publicUrl;

      authManager.showToast('Profilbild aktualisiert!', 'success');

    } catch (error) {
      console.error('Fehler beim Upload:', error);
      authManager.showToast('Upload fehlgeschlagen', 'error');
    }
  }

  async updatePrivacySetting(setting, value) {
    try {
      await supabase
        .from('users')
        .update({ [setting]: value })
        .eq('id', this.currentUser.id);

      this.currentUser[setting] = value;
      authManager.showToast('Einstellung gespeichert', 'success');

    } catch (error) {
      console.error('Fehler beim Speichern:', error);
      authManager.showToast('Speichern fehlgeschlagen', 'error');
    }
  }

  switchView(viewName) {
    // Update Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelector(`.nav-item[data-screen="${viewName}"]`).classList.add('active');

    // Update Views
    document.querySelectorAll('.view').forEach(view => {
      view.classList.remove('active');
    });

    if (viewName === 'discover') {
      document.getElementById('discover-view').classList.add('active');
    } else if (viewName === 'chats') {
      document.getElementById('chats-view').classList.add('active');
      if (typeof chatManager !== 'undefined') {
        chatManager.loadChats(this.currentUser.id);
      }
    } else if (viewName === 'profile') {
      document.getElementById('profile-view').classList.add('active');
    }
  }

  showSettings() {
    const content = `
      <h2>Einstellungen</h2>
      
      <div style="margin-top: 20px;">
        <h3 style="font-size: 16px; margin-bottom: 15px;">Account</h3>
        <button class="btn-secondary" data-action="change-password" style="width: 100%; margin-bottom: 10px;">
          Passwort ändern
        </button>
        <button class="btn-secondary" data-action="delete-account" style="width: 100%; margin-bottom: 10px;">
          Account löschen
        </button>
      </div>

      <div style="margin-top: 20px;">
        <h3 style="font-size: 16px; margin-bottom: 15px;">Standort</h3>
        ${this.currentUser.stadt ? `
          <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 10px;">
            📍 Stadt: ${this.currentUser.stadt}, ${this.currentUser.region}
          </p>
        ` : `
          <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 10px;">
            Keine Stadt angegeben
          </p>
        `}
        <button class="btn-secondary" data-action="update-location" style="width: 100%;">
          Stadt ${this.currentUser.stadt ? 'ändern' : 'hinzufügen'}
        </button>
      </div>

      <div style="margin-top: 20px;">
        <h3 style="font-size: 16px; margin-bottom: 15px;">Benachrichtigungen</h3>
        <label class="toggle-label">
          <span>Push-Benachrichtigungen</span>
          <input type="checkbox" id="setting-notifications" ${Notification.permission === 'granted' ? 'checked' : ''}>
        </label>
      </div>

      <div style="margin-top: 20px;">
        <h3 style="font-size: 16px; margin-bottom: 15px;">Meine Meldungen</h3>
        <button class="btn-secondary" data-action="my-reports" style="width: 100%;">
          Meldungen anzeigen
        </button>
      </div>

      ${this.currentUser.strikes > 0 ? `
        <div style="margin-top: 20px; padding: 15px; background: rgba(255, 107, 107, 0.1); border-radius: 10px;">
          <p style="color: var(--error); font-weight: 600;">⚠️ Verwarnungen: ${this.currentUser.strikes}</p>
        </div>
      ` : ''}
    `;

    authManager.showModal(content);

    // Event Listeners
    document.querySelector('[data-action="change-password"]')?.addEventListener('click', () => {
      this.changePassword();
    });

    document.querySelector('[data-action="delete-account"]')?.addEventListener('click', () => {
      this.deleteAccount();
    });

    document.querySelector('[data-action="my-reports"]')?.addEventListener('click', () => {
      this.showMyReports();
    });

    document.querySelector('[data-action="update-location"]')?.addEventListener('click', () => {
      this.updateLocation();
    });

    document.getElementById('setting-notifications')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.requestNotificationPermission();
      }
    });
  }

  async updateLocation() {
    const city = prompt('Stadt eingeben (optional):', this.currentUser.stadt || '');
    
    if (city === null) return; // Abgebrochen

    try {
      let coordinates = null;
      
      if (city && typeof getCityCoordinates === 'function') {
        authManager.showToast('Koordinaten werden ermittelt...', 'info');
        coordinates = await getCityCoordinates(city, this.currentUser.region);
      }

      await supabase
        .from('users')
        .update({
          stadt: city || null,
          latitude: coordinates?.lat || null,
          longitude: coordinates?.lon || null
        })
        .eq('id', this.currentUser.id);

      this.currentUser.stadt = city || null;
      this.currentUser.latitude = coordinates?.lat || null;
      this.currentUser.longitude = coordinates?.lon || null;

      authManager.showToast('Standort aktualisiert', 'success');
      document.getElementById('modal-overlay').classList.remove('show');

      // Lade Profil neu
      await this.loadProfile();

    } catch (error) {
      console.error('Fehler beim Aktualisieren:', error);
      authManager.showToast('Aktualisierung fehlgeschlagen', 'error');
    }
  }

  async showMyReports() {
    try {
      const { data: reports, error } = await supabase
        .from('reports')
        .select(`
          *,
          reported_user:users!reports_reported_user_id_fkey(username)
        `)
        .eq('reporter_id', this.currentUser.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const content = `
        <h2>Meine Meldungen</h2>
        <div style="margin-top: 20px; max-height: 400px; overflow-y: auto;">
          ${reports.length === 0 ? `
            <p style="text-align: center; color: var(--text-secondary); padding: 20px;">
              Keine Meldungen
            </p>
          ` : reports.map(report => {
            const statusColors = {
              pending: 'var(--warning)',
              reviewed: 'var(--primary)',
              action_taken: 'var(--success)',
              rejected: 'var(--error)'
            };

            const statusTexts = {
              pending: 'In Bearbeitung',
              reviewed: 'Geprüft',
              action_taken: 'Maßnahme ergriffen',
              rejected: 'Abgelehnt'
            };

            return `
              <div style="background: var(--surface-light); padding: 15px; border-radius: 10px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                  <strong>Gegen: ${report.reported_user.username}</strong>
                  <span style="color: ${statusColors[report.status]}; font-size: 12px;">
                    ${statusTexts[report.status]}
                  </span>
                </div>
                <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 5px;">
                  Grund: ${report.reason}
                </p>
                <p style="font-size: 12px; color: var(--text-secondary);">
                  ${typeof chatManager !== 'undefined' ? chatManager.formatTime(report.created_at) : new Date(report.created_at).toLocaleDateString()}
                </p>
                ${report.status === 'rejected' && report.rejection_reason ? `
                  <div style="margin-top: 10px; padding: 10px; background: rgba(255, 107, 107, 0.1); border-radius: 5px;">
                    <p style="font-size: 12px; color: var(--error);">
                      Ablehnungsgrund: ${report.rejection_reason}
                    </p>
                    ${!report.appealed ? `
                      <button class="btn-secondary" data-report-id="${report.id}" data-action="appeal" 
                              style="width: 100%; margin-top: 10px; font-size: 12px; padding: 8px;">
                        Widerspruch einlegen
                      </button>
                    ` : '<p style="font-size: 11px; color: var(--text-secondary); margin-top: 5px;">Widerspruch eingereicht</p>'}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;

      authManager.showModal(content);

      // Event Listeners für Widerspruch
      document.querySelectorAll('[data-action="appeal"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reportId = btn.dataset.reportId;
          await this.appealReport(reportId);
        });
      });

    } catch (error) {
      console.error('Fehler beim Laden der Meldungen:', error);
      authManager.showToast('Laden fehlgeschlagen', 'error');
    }
  }

  async appealReport(reportId) {
    const reason = prompt('Grund für den Widerspruch:');
    if (!reason) return;

    try {
      await supabase
        .from('reports')
        .update({
          appealed: true,
          appeal_reason: reason,
          status: 'pending'
        })
        .eq('id', reportId);

      await supabase
        .from('moderation_queue')
        .insert({
          type: 'appeal',
          report_id: reportId,
          priority: 'high'
        });

      authManager.showToast('Widerspruch eingereicht', 'success');
      document.getElementById('modal-overlay').classList.remove('show');

    } catch (error) {
      console.error('Fehler beim Einreichen:', error);
      authManager.showToast('Fehler beim Einreichen', 'error');
    }
  }

  async changePassword() {
    const newPassword = prompt('Neues Passwort (min. 8 Zeichen):');
    if (!newPassword || newPassword.length < 8) {
      authManager.showToast('Passwort zu kurz', 'error');
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      authManager.showToast('Passwort geändert', 'success');
      document.getElementById('modal-overlay').classList.remove('show');

    } catch (error) {
      console.error('Fehler:', error);
      authManager.showToast('Fehler beim Ändern', 'error');
    }
  }

  async deleteAccount() {
    const confirmed = confirm(
      'Möchtest du deinen Account wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden!'
    );

    if (!confirmed) return;

    try {
      await supabase
        .from('users')
        .update({ account_status: 'deleted' })
        .eq('id', this.currentUser.id);

      await supabase.auth.signOut();

      authManager.showToast('Account gelöscht', 'success');

    } catch (error) {
      console.error('Fehler beim Löschen:', error);
      authManager.showToast('Fehler beim Löschen', 'error');
    }
  }

  showFilters() {
    const hasLocation = this.currentUser.latitude && this.currentUser.longitude;

    const content = `
      <h2>Filter</h2>
      <form id="filter-form">
        <label style="display: block; margin: 15px 0 5px; font-size: 14px;">Alter:</label>
        <div style="display: flex; gap: 10px;">
          <input type="number" id="filter-age-min" placeholder="Von" min="14" max="99" 
                 style="flex: 1; padding: 10px; background: var(--surface-light); border: 2px solid var(--border); border-radius: 8px; color: var(--text);">
          <input type="number" id="filter-age-max" placeholder="Bis" min="14" max="99" 
                 style="flex: 1; padding: 10px; background: var(--surface-light); border: 2px solid var(--border); border-radius: 8px; color: var(--text);">
        </div>

        <label style="display: block; margin: 15px 0 5px; font-size: 14px;">Region:</label>
        <input type="text" id="filter-region" placeholder="z.B. Bayern" 
               style="width: 100%; padding: 10px; background: var(--surface-light); border: 2px solid var(--border); border-radius: 8px; color: var(--text);">

        ${hasLocation ? `
          <label style="display: block; margin: 15px 0 5px; font-size: 14px;">
            Maximale Entfernung: <span id="distance-value">${this.currentUser.max_distance || 100}</span> km
          </label>
          <input type="range" id="filter-distance" min="10" max="500" step="10" 
                 value="${this.currentUser.max_distance || 100}"
                 style="width: 100%; accent-color: var(--primary);"
                 oninput="document.getElementById('distance-value').textContent = this.value">
        ` : `
          <p style="color: var(--text-secondary); font-size: 13px; margin-top: 15px; padding: 10px; background: var(--surface-light); border-radius: 8px;">
            💡 Gib eine Stadt an, um nach Entfernung zu filtern!
          </p>
        `}

        <label class="toggle-label" style="margin-top: 15px;">
          <span>Nur online</span>
          <input type="checkbox" id="filter-online">
        </label>

        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button type="submit" class="btn-primary" style="flex: 1;">Anwenden</button>
          <button type="button" class="btn-secondary" data-action="reset">Zurücksetzen</button>
        </div>
      </form>
    `;

    authManager.showModal(content);

    document.getElementById('filter-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.applyFilters();
      document.getElementById('modal-overlay').classList.remove('show');
    });

    document.querySelector('[data-action="reset"]').addEventListener('click', async () => {
      this.users = [...this.allUsers];
      this.renderDiscoverUsers();
      document.getElementById('modal-overlay').classList.remove('show');
    });
  }

  async applyFilters() {
    const ageMin = parseInt(document.getElementById('filter-age-min').value) || 14;
    const ageMax = parseInt(document.getElementById('filter-age-max').value) || 99;
    const region = document.getElementById('filter-region').value.trim();
    const onlineOnly = document.getElementById('filter-online').checked;
    const maxDistance = document.getElementById('filter-distance')?.value 
      ? parseInt(document.getElementById('filter-distance').value) 
      : null;

    // Filtere Users
    let filteredUsers = [...this.allUsers];

    // Alter
    filteredUsers = filteredUsers.filter(user => {
      const age = authManager.calculateAge(user.geburtsdatum);
      return age >= ageMin && age <= ageMax;
    });

    // Region
    if (region) {
      filteredUsers = filteredUsers.filter(user => 
        user.region.toLowerCase().includes(region.toLowerCase())
      );
    }

    // Online
    if (onlineOnly) {
      filteredUsers = filteredUsers.filter(user => 
        user.online_status && typeof chatManager !== 'undefined' && chatManager.isRecentlyActive(user.zuletzt_online)
      );
    }

    // Entfernung
    if (maxDistance && this.currentUser.latitude && this.currentUser.longitude && typeof calculateDistance === 'function') {
      filteredUsers = filteredUsers.filter(user => {
        if (!user.latitude || !user.longitude) return false;
        
        const distance = calculateDistance(
          this.currentUser.latitude,
          this.currentUser.longitude,
          user.latitude,
          user.longitude
        );
        
        return distance <= maxDistance;
      });

      // Sortiere nach Entfernung
      filteredUsers.sort((a, b) => {
        const distA = calculateDistance(
          this.currentUser.latitude,
          this.currentUser.longitude,
          a.latitude,
          a.longitude
        );
        const distB = calculateDistance(
          this.currentUser.latitude,
          this.currentUser.longitude,
          b.latitude,
          b.longitude
        );
        return distA - distB;
      });
    }

    this.users = filteredUsers;
    this.renderDiscoverUsers();

    // Speichere max_distance
    if (maxDistance) {
      await supabase
        .from('users')
        .update({ max_distance: maxDistance })
        .eq('id', this.currentUser.id);
    }

    authManager.showToast(`${filteredUsers.length} Nutzer gefunden`, 'success');
  }

  subscribeToNotifications() {
    supabase
      .channel('user_notifications')
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${this.currentUser.id}`
        },
        (payload) => {
          this.showAppNotification(payload.new);
        }
      )
      .subscribe();
  }

  showAppNotification(notification) {
    authManager.showToast(
      `${notification.title}: ${notification.message}`,
      notification.type === 'ban' || notification.type === 'warning' ? 'error' : 'info'
    );

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.message,
        icon: '/images/icon-192.png'
      });
    }
  }

  async logout() {
    await supabase.auth.signOut();
  }

  cleanup() {
    this.currentUser = null;
    this.users = [];
    this.allUsers = [];
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then(registration => {
          console.log('Service Worker registriert:', registration);
        })
        .catch(error => {
          console.error('Service Worker Fehler:', error);
        });
    }
  }

  requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
}

// Init App
window.app = new App();
