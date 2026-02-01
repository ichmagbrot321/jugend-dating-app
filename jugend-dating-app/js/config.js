// ==================== SUPABASE KONFIGURATION ====================
const SUPABASE_CONFIG = {
  url: 'https://yavsgbhybwzjaptacbij.supabase.co', // z.B. https://xyz.supabase.co
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhdnNnYmh5Ynd6amFwdGFjYmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5ODEzNTIsImV4cCI6MjA4NTU1NzM1Mn0.MZ_sFW9RAzrZxrZ-hypzuXHZ6uq2907LspeoA43bIis'
};

// Initialisierung
const supabase = window.supabase.createClient(
  SUPABASE_CONFIG.url,
  SUPABASE_CONFIG.anonKey
);

// ==================== OWNER KONFIGURATION ====================
const OWNER_EMAIL = 'pajaziti.leon97080@gmail.com';

// ==================== APP KONFIGURATION ====================
const APP_CONFIG = {
  minAge: 14,
  parentVerificationAge: 16,
  maxMessageLength: 1000,
  profilePictureRequired: true,
  moderationEnabled: true,
  vpnDetectionEnabled: true
};

// ==================== VPN DETECTION LISTEN ====================
const VPN_DETECTION = {
  // Öffentliche VPN IP-Ranges (Beispiel - erweitere diese Liste)
  knownVPNRanges: [
    '185.159.158.0/24', // NordVPN
    '37.120.128.0/17',  // ExpressVPN
    // Weitere hinzufügen
  ],
  
  // ASN von bekannten VPN-Providern
  knownVPNASNs: [
    'AS396982', // Google Cloud
    'AS16509', // Amazon AWS
    'AS14061', // DigitalOcean
    // Weitere hinzufügen
  ]
};

// ==================== MODERATION WORTLISTEN ====================
const MODERATION_LISTS = {
  // Kritische Wörter (sofortiger Block)
  critical: [
    'nudes', 'nacktbilder', 'sexting', 'treffen', 'adresse',
    'telefonnummer', 'whatsapp', 'snap', 'instagram private'
  ],
  
  // Grooming-Patterns
  grooming: [
    'geheim', 'nicht sagen', 'alleine treffen', 'niemand erzählen',
    'besonders', 'erwachsen', 'reif für dein alter'
  ],
  
  // Sexuelle Inhalte
  sexual: [
    'sex', 'porno', 'geil', 'nackt', 'brüste', 'penis',
    'vagina', 'anal', 'oral', 'masturbation'
  ],
  
  // Gewalt
  violence: [
    'töten', 'umbringen', 'selbstmord', 'ritzen', 'blut',
    'messer', 'waffe', 'schießen'
  ],
  
  // Drogen
  drugs: [
    'kokain', 'heroin', 'crystal', 'mdma', 'ecstasy',
    'gras', 'weed', 'kiffen', 'dealer'
  ],
  
  // Belästigung
  harassment: [
    'hure', 'schlampe', 'schwuchtel', 'missgeburt',
    'hässlich', 'fett', 'dumm', 'behindert'
  ]
};

// ==================== REGEX PATTERNS ====================
const MODERATION_PATTERNS = {
  // Telefonnummern
  phone: /(\+?\d{1,4}[\s-]?)?\(?\d{3,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/g,
  
  // E-Mail Adressen
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  
  // URLs
  url: /(https?:\/\/|www\.)[^\s]+/g,
  
  // Adressen (grob)
  address: /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+(\s+[A-ZÄÖÜ][a-zäöüß]+)*\b/g,
  
  // Social Media Handles
  social: /@[a-zA-Z0-9._]{3,}/g,
  
  // Wiederholte Zeichen (Spam)
  spam: /(.)\1{4,}/g
};

// ==================== EXPORT ====================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    supabase,
    OWNER_EMAIL,
    APP_CONFIG,
    VPN_DETECTION,
    MODERATION_LISTS,
    MODERATION_PATTERNS
  };
}
