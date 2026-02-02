// ==================== AUTH SYSTEM ====================

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.init();
  }

  async init() {
    // Prüfe Session
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
      await this.handleAuthSuccess(session.user);
    } else {
      this.showScreen('auth-screen');
    }

    // Auth Listener
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        await this.handleAuthSuccess(session.user);
      } else if (event === 'SIGNED_OUT') {
        this.handleLogout();
      }
    });

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Tab-Switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        
        e.target.classList.add('active');
        const formId = e.target.dataset.tab + '-form';
        document.getElementById(formId).classList.add('active');
      });
    });

    // Login Form
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleLogin();
    });

    // Register Form
    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleRegister();
    });

    // Geburtsdatum Change - Eltern-Email anzeigen
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

    // AGB/Privacy Links
    document.getElementById('show-agb').addEventListener('click', (e) => {
      e.preventDefault();
      this.showAGB();
    });

    document.getElementById('show-privacy').addEventListener('click', (e) => {
      e.preventDefault();
      this.showPrivacy();
    });

    document.getElementById('show-jugendschutz').addEventListener('click', (e) => {
      e.preventDefault();
      this.showJugendschutz();
    });
  }

  async handleLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
      // VPN Check
      const vpnCheckResult = await this.checkVPN();
      if (vpnCheckResult.blocked) {
        this.showError(vpnCheckResult.message);
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      // Prüfe Account-Status
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('account_status, ban_reason')
        .eq('id', data.user.id)
        .single();

      if (userError) throw userError;

      if (userData.account_status === 'banned') {
        await supabase.auth.signOut();
        this.showError(`Account gesperrt: ${userData.ban_reason}`);
        return;
      }

      if (userData.account_status === 'restricted') {
        this.showToast('Dein Account ist eingeschränkt.', 'warning');
      }

    } catch (error) {
      this.showError(error.message);
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

      // VPN-Check
      const vpnCheckResult = await this.checkVPN();
      if (vpnCheckResult.blocked) {
        this.showError(vpnCheckResult.message);
        return;
      }

      // Username-Prüfung
      const { data: existingUser } = await supabase
        .from('users')
        .select('username')
        .eq('username', username)
        .single();

      if (existingUser) {
        this.showError('Benutzername bereits vergeben.');
        return;
      }

      // Geo-Coding (Stadt zu Koordinaten)
      let coordinates = null;
      if (city && typeof getCityCoordinates === 'function') {
        this.showToast('Koordinaten werden ermittelt...', 'info');
        coordinates = await getCityCoordinates(city, region);
        if (!coordinates) {
          console.warn('Koordinaten konnten nicht ermittelt werden');
        }
      }

      // Account erstellen
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
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

      // User-Profil erstellen
      const needsParentVerification = age < APP_CONFIG.parentVerificationAge;
      
      // Rolle festlegen (Owner-Check)
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
          last_ip: await this.getIP(),
          vpn_detected: vpnCheckResult.vpnDetected
        });

      if (profileError) throw profileError;

      // Eltern-Verifikation senden
      if (needsParentVerification && parentEmail) {
        await this.sendParentVerification(authData.user.id, parentEmail, username);
      }

      // Erfolg
      if (needsParentVerification) {
        this.showToast('Registrierung erfolgreich! Bitte warte auf die Bestätigung deiner Eltern.', 'success');
      } else {
        this.showToast('Registrierung erfolgreich! Du kannst dich jetzt einloggen.', 'success');
      }

      // Wechsel zu Login
      document.querySelector('.tab[data-tab="login"]').click();
      document.getElementById('register-form').reset();

    } catch (error) {
      this.showError(error.message);
    }
  }

  async sendParentVerification(userId, parentEmail, username) {
    try {
      // Erstelle Verifikations-Token
      const token = this.generateToken();
      
      // Speichere Token
      await supabase
        .from('parent_verifications')
        .insert({
          user_id: userId,
          parent_email: parentEmail,
          token,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 Tage
        });

      // Versuche E-Mail zu senden (Edge Function - optional)
      try {
        await supabase.functions.invoke('send-parent-verification', {
          body: {
            parentEmail,
            username,
            token
          }
        });
      } catch (emailError) {
        console.warn('E-Mail konnte nicht gesendet werden:', emailError);
        // Kein Fehler werfen - Registrierung trotzdem erfolgreich
      }
    } catch (error) {
      console.error('Fehler bei Eltern-Verifikation:', error);
      // Kein Fehler werfen - Registrierung trotzdem erfolgreich
    }
  }

  async handleAuthSuccess(user) {
    // Hole User-Daten
    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('User-Daten nicht gefunden:', error);
      return;
    }

    this.currentUser = userData;

    // Prüfe Eltern-Verifikation
    if (!userData.verified_parent) {
      this.showError('Warte auf Bestätigung durch deine Eltern. Du kannst noch nicht chatten.');
      // Zeige eingeschränktes Profil
    }

    // Prüfe Profilbild
    if (APP_CONFIG.profilePictureRequired && !userData.profilbild_url) {
      this.showToast('Bitte lade ein Profilbild hoch!', 'warning');
    }

    // Update last_active
    await supabase
      .from('users')
      .update({
        last_active_at: new Date().toISOString(),
        last_ip: await this.getIP()
      })
      .eq('id', user.id);

    // VPN-Check während Session
    if (APP_CONFIG.vpnDetectionEnabled) {
      const vpnCheckResult = await this.checkVPN();
      if (vpnCheckResult.vpnDetected) {
        await supabase
          .from('users')
          .update({ vpn_detected: true })
          .eq('id', user.id);
        
        if (vpnCheckResult.blocked) {
          await supabase.auth.signOut();
          this.showError('VPN während der Nutzung erkannt. Session beendet.');
          return;
        }
      }
    }

    this.showScreen('main-screen');
    
    // Lade App-Daten
    if (typeof window.app !== 'undefined') {
      window.app.init(this.currentUser);
    }
  }

  handleLogout() {
    this.currentUser = null;
    this.showScreen('auth-screen');
    
    if (typeof window.app !== 'undefined') {
      window.app.cleanup();
    }
  }

  async checkVPN() {
    try {
      const ip = await this.getIP();
      
      if (!ip) {
        return { 
          blocked: false, 
          vpnDetected: false, 
          message: 'IP konnte nicht ermittelt werden' 
        };
      }

      // 1. HOSTNAME & REVERSE DNS CHECK
      const ipInfoResponse = await fetch(`https://ipapi.co/${ip}/json/`);
      const ipInfo = await ipInfoResponse.json();

      // Prüfe Hostname auf VPN-Keywords
      if (ipInfo.hostname) {
        const hostname = ipInfo.hostname.toLowerCase();
        if (typeof VPN_DETECTION !== 'undefined' && VPN_DETECTION.vpnKeywords) {
          for (const keyword of VPN_DETECTION.vpnKeywords) {
            if (hostname.includes(keyword)) {
              return {
                blocked: true,
                vpnDetected: true,
                message: `VPN/Proxy erkannt (${ipInfo.hostname}). Bitte deaktiviere deinen VPN.`
              };
            }
          }
        }
      }

      // 2. ASN CHECK
      if (ipInfo.asn && typeof VPN_DETECTION !== 'undefined' && VPN_DETECTION.knownVPNASNs) {
        if (VPN_DETECTION.knownVPNASNs.includes(ipInfo.asn)) {
          return {
            blocked: true,
            vpnDetected: true,
            message: `VPN/Proxy erkannt (ASN: ${ipInfo.asn}). Bitte deaktiviere deinen VPN.`
          };
        }
      }

      // 3. ORG/ISP CHECK
      if (ipInfo.org && typeof VPN_DETECTION !== 'undefined' && VPN_DETECTION.vpnKeywords) {
        const org = ipInfo.org.toLowerCase();
        for (const keyword of VPN_DETECTION.vpnKeywords) {
          if (org.includes(keyword)) {
            return {
              blocked: true,
              vpnDetected: true,
              message: `VPN/Proxy erkannt (Provider: ${ipInfo.org}). Bitte deaktiviere deinen VPN.`
            };
          }
        }
      }

      // 4. DATACENTER CHECK
      if (ipInfo.org) {
        const datacenterKeywords = ['hosting', 'server', 'cloud', 'data center', 'datacenter'];
        const org = ipInfo.org.toLowerCase();
        
        for (const keyword of datacenterKeywords) {
          if (org.includes(keyword)) {
            return {
              blocked: true,
              vpnDetected: true,
              message: 'Datacenter-IP erkannt. Bitte nutze eine private Internet-Verbindung.'
            };
          }
        }
      }

      // 5. TOR EXIT NODE CHECK
      if (ipInfo.hostname && ipInfo.hostname.includes('tor-exit')) {
        return {
          blocked: true,
          vpnDetected: true,
          message: 'Tor-Netzwerk erkannt. Bitte deaktiviere Tor.'
        };
      }

      // 6. IP QUALITY SCORE (optional - wenn API-Key vorhanden)
      if (typeof VPN_DETECTION !== 'undefined' && VPN_DETECTION.ipQualityScore) {
        try {
          const qualityResponse = await fetch(
            `https://ipqualityscore.com/api/json/ip/${VPN_DETECTION.ipQualityScore}/${ip}?strictness=1`
          );
          const qualityData = await qualityResponse.json();
          
          if (qualityData.proxy || qualityData.vpn || qualityData.tor) {
            return {
              blocked: true,
              vpnDetected: true,
              message: 'VPN/Proxy erkannt. Bitte deaktiviere deinen VPN.'
            };
          }
        } catch (e) {
          console.warn('IP Quality Score Check fehlgeschlagen:', e);
        }
      }

      // Kein VPN erkannt
      return { 
        blocked: false, 
        vpnDetected: false, 
        message: 'OK' 
      };

    } catch (error) {
      console.error('VPN-Check fehlgeschlagen:', error);
      // Bei Fehler NICHT blockieren (False Negative besser als False Positive)
      return { 
        blocked: false, 
        vpnDetected: false, 
        message: 'Check fehlgeschlagen' 
      };
    }
  }

  async getIP() {
    try {
      // Nutze mehrere Services als Fallback
      const services = [
        'https://api.ipify.org?format=json',
        'https://ipapi.co/json/',
        'https://api.my-ip.io/ip.json'
      ];

      for (const service of services) {
        try {
          const response = await fetch(service);
          const data = await response.json();
          const ip = data.ip || data.address;
          if (ip) return ip;
        } catch (e) {
          continue;
        }
      }

      return null;
    } catch (error) {
      console.error('IP-Abruf fehlgeschlagen:', error);
      return null;
    }
  }

  ipInRange(ip, range) {
    // Einfache IP-Range-Prüfung (kann erweitert werden)
    const [rangeIP, mask] = range.split('/');
    // Implementiere CIDR-Check hier
    return false; // Vereinfacht
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

  generateToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  }

  showError(message) {
    const errorEl = document.getElementById('auth-error');
    errorEl.textContent = message;
    errorEl.classList.add('show');
    
    setTimeout(() => {
      errorEl.classList.remove('show');
    }, 5000);
  }

  showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 4000);
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
      <p>6.3 Bitte sprich mit deinen Eltern und wenn du dich unwohl fühlst, melde das und wende dich an deine Eltern.</p>
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
      <p>2.4 IP-Adressen (zur Sicherheit und VPN-Erkennung)</p>
      <p>2.5 Nutzungsdaten: Online-Status, letzte Aktivität</p>
      <p>2.6 Standortdaten: Region, optional Stadt und Koordinaten (für Umkreissuche)</p>
      
      <h3>3. Zweck der Datenverarbeitung</h3>
      <p>3.1 Bereitstellung der Plattform</p>
      <p>3.2 Sicherheit und Jugendschutz</p>
      <p>3.3 Moderation und Verhinderung von Missbrauch</p>
      <p>3.4 Umkreissuche (nur mit Zustimmung)</p>
      
      <h3>4. Rechtsgrundlage</h3>
      <p>Art. 6 Abs. 1 lit. a DSGVO (Einwilligung)</p>
      <p>Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)</p>
      <p>Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an Sicherheit)</p>
      
      <h3>5. Datenweitergabe</h3>
      <p>5.1 Keine Weitergabe an Dritte außer bei gesetzlicher Verpflichtung</p>
      <p>5.2 Hosting über Supabase (EU-Server)</p>
      
      <h3>6. Speicherdauer</h3>
      <p>6.1 Account-Daten: bis zur Löschung des Accounts</p>
      <p>6.2 Chat-Nachrichten: bis zur Löschung durch Nutzer</p>
      <p>6.3 Moderations-Logs: 6 Monate</p>
      
      <h3>7. Ihre Rechte</h3>
      <p>7.1 Auskunft, Berichtigung, Löschung</p>
      <p>7.2 Einschränkung der Verarbeitung</p>
      <p>7.3 Datenübertragbarkeit</p>
      <p>7.4 Widerspruch und Beschwerde bei Aufsichtsbehörde</p>
      
      <h3>8. Cookies</h3>
      <p>Nur technisch notwendige Cookies (Session)</p>
    `;
    this.showModal(content);
  }

  showJugendschutz() {
    const content = `
      <h2>Jugendschutzhinweise</h2>
      
      <h3>⚠️ Wichtige Sicherheitsregeln</h3>
      
      <h4>1. Persönliche Daten schützen</h4>
      <p>❌ Teile NIEMALS: Vollständigen Namen, Adresse, Telefonnummer, Schule, genauen Standort</p>
      <p>✅ Nutze nur deinen Benutzernamen und allgemeine Angaben (z.B. "Bayern" statt "München, Musterstraße 5")</p>
      
      <h4>2. Treffen im echten Leben</h4>
      <p>❌ Triff dich NICHT alleine mit Personen, die du nur online kennst</p>
      <p>✅ Wenn überhaupt, nur mit Begleitung der Eltern an öffentlichen Orten</p>
      
      <h4>3. Verdächtiges Verhalten melden</h4>
      <p>🚩 Melde sofort, wenn jemand:</p>
      <ul>
        <li>Nach persönlichen Daten fragt</li>
        <li>Sexuelle Inhalte schickt oder verlangt</li>
        <li>Dich zu Geheimnissen drängt</li>
        <li>Sich als jünger ausgibt als er/sie ist</li>
        <li>Dich zu einem Treffen überreden will</li>
      </ul>
      
      <h4>4. Für Eltern</h4>
      <p>👨‍👩‍👧 Begleiten Sie Ihr Kind bei der Nutzung:</p>
      <ul>
        <li>Sprechen Sie regelmäßig über Online-Kontakte</li>
        <li>Erklären Sie Gefahren wie Grooming und Catfishing</li>
        <li>Die Plattform kann keine 100%ige Sicherheit garantieren</li>
        <li>Elterliche Aufsicht ist unverzichtbar</li>
      </ul>
      
      <h4>5. Technische Schutzmaßnahmen</h4>
      <p>✅ Diese Plattform nutzt:</p>
      <ul>
        <li>Automatische Inhaltsmoderation</li>
        <li>VPN-Erkennung</li>
        <li>Melde- und Blockierfunktionen</li>
        <li>Moderatoren zur Prüfung von Meldungen</li>
      </ul>
      
      <h4>6. Im Notfall</h4>
      <p>🚨 Bei akuter Gefahr:</p>
      <ul>
        <li>Polizei: 110</li>
        <li>Nummer gegen Kummer: 116 111 (anonym & kostenlos)</li>
        <li>Hilfetelefon Sexueller Missbrauch: 0800 22 55 530</li>
      </ul>
    `;
    this.showModal(content);
  }

  showModal(content) {
    const modal = document.getElementById('modal-overlay');
    document.getElementById('modal-content').innerHTML = content;
    modal.classList.add('show');
    
    modal.querySelector('.modal-close').onclick = () => {
      modal.classList.remove('show');
    };
    
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.classList.remove('show');
      }
    };
  }
}

// Init
const authManager = new AuthManager();
