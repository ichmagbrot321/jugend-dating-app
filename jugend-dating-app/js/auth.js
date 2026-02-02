// ==================== AUTH SYSTEM - FIXED ====================

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.init();
  }

  async init() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        await this.handleAuthSuccess(session.user);
      } else {
        this.showScreen('auth-screen');
      }

      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          await this.handleAuthSuccess(session.user);
        } else if (event === 'SIGNED_OUT') {
          this.handleLogout();
        }
      });

      this.setupEventListeners();
    } catch (error) {
      console.error('Init error:', error);
      this.showScreen('auth-screen');
    }
  }

  setupEventListeners() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        
        e.target.classList.add('active');
        const formId = e.target.dataset.tab + '-form';
        document.getElementById(formId).classList.add('active');
      });
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleLogin();
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleRegister();
    });

    document.getElementById('reg-birthdate').addEventListener('change', (e) => {
      const age = this.calculateAge(e.target.value);
      const parentSection = document.getElementById('parent-email-section');
      const parentEmail = document.getElementById('reg-parent-email');
      
      if (age < APP_CONFIG.parentVerificationAge) {
        parentSection.style.display = 'block';
        parentEmail.required = true;
      } else {
        parentSection.style.display = 'none';
        parentEmail.required = false;
      }
    });

    document.getElementById('show-agb')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showAGB();
    });

    document.getElementById('show-privacy')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showPrivacy();
    });

    document.getElementById('show-jugendschutz')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showJugendschutz();
    });
  }

  async handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
      this.showError('Bitte fülle alle Felder aus');
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      // Prüfe ob User-Profil existiert
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user.id);

      if (userError) throw userError;

      if (!users || users.length === 0) {
        await supabase.auth.signOut();
        this.showError('Profil nicht gefunden. Bitte registriere dich erneut.');
        return;
      }

      const userData = users[0]; // Nehme ersten User

      if (userData.account_status === 'banned') {
        await supabase.auth.signOut();
        this.showError(`Account gesperrt: ${userData.ban_reason}`);
        return;
      }

      if (userData.account_status === 'restricted') {
        this.showToast('Dein Account ist eingeschränkt.', 'warning');
      }

      // Login erfolgreich - handleAuthSuccess wird von onAuthStateChange getriggert

    } catch (error) {
      console.error('Login error:', error);
      this.showError('Login fehlgeschlagen: ' + (error.message || 'Unbekannter Fehler'));
    }
  }

  async handleRegister() {
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const birthdate = document.getElementById('reg-birthdate').value;
    const parentEmail = document.getElementById('reg-parent-email').value.trim();
    const region = document.getElementById('reg-region').value.trim();
    const city = document.getElementById('reg-city').value.trim();
    const interests = document.getElementById('reg-interests').value.trim();

    try {
      // Validierung
      const age = this.calculateAge(birthdate);
      
      if (age < APP_CONFIG.minAge) {
        this.showError(`Du musst mindestens ${APP_CONFIG.minAge} Jahre alt sein.`);
        return;
      }

      if (age < APP_CONFIG.parentVerificationAge && !parentEmail) {
        this.showError('Bitte gib die E-Mail-Adresse eines Elternteils an.');
        return;
      }

      // Username-Prüfung
      const { data: existingUsers } = await supabase
        .from('users')
        .select('username')
        .eq('username', username);

      if (existingUsers && existingUsers.length > 0) {
        this.showError('Benutzername bereits vergeben.');
        return;
      }

      // Geo-Coding (optional)
      let coordinates = null;
      if (city && typeof getCityCoordinates === 'function') {
        try {
          coordinates = await getCityCoordinates(city, region);
        } catch (e) {
          console.warn('Geocoding failed:', e);
        }
      }

      // Account erstellen
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            username,
            birthdate,
            parent_email: parentEmail || null,
            region,
            city: city || null,
            interests
          }
        }
      });

      if (authError) throw authError;

      if (!authData.user) {
        throw new Error('Registrierung fehlgeschlagen');
      }

      // Warte kurz (wichtig für Supabase Auth)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // User-Profil erstellen
      const needsParentVerification = age < APP_CONFIG.parentVerificationAge;
      
      let role = 'user';
      if (email === OWNER_EMAIL) {
        role = 'owner';
      }

      const { error: profileError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          username,
          geburtsdatum: birthdate,
          eltern_email: parentEmail || null,
          verified_parent: !needsParentVerification,
          region,
          stadt: city || null,
          latitude: coordinates?.lat || null,
          longitude: coordinates?.lon || null,
          interessen: interests,
          role: role,
          account_status: 'active',
          last_ip: null,
          vpn_detected: false
        });

      if (profileError) {
        console.error('Profile creation error:', profileError);
        // Versuche User zu löschen wenn Profil-Erstellung fehlschlägt
        await supabase.auth.admin.deleteUser(authData.user.id);
        throw new Error('Profil konnte nicht erstellt werden: ' + profileError.message);
      }

      // Erfolg
      this.showToast('Registrierung erfolgreich! Bitte prüfe deine E-Mails.', 'success');
      
      // Wechsel zu Login
      document.querySelector('.tab[data-tab="login"]').click();
      document.getElementById('register-form').reset();

    } catch (error) {
      console.error('Registration error:', error);
      this.showError('Registrierung fehlgeschlagen: ' + (error.message || 'Unbekannter Fehler'));
    }
  }

  async handleAuthSuccess(user) {
    try {
      // Hole User-Daten (OHNE .single()!)
      const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id);

      if (error) {
        console.error('User data error:', error);
        await supabase.auth.signOut();
        this.showError('Fehler beim Laden des Profils');
        return;
      }

      if (!users || users.length === 0) {
        console.error('No user profile found');
        await supabase.auth.signOut();
        this.showError('Profil nicht gefunden. Bitte kontaktiere den Support.');
        return;
      }

      const userData = users[0];
      this.currentUser = userData;

      // Update last_active
      await supabase
        .from('users')
        .update({
          last_active_at: new Date().toISOString()
        })
        .eq('id', user.id);

      this.showScreen('main-screen');
      
      if (typeof window.app !== 'undefined') {
        window.app.init(this.currentUser);
      }

    } catch (error) {
      console.error('Auth success handler error:', error);
      this.showError('Fehler beim Login');
    }
  }

  handleLogout() {
    this.currentUser = null;
    this.showScreen('auth-screen');
    
    if (typeof window.app !== 'undefined') {
      window.app.cleanup();
    }
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

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(screenId);
    if (screen) {
      screen.classList.add('active');
    }
  }

  showError(message) {
    const errorEl = document.getElementById('auth-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.add('show');
      
      setTimeout(() => {
        errorEl.classList.remove('show');
      }, 5000);
    }
    console.error('Auth Error:', message);
  }

  showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.className = `toast show ${type}`;
      
      setTimeout(() => {
        toast.classList.remove('show');
      }, 4000);
    }
  }

  showAGB() {
    const content = `
      <h2>Allgemeine Geschäftsbedingungen</h2>
      <p><strong>Stand: Februar 2026</strong></p>
      
      <h3>1. Geltungsbereich</h3>
      <p>Diese AGB gelten für die Nutzung von TeenConnect, einer Dating- und Chat-Plattform für Jugendliche ab 14 Jahren.</p>
      
      <h3>2. Registrierung und Nutzerkonto</h3>
      <p>2.1 Die Registrierung ist kostenlos und erfordert die Angabe wahrheitsgemäßer Daten.</p>
      <p>2.2 Nutzer unter 16 Jahren benötigen die Zustimmung ihrer Erziehungsberechtigten.</p>
      <p>2.3 Pro Person ist nur ein Account erlaubt.</p>
      
      <h3>3. Nutzungspflichten</h3>
      <p>3.1 Nutzer verpflichten sich zu respektvollem Umgang.</p>
      <p>3.2 Verboten sind: sexuelle Inhalte, Belästigung, Gewaltdarstellungen, Drogen-Bezug.</p>
      <p>3.3 Die Weitergabe persönlicher Kontaktdaten ist untersagt.</p>
      
      <h3>4. Moderation</h3>
      <p>4.1 Die Plattform setzt automatisierte Moderation ein.</p>
      <p>4.2 Bei Verstößen können Verwarnungen, Einschränkungen oder Sperren erfolgen.</p>
      <p>4.3 Meldungen werden bearbeitet, aber eine sofortige Reaktion kann nicht garantiert werden.</p>
      
      <h3>5. Haftungsausschluss</h3>
      <p>5.1 Die Plattform übernimmt keine Haftung für Nutzerverhalten.</p>
      <p>5.2 Eltern sind für die Aufsicht ihrer Kinder verantwortlich.</p>
      <p>5.3 Die Nutzung erfolgt auf eigene Verantwortung.</p>
      
      <h3>6. Beendigung</h3>
      <p>6.1 Accounts können jederzeit gelöscht werden.</p>
      <p>6.2 Bei schweren Verstößen behält sich die Plattform permanente Sperrungen vor.</p>
    `;
    this.showModal(content);
  }

  showPrivacy() {
    const content = `
      <h2>Datenschutzerklärung</h2>
      <p><strong>Stand: Februar 2026</strong></p>
      
      <h3>1. Verantwortlicher</h3>
      <p>TeenConnect<br>E-Mail: datenschutz@teenconnect.de</p>
      
      <h3>2. Erhobene Daten</h3>
      <p>2.1 Registrierungsdaten: E-Mail, Benutzername, Geburtsdatum, Region</p>
      <p>2.2 Profilbild (verpflichtend)</p>
      <p>2.3 Chat-Nachrichten (verschlüsselt gespeichert)</p>
      <p>2.4 Nutzungsdaten: Online-Status, letzte Aktivität</p>
      
      <h3>3. Zweck der Datenverarbeitung</h3>
      <p>3.1 Bereitstellung der Plattform</p>
      <p>3.2 Sicherheit und Jugendschutz</p>
      <p>3.3 Moderation und Verhinderung von Missbrauch</p>
      
      <h3>4. Ihre Rechte</h3>
      <p>4.1 Auskunft, Berichtigung, Löschung</p>
      <p>4.2 Einschränkung der Verarbeitung</p>
      <p>4.3 Datenübertragbarkeit</p>
      <p>4.4 Widerspruch und Beschwerde bei Aufsichtsbehörde</p>
    `;
    this.showModal(content);
  }

  showJugendschutz() {
    const content = `
      <h2>Jugendschutzhinweise</h2>
      
      <h3>⚠️ Wichtige Sicherheitsregeln</h3>
      
      <h4>1. Persönliche Daten schützen</h4>
      <p>❌ Teile NIEMALS: Vollständigen Namen, Adresse, Telefonnummer, Schule, genauen Standort</p>
      <p>✅ Nutze nur deinen Benutzernamen und allgemeine Angaben</p>
      
      <h4>2. Treffen im echten Leben</h4>
      <p>❌ Triff dich NICHT alleine mit Personen, die du nur online kennst</p>
      <p>✅ Wenn überhaupt, nur mit Begleitung der Eltern an öffentlichen Orten</p>
      
      <h4>3. Verdächtiges Verhalten melden</h4>
      <p>🚩 Melde sofort, wenn jemand:</p>
      <ul>
        <li>Nach persönlichen Daten fragt</li>
        <li>Sexuelle Inhalte schickt oder verlangt</li>
        <li>Dich zu Geheimnissen drängt</li>
      </ul>
      
      <h4>4. Im Notfall</h4>
      <p>🚨 Bei akuter Gefahr:</p>
      <ul>
        <li>Polizei: 110</li>
        <li>Nummer gegen Kummer: 116 111</li>
      </ul>
    `;
    this.showModal(content);
  }

  showModal(content) {
    const modal = document.getElementById('modal-overlay');
    const modalContent = document.getElementById('modal-content');
    
    if (modal && modalContent) {
      modalContent.innerHTML = content;
      modal.classList.add('show');
      
      const closeBtn = modal.querySelector('.modal-close');
      if (closeBtn) {
        closeBtn.onclick = () => modal.classList.remove('show');
      }
      
      modal.onclick = (e) => {
        if (e.target === modal) {
          modal.classList.remove('show');
        }
      };
    }
  }
}

// Init
const authManager = new AuthManager();
```

---

## ✅ **PROBLEM 2: E-MAIL REDIRECT FIX**

### Supabase Dashboard - E-Mail Einstellungen ändern:

1. **Authentication** → **URL Configuration**
2. **Site URL** setzen auf:
```
   https://jugend-dating-app.vercel.app
```
   *(ersetze mit deiner echten Vercel URL)*

3. **Redirect URLs** hinzufügen:
```
   https://jugend-dating-app.vercel.app/*
   https://jugend-dating-app.vercel.app/**
   https://jugend-dating-app.vercel.app/index.html
