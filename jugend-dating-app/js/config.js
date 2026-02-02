// ==================== SUPABASE KONFIGURATION ====================
const SUPABASE_URL = 'https://yavsgbhybwzjaptacbij.supabase.co'; // ← HIER EINTRAGEN
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhdnNnYmh5Ynd6amFwdGFjYmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5ODEzNTIsImV4cCI6MjA4NTU1NzM1Mn0.MZ_sFW9RAzrZxrZ-hypzuXHZ6uq2907LspeoA43bIis'; // ← HIER EINTRAGEN

// Initialisierung nur EINMAL
let supabase;
if (typeof window.supabase !== 'undefined') {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.error('Supabase library nicht geladen!');
}

// ==================== OWNER KONFIGURATION ====================
const OWNER_EMAIL = 'pajaziti.leon97080@gmail.com';

// ==================== APP KONFIGURATION ====================
const APP_CONFIG = {
  minAge: 14,
  parentVerificationAge: 16,
  maxMessageLength: 1000,
  profilePictureRequired: true,
  moderationEnabled: true,
  vpnDetectionEnabled: true,
  maxDistanceKm: 100, // Standard-Entfernung
  allowCitySearch: true
};

// ==================== VPN DETECTION API ====================
const VPN_DETECTION = {
  // API Keys (optional für bessere Detection)
  ipQualityScore: null, // Optional: https://www.ipqualityscore.com
  
  // Bekannte VPN/Proxy Ranges
  knownVPNRanges: [
    '185.159.158.0/24', // NordVPN
    '37.120.128.0/17',  // ExpressVPN
    '193.29.104.0/21',  // ProtonVPN
    '91.219.237.0/24',  // CyberGhost
  ],
  
  // ASN von VPN-Providern
  knownVPNASNs: [
    'AS396982', 'AS16509', 'AS14061', 'AS13335'
  ],
  
  // VPN-Keywords in Hostnames
  vpnKeywords: [
    'vpn', 'proxy', 'tor', 'relay', 'tunnel', 'hide', 
    'anonymous', 'private', 'secure', 'express'
  ]
};

// ==================== MODERATION WORTLISTEN ====================
const MODERATION_LISTS = {
  critical: [
    'nudes', 'nacktbilder', 'sexting', 'treffen', 'adresse',
    'telefonnummer', 'whatsapp', 'snap', 'instagram', 'telegram',
    'komm vorbei', 'zu mir', 'alleine treffen'
  ],
  
  grooming: [
    'geheim', 'nicht sagen', 'alleine treffen', 'niemand erzählen',
    'besonders', 'erwachsen', 'reif für dein alter', 'nur uns zwei',
    'vertrauen', 'geschenk', 'belohnung'
  ],
  
  sexual: [
    'sex', 'porno', 'xxx', 'geil', 'nackt', 'brüste', 'penis',
    'vagina', 'anal', 'oral', 'masturbation', 'wichsen', 'fingern',
    'blasen', 'lecken', 'fick', 'bumsen'
  ],
  
  violence: [
    'töten', 'umbringen', 'selbstmord', 'suizid', 'ritzen', 'blut',
    'messer', 'waffe', 'schießen', 'erschiessen', 'erstechen',
    'vergewaltigung', 'missbrauch'
  ],
  
  drugs: [
    'kokain', 'koks', 'heroin', 'crystal', 'meth', 'mdma', 'ecstasy',
    'lsd', 'pilze', 'gras', 'weed', 'kiffen', 'dealer', 'drogen kaufen',
    'high werden', 'speed', 'amphetamin'
  ],
  
  harassment: [
    'hure', 'schlampe', 'nutte', 'fotze', 'schwuchtel', 'spast',
    'missgeburt', 'hässlich', 'fett', 'dumm', 'behindert', 'mongo',
    'opfer', 'hurensohn', 'wichser'
  ]
};

// ==================== REGEX PATTERNS ====================
const MODERATION_PATTERNS = {
  phone: /(\+?\d{1,4}[\s-]?)?\(?\d{3,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/g,
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  url: /(https?:\/\/|www\.)[^\s]+/gi,
  address: /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+(\s+[A-ZÄÖÜ][a-zäöüß]+)*\b/g,
  social: /@[a-zA-Z0-9._]{3,}/g,
  spam: /(.)\1{4,}/g
};

// ==================== DISTANZ-BERECHNUNG ====================
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Erdradius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ==================== GEO-CODING (Stadt zu Koordinaten) ====================
async function getCityCoordinates(city, region) {
  try {
    // Nominatim (OpenStreetMap) - kostenlos, keine API-Key nötig
    const query = `${city}, ${region}, Germany`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TeenConnect-Dating-App'
      }
    });
    
    const data = await response.json();
    
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon)
      };
    }
    
    return null;
  } catch (error) {
    console.error('Geocoding-Fehler:', error);
    return null;
  }
}

// ==================== EXPORT ====================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    supabase,
    OWNER_EMAIL,
    APP_CONFIG,
    VPN_DETECTION,
    MODERATION_LISTS,
    MODERATION_PATTERNS,
    calculateDistance,
    getCityCoordinates
  };
}
