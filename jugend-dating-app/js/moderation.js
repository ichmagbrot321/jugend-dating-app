// ==================== MODERATION SYSTEM ====================

class ModerationManager {
  constructor() {
    this.wordLists = MODERATION_LISTS;
    this.patterns = MODERATION_PATTERNS;
  }

  async checkMessage(content, userId) {
    const lowerContent = content.toLowerCase();
    
    let score = 0;
    let classification = 'harmlos';
    let reason = '';
    let action = 'allow';

    // 1. KRITISCHE WÖRTER CHECK
    for (const word of this.wordLists.critical) {
      if (lowerContent.includes(word)) {
        score = 100;
        classification = 'kritisch';
        reason = 'Kritisches Schlüsselwort erkannt';
        action = 'block';
        
        await this.logModeration(userId, content, classification, score, reason, action);
        return { classification, score, reason, action };
      }
    }

    // 2. GROOMING CHECK
    let groomingCount = 0;
    for (const pattern of this.wordLists.grooming) {
      if (lowerContent.includes(pattern)) {
        groomingCount++;
        score += 20;
      }
    }
    
    if (groomingCount >= 2) {
      classification = 'kritisch';
      reason = 'Mögliches Grooming-Verhalten';
      action = 'block';
      
      await this.logModeration(userId, content, classification, score, reason, action);
      return { classification, score, reason, action };
    }

    // 3. SEXUELLE INHALTE
    for (const word of this.wordLists.sexual) {
      if (lowerContent.includes(word)) {
        score += 30;
        classification = 'regelverstoß';
        reason = 'Sexueller Inhalt';
        action = 'block';
        
        await this.logModeration(userId, content, classification, score, reason, action);
        return { classification, score, reason, action };
      }
    }

    // 4. GEWALT
    for (const word of this.wordLists.violence) {
      if (lowerContent.includes(word)) {
        score += 25;
        classification = 'kritisch';
        reason = 'Gewaltbezug';
        action = 'block';
        
        await this.logModeration(userId, content, classification, score, reason, action);
        return { classification, score, reason, action };
      }
    }

    // 5. DROGEN
    for (const word of this.wordLists.drugs) {
      if (lowerContent.includes(word)) {
        score += 20;
        classification = 'regelverstoß';
        reason = 'Drogenbezug';
        action = 'warn';
      }
    }

    // 6. BELÄSTIGUNG
    for (const word of this.wordLists.harassment) {
      if (lowerContent.includes(word)) {
        score += 15;
        if (classification === 'harmlos') {
          classification = 'grenzwertig';
          reason = 'Beleidigung';
          action = 'warn';
        }
      }
    }

    // 7. PATTERN CHECKS
    
    // Telefonnummern
    if (this.patterns.phone.test(content)) {
      score += 40;
      classification = 'kritisch';
      reason = 'Telefonnummer erkannt';
      action = 'block';
    }

    // E-Mail Adressen
    if (this.patterns.email.test(content)) {
      score += 35;
      classification = 'kritisch';
      reason = 'E-Mail-Adresse erkannt';
      action = 'block';
    }

    // URLs
    if (this.patterns.url.test(content)) {
      score += 30;
      classification = 'regelverstoß';
      reason = 'Link erkannt';
      action = 'block';
    }

    // Social Media Handles
    if (this.patterns.social.test(content)) {
      score += 25;
      classification = 'grenzwertig';
      reason = 'Social Media Handle erkannt';
      action = 'warn';
    }

    // Adressen
    if (this.patterns.address.test(content)) {
      score += 50;
      classification = 'kritisch';
      reason = 'Adresse erkannt';
      action = 'block';
    }

    // Spam (wiederholte Zeichen)
    if (this.patterns.spam.test(content)) {
      score += 10;
      if (classification === 'harmlos') {
        classification = 'grenzwertig';
        reason = 'Spam-Verdacht';
        action = 'warn';
      }
    }

    // 8. HEURISTISCHE CHECKS
    
    // Sehr lange Nachricht (>500 Zeichen)
    if (content.length > 500) {
      score += 5;
    }

    // Viele Großbuchstaben (SCHREIEN)
    const upperCount = (content.match(/[A-ZÄÖÜ]/g) || []).length;
    if (upperCount > content.length * 0.5 && content.length > 10) {
      score += 5;
    }

    // Viele Emojis
    const emojiCount = (content.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length;
    if (emojiCount > 5) {
      score += 5;
    }

    // 9. FINALE BEWERTUNG
    if (score >= 80) {
      classification = 'kritisch';
      action = 'block';
    } else if (score >= 50) {
      classification = 'regelverstoß';
      action = 'block';
    } else if (score >= 25) {
      classification = 'grenzwertig';
      action = 'warn';
    }

    // Log
    if (action !== 'allow') {
      await this.logModeration(userId, content, classification, score, reason, action);
    }

    return { classification, score, reason, action };
  }

  async checkProfileImage(imageFile, userId) {
    try {
      // 1. HASH-CHECK (gegen Datenbank)
      const hash = await this.calculateImageHash(imageFile);
      
      const { data: existingImage } = await supabase
        .from('image_hashes')
        .select('user_id')
        .eq('hash', hash)
        .single();

      if (existingImage && existingImage.user_id !== userId) {
        return {
          allowed: false,
          reason: 'Bild wird bereits von einem anderen Nutzer verwendet'
        };
      }

      // 2. NSFW-CHECK (Open-Source Modell)
      // Hier könntest du ein lokales NSFW-Modell wie NSFWJS nutzen
      // Für die Einfachheit hier ein Platzhalter
      
      const nsfwScore = await this.checkNSFW(imageFile);
      
      if (nsfwScore > 0.7) {
        return {
          allowed: false,
          reason: 'Unangemessenes Bild erkannt'
        };
      }

      // 3. SPEICHERE HASH
      await supabase
        .from('image_hashes')
        .upsert({
          user_id: userId,
          hash: hash,
          created_at: new Date().toISOString()
        });

      return { allowed: true };

    } catch (error) {
      console.error('Bild-Check fehlgeschlagen:', error);
      return { allowed: true }; // Bei Fehler erlauben
    }
  }

  async calculateImageHash(file) {
    // Einfacher Hash basierend auf Dateigröße und Namen
    // In Production würdest du einen echten Perceptual Hash nutzen
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async checkNSFW(file) {
    // Platzhalter für NSFW-Check
    // In Production: nutze nsfwjs oder ähnliches
    // https://github.com/infinitered/nsfwjs
    
    /*
    Beispiel mit nsfwjs:
    
    const img = await loadImage(file);
    const predictions = await nsfwModel.classify(img);
    const nsfwScore = predictions.find(p => p.className === 'Porn' || p.className === 'Sexy')?.probability || 0;
    return nsfwScore;
    */
    
    return 0; // Für Demo
  }

  async logModeration(userId, content, classification, score, reason, action) {
    await supabase
      .from('moderation_logs')
      .insert({
        user_id: userId,
        content_type: 'message',
        content: content,
        classification: classification,
        score: score,
        reason: reason,
        action: action,
        moderator_id: null // Auto-Moderation
      });
  }

  // Für Moderatoren: Manuelle Überprüfung
  async reviewContent(contentId, moderatorId, decision, reason) {
    await supabase
      .from('moderation_reviews')
      .insert({
        content_id: contentId,
        moderator_id: moderatorId,
        decision: decision,
        reason: reason
      });

    // Update Content Status
    if (decision === 'approved') {
      // Setze zurück
    } else if (decision === 'rejected') {
      // Lösche Inhalt und sanktioniere User
    }
  }
}

// Init
const moderationManager = new ModerationManager();
