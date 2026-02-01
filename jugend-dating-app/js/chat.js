// ==================== CHAT SYSTEM ====================

class ChatManager {
  constructor() {
    this.currentChatId = null;
    this.currentPartnerId = null;
    this.messages = [];
    this.typingTimeout = null;
    this.subscription = null;
    this.init();
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Zurück-Button
    document.getElementById('back-to-chats').addEventListener('click', () => {
      this.closeChat();
    });

    // Nachricht senden
    document.getElementById('message-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.sendMessage();
    });

    // Typing Indicator
    const messageInput = document.getElementById('message-input');
    messageInput.addEventListener('input', () => {
      this.handleTyping();
    });

    // Chat-Menü
    document.getElementById('chat-menu-btn').addEventListener('click', () => {
      this.showChatMenu();
    });
  }

  async loadChats(userId) {
    try {
      // Lade alle Chats
      const { data: chats, error } = await supabase
        .from('chats')
        .select(`
          *,
          user1:users!chats_user1_id_fkey(id, username, profilbild_url, online_status, zuletzt_online),
          user2:users!chats_user2_id_fkey(id, username, profilbild_url, online_status, zuletzt_online)
        `)
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      this.renderChatList(chats, userId);

      // Abonniere Echtzeit-Updates
      this.subscribeToChats(userId);

    } catch (error) {
      console.error('Fehler beim Laden der Chats:', error);
    }
  }

  renderChatList(chats, currentUserId) {
    const chatList = document.getElementById('chat-list');
    
    if (chats.length === 0) {
      chatList.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; color: var(--text-secondary);">
          <p style="font-size: 48px; margin-bottom: 10px;">💬</p>
          <p>Noch keine Chats</p>
          <p style="font-size: 14px; margin-top: 10px;">Entdecke neue Leute im "Entdecken"-Tab!</p>
        </div>
      `;
      return;
    }

    chatList.innerHTML = chats.map(chat => {
      // Bestimme Chat-Partner
      const partner = chat.user1_id === currentUserId ? chat.user2 : chat.user1;
      
      // Ungelesene Nachrichten
      const unreadCount = chat.user1_id === currentUserId 
        ? chat.unread_user1 
        : chat.unread_user2;

      // Online-Status
      const isOnline = partner.online_status && this.isRecentlyActive(partner.zuletzt_online);

      return `
        <div class="chat-item" data-chat-id="${chat.id}" data-partner-id="${partner.id}">
          <img src="${partner.profilbild_url || '/images/default-avatar.png'}" 
               alt="${partner.username}" 
               class="chat-item-img">
          <div class="chat-item-content">
            <div class="chat-item-header">
              <span class="chat-item-name">
                ${isOnline ? '<span class="user-card-online"></span>' : ''}
                ${partner.username}
              </span>
              <span class="chat-item-time">${this.formatTime(chat.updated_at)}</span>
            </div>
            <div class="chat-item-preview">
              ${chat.last_message || 'Keine Nachrichten'}
            </div>
          </div>
          ${unreadCount > 0 ? `<span class="chat-item-unread">${unreadCount}</span>` : ''}
        </div>
      `;
    }).join('');

    // Event Listeners für Chat-Items
    chatList.querySelectorAll('.chat-item').forEach(item => {
      item.addEventListener('click', () => {
        const chatId = item.dataset.chatId;
        const partnerId = item.dataset.partnerId;
        this.openChat(chatId, partnerId);
      });
    });

    // Update Badge
    const totalUnread = chats.reduce((sum, chat) => {
      const unread = chat.user1_id === currentUserId 
        ? chat.unread_user1 
        : chat.unread_user2;
      return sum + unread;
    }, 0);

    const badge = document.getElementById('chat-badge');
    if (totalUnread > 0) {
      badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }

  subscribeToChats(userId) {
    // Abonniere neue Nachrichten
    supabase
      .channel('messages')
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages',
          filter: `empfaenger_id=eq.${userId}`
        },
        (payload) => {
          this.handleNewMessage(payload.new);
        }
      )
      .subscribe();
  }

  async handleNewMessage(message) {
    // Update Chat-Liste
    await this.loadChats(authManager.currentUser.id);

    // Wenn Chat offen ist, Nachricht hinzufügen
    if (this.currentChatId === message.chat_id) {
      this.renderMessage(message);
      await this.markAsRead(message.id);
    } else {
      // Zeige Benachrichtigung
      this.showNotification(message);
    }

    // Spiele Sound ab
    this.playNotificationSound();
  }

  async openChat(chatId, partnerId) {
    this.currentChatId = chatId;
    this.currentPartnerId = partnerId;

    // Zeige Chat-Screen
    document.getElementById('main-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');

    // Lade Partner-Infos
    const { data: partner, error } = await supabase
      .from('users')
      .select('username, profilbild_url, online_status, zuletzt_online, gelesen_status, schreibstatus')
      .eq('id', partnerId)
      .single();

    if (error) {
      console.error('Partner-Infos nicht geladen:', error);
      return;
    }

    // Update Header
    document.getElementById('chat-partner-name').textContent = partner.username;
    const statusEl = document.getElementById('chat-partner-status');
    
    if (partner.online_status && this.isRecentlyActive(partner.zuletzt_online)) {
      statusEl.textContent = 'online';
      statusEl.classList.add('online');
    } else {
      statusEl.textContent = `zuletzt online: ${this.formatTime(partner.zuletzt_online)}`;
      statusEl.classList.remove('online');
    }

    // Lade Nachrichten
    await this.loadMessages(chatId);

    // Markiere als gelesen
    await this.markChatAsRead(chatId);

    // Abonniere Echtzeit-Nachrichten
    this.subscribeToMessages(chatId);

    // Abonniere Typing-Status
    if (partner.schreibstatus) {
      this.subscribeToTyping(chatId);
    }
  }

  async loadMessages(chatId) {
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      this.messages = messages;
      this.renderMessages();

    } catch (error) {
      console.error('Fehler beim Laden der Nachrichten:', error);
    }
  }

  renderMessages() {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';

    this.messages.forEach(message => {
      this.renderMessage(message);
    });

    // Scrolle nach unten
    container.scrollTop = container.scrollHeight;
  }

  renderMessage(message) {
    const container = document.getElementById('messages-container');
    const isSent = message.sender_id === authManager.currentUser.id;

    const messageEl = document.createElement('div');
    messageEl.className = `message ${isSent ? 'sent' : 'received'} ${message.deleted ? 'deleted' : ''}`;
    messageEl.dataset.messageId = message.id;

    const content = message.deleted 
      ? '🚫 Diese Nachricht wurde gelöscht'
      : message.content;

    const status = isSent && !message.deleted
      ? `<span class="message-status">${message.gelesen ? '✓✓' : '✓'}</span>`
      : '';

    messageEl.innerHTML = `
      ${content}
      <span class="message-time">
        ${this.formatTime(message.created_at)}
        ${status}
      </span>
    `;

    // Langes Drücken für Optionen
    if (!message.deleted) {
      let pressTimer;
      messageEl.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
          this.showMessageOptions(message);
        }, 500);
      });
      messageEl.addEventListener('touchend', () => {
        clearTimeout(pressTimer);
      });
    }

    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
  }

  async sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();

    if (!content) return;

    // Prüfe ob User verifiziert ist
    if (!authManager.currentUser.verified_parent) {
      authManager.showToast('Du musst erst von deinen Eltern verifiziert werden!', 'error');
      return;
    }

    // Moderation
    const moderationResult = await moderationManager.checkMessage(content, authManager.currentUser.id);

    if (moderationResult.action === 'block') {
      authManager.showToast('Diese Nachricht verstößt gegen unsere Regeln.', 'error');
      
      // Verwarnung hinzufügen
      await this.addStrike(authManager.currentUser.id, moderationResult.reason);
      return;
    }

    if (moderationResult.action === 'warn') {
      authManager.showToast('⚠️ Achtung: ' + moderationResult.reason, 'warning');
    }

    try {
      // Sende Nachricht
      const { data, error } = await supabase
        .from('messages')
        .insert({
          chat_id: this.currentChatId,
          sender_id: authManager.currentUser.id,
          empfaenger_id: this.currentPartnerId,
          content: content,
          moderation_score: moderationResult.score,
          moderation_classification: moderationResult.classification
        })
        .select()
        .single();

      if (error) throw error;

      // Update Chat
      await supabase
        .from('chats')
        .update({
          last_message: content.substring(0, 50),
          updated_at: new Date().toISOString(),
          unread_user2: supabase.rpc('increment', { row_id: this.currentChatId })
        })
        .eq('id', this.currentChatId);

      // Render Nachricht
      this.renderMessage(data);

      // Clear Input
      input.value = '';

      // Stop Typing
      this.stopTyping();

    } catch (error) {
      console.error('Fehler beim Senden:', error);
      authManager.showToast('Nachricht konnte nicht gesendet werden.', 'error');
    }
  }

  async markChatAsRead(chatId) {
    const field = `unread_user${authManager.currentUser.id === this.currentChatId ? '1' : '2'}`;
    
    await supabase
      .from('chats')
      .update({ [field]: 0 })
      .eq('id', chatId);
  }

  async markAsRead(messageId) {
    await supabase
      .from('messages')
      .update({ gelesen: true })
      .eq('id', messageId);

    // Update UI
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageEl) {
      const status = messageEl.querySelector('.message-status');
      if (status) status.textContent = '✓✓';
    }
  }

  handleTyping() {
    // Prüfe Einstellung
    if (!authManager.currentUser.schreibstatus) return;

    // Sende Typing-Status
    this.sendTypingStatus(true);

    // Clear vorheriges Timeout
    clearTimeout(this.typingTimeout);

    // Setze neues Timeout
    this.typingTimeout = setTimeout(() => {
      this.sendTypingStatus(false);
    }, 3000);
  }

  async sendTypingStatus(isTyping) {
    await supabase
      .from('typing_status')
      .upsert({
        chat_id: this.currentChatId,
        user_id: authManager.currentUser.id,
        is_typing: isTyping,
        updated_at: new Date().toISOString()
      });
  }

  stopTyping() {
    clearTimeout(this.typingTimeout);
    this.sendTypingStatus(false);
  }

  subscribeToMessages(chatId) {
    // Cleanup alte Subscription
    if (this.subscription) {
      supabase.removeChannel(this.subscription);
    }

    // Neue Subscription
    this.subscription = supabase
      .channel(`chat:${chatId}`)
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`
        },
        (payload) => {
          if (payload.new.sender_id !== authManager.currentUser.id) {
            this.renderMessage(payload.new);
            this.markAsRead(payload.new.id);
          }
        }
      )
      .subscribe();
  }

  subscribeToTyping(chatId) {
    supabase
      .channel(`typing:${chatId}`)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'typing_status',
          filter: `chat_id=eq.${chatId}`
        },
        (payload) => {
          if (payload.new.user_id !== authManager.currentUser.id) {
            this.showTypingIndicator(payload.new.is_typing);
          }
        }
      )
      .subscribe();
  }

  showTypingIndicator(isTyping) {
    const indicator = document.getElementById('typing-indicator');
    indicator.style.display = isTyping ? 'flex' : 'none';
  }

  closeChat() {
    // Cleanup
    this.stopTyping();
    if (this.subscription) {
      supabase.removeChannel(this.subscription);
    }

    this.currentChatId = null;
    this.currentPartnerId = null;
    this.messages = [];

    // Zurück zu Main
    document.getElementById('chat-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');

    // Reload Chats
    this.loadChats(authManager.currentUser.id);
  }

  showMessageOptions(message) {
    const isMine = message.sender_id === authManager.currentUser.id;

    const options = isMine
      ? ['Nachricht löschen']
      : ['Nachricht melden', 'Nutzer blockieren'];

    const content = `
      <h3>Nachricht-Optionen</h3>
      <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px;">
        ${options.map(opt => `
          <button class="btn-secondary" data-action="${opt}">${opt}</button>
        `).join('')}
      </div>
    `;

    authManager.showModal(content);

    // Event Listeners
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        
        if (action === 'Nachricht löschen') {
          await this.deleteMessage(message.id);
        } else if (action === 'Nachricht melden') {
          this.reportMessage(message);
        } else if (action === 'Nutzer blockieren') {
          await this.blockUser(message.sender_id);
        }

        document.getElementById('modal-overlay').classList.remove('show');
      });
    });
  }

  async deleteMessage(messageId) {
    await supabase
      .from('messages')
      .update({ deleted: true })
      .eq('id', messageId);

    // Update UI
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageEl) {
      messageEl.classList.add('deleted');
      messageEl.querySelector('.message-time').previousSibling.textContent = '🚫 Diese Nachricht wurde gelöscht';
    }

    authManager.showToast('Nachricht gelöscht', 'success');
  }

  reportMessage(message) {
    const content = `
      <h3>Nachricht melden</h3>
      <p style="color: var(--text-secondary); margin: 15px 0;">
        "${message.content}"
      </p>
      <form id="report-form">
        <label style="display: block; margin-bottom: 10px; font-size: 14px;">
          Grund der Meldung:
        </label>
        <select id="report-reason" style="width: 100%; padding: 12px; background: var(--surface-light); border: 2px solid var(--border); border-radius: 10px; color: var(--text); margin-bottom: 15px;">
          <option value="grooming">Grooming / Belästigung</option>
          <option value="sexual">Sexuelle Inhalte</option>
          <option value="violence">Gewalt / Drohung</option>
          <option value="drugs">Drogen</option>
          <option value="personal_data">Persönliche Daten</option>
          <option value="spam">Spam</option>
          <option value="other">Sonstiges</option>
        </select>
        <textarea id="report-details" placeholder="Weitere Details (optional)" style="width: 100%; padding: 12px; background: var(--surface-light); border: 2px solid var(--border); border-radius: 10px; color: var(--text); resize: none; font-family: inherit;" rows="4"></textarea>
        <button type="submit" class="btn-primary" style="width: 100%; margin-top: 15px;">Meldung absenden</button>
      </form>
    `;

    authManager.showModal(content);

    document.getElementById('report-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const reason = document.getElementById('report-reason').value;
      const details = document.getElementById('report-details').value;

      await this.submitReport(message, reason, details);
      
      document.getElementById('modal-overlay').classList.remove('show');
    });
  }

  async submitReport(message, reason, details) {
    try {
      const { data, error } = await supabase
        .from('reports')
        .insert({
          reporter_id: authManager.currentUser.id,
          reported_user_id: message.sender_id,
          message_id: message.id,
          chat_id: message.chat_id,
          reason: reason,
          details: details,
          status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;

      authManager.showToast('Meldung wurde eingereicht. Wir prüfen das.', 'success');

      // Benachrichtige Reporter
      await this.notifyReporter(data.id, authManager.currentUser.id);

    } catch (error) {
      console.error('Fehler beim Melden:', error);
      authManager.showToast('Meldung fehlgeschlagen', 'error');
    }
  }

  async notifyReporter(reportId, reporterId) {
    await supabase
      .from('notifications')
      .insert({
        user_id: reporterId,
        type: 'report_received',
        title: 'Meldung eingegangen',
        message: 'Deine Meldung wird geprüft. Du wirst benachrichtigt, sobald eine Entscheidung getroffen wurde.',
        data: { report_id: reportId }
      });
  }

  async blockUser(userId) {
    await supabase
      .from('blocks')
      .insert({
        blocker_id: authManager.currentUser.id,
        blocked_id: userId
      });

    authManager.showToast('Nutzer blockiert', 'success');
    this.closeChat();
  }

  async addStrike(userId, reason) {
    // Erhöhe Strikes
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
        action: 'strike',
        reason: reason,
        moderator_id: null, // Auto-Moderation
        strikes_after: newStrikes
      });

    // Benachrichtige User
    await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type: 'warning',
        title: 'Verwarnung',
        message: `Du hast eine Verwarnung erhalten: ${reason}`,
        data: { strikes: newStrikes }
      });

    // Auto-Sanktionen
    if (newStrikes >= 3) {
      await this.restrictUser(userId, 'Zu viele Verwarnungen');
    }
    if (newStrikes >= 5) {
      await this.banUser(userId, 'Zu viele Verwarnungen');
    }
  }

  async restrictUser(userId, reason) {
    await supabase
      .from('users')
      .update({ account_status: 'restricted' })
      .eq('id', userId);

    await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type: 'restriction',
        title: 'Account eingeschränkt',
        message: `Dein Account wurde eingeschränkt: ${reason}`,
        data: {}
      });
  }

  async banUser(userId, reason) {
    await supabase
      .from('users')
      .update({ 
        account_status: 'banned',
        ban_reason: reason
      })
      .eq('id', userId);

    await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type: 'ban',
        title: 'Account gesperrt',
        message: `Dein Account wurde gesperrt: ${reason}`,
        data: {}
      });
  }

  showNotification(message) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Neue Nachricht', {
        body: message.content.substring(0, 50),
        icon: '/images/icon-192.png'
      });
    }
  }

  playNotificationSound() {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuFze/aiTYIGGS56+OVRwsQUKXp8LJnHgU7kdT1z3QmBSl8y/P'); audio.play().catch(() => {});
  }

  showChatMenu() {
    const content = `
      <h3>Chat-Einstellungen</h3>
      <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px;">
        <button class="btn-secondary" data-action="block">Nutzer blockieren</button>
        <button class="btn-secondary" data-action="report">Nutzer melden</button>
        <button class="btn-secondary" data-action="delete">Chat löschen</button>
      </div>
    `;

    authManager.showModal(content);

    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        
        if (action === 'block') {
          await this.blockUser(this.currentPartnerId);
        } else if (action === 'report') {
          this.reportUser(this.currentPartnerId);
        } else if (action === 'delete') {
          await this.deleteChat(this.currentChatId);
        }

        document.getElementById('modal-overlay').classList.remove('show');
      });
    });
  }

  reportUser(userId) {
    const content = `
      <h3>Nutzer melden</h3>
      <form id="report-user-form">
        <label style="display: block; margin-bottom: 10px; font-size: 14px;">
          Grund der Meldung:
        </label>
        <select id="report-user-reason" style="width: 100%; padding: 12px; background: var(--surface-light); border: 2px solid var(--border); border-radius: 10px; color: var(--text); margin-bottom: 15px;">
          <option value="grooming">Grooming / Belästigung</option>
          <option value="fake_profile">Fake-Profil</option>
          <option value="inappropriate">Unangemessenes Verhalten</option>
          <option value="spam">Spam</option>
          <option value="underage">Minderjährig</option>
          <option value="other">Sonstiges</option>
        </select>
        <textarea id="report-user-details" placeholder="Details (optional)" style="width: 100%; padding: 12px; background: var(--surface-light); border: 2px solid var(--border); border-radius: 10px; color: var(--text); resize: none; font-family: inherit;" rows="4"></textarea>
        <button type="submit" class="btn-primary" style="width: 100%; margin-top: 15px;">Meldung absenden</button>
      </form>
    `;

    authManager.showModal(content);

    document.getElementById('report-user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const reason = document.getElementById('report-user-reason').value;
      const details = document.getElementById('report-user-details').value;

      await supabase
        .from('reports')
        .insert({
          reporter_id: authManager.currentUser.id,
          reported_user_id: userId,
          chat_id: this.currentChatId,
          reason: reason,
          details: details,
          status: 'pending'
        });

      authManager.showToast('Nutzer gemeldet', 'success');
      document.getElementById('modal-overlay').classList.remove('show');
    });
  }

  async deleteChat(chatId) {
    await supabase
      .from('chats')
      .delete()
      .eq('id', chatId);

    authManager.showToast('Chat gelöscht', 'success');
    this.closeChat();
  }

  isRecentlyActive(timestamp) {
    if (!timestamp) return false;
    const now = new Date();
    const lastActive = new Date(timestamp);
    const diffMinutes = (now - lastActive) / 1000 / 60;
    return diffMinutes < 5; // Online wenn < 5 Minuten
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
    
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }
}

// Init
const chatManager = new ChatManager();
