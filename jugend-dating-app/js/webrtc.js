// ==================== WEBRTC CALLING SYSTEM ====================

class WebRTCManager {
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.isAudioCall = true;
    this.callDuration = 0;
    this.callInterval = null;
    
    this.configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.subscribeToCallSignals();
  }

  setupEventListeners() {
    // Voice Call Button
    document.getElementById('voice-call-btn').addEventListener('click', () => {
      this.startCall(true); // Audio only
    });

    // Video Call Button
    document.getElementById('video-call-btn').addEventListener('click', () => {
      this.startCall(false); // Audio + Video
    });

    // End Call Button
    document.getElementById('end-call-btn').addEventListener('click', () => {
      this.endCall();
    });

    // Mute Audio
    document.getElementById('mute-audio-btn').addEventListener('click', () => {
      this.toggleAudio();
    });

    // Toggle Video
    document.getElementById('toggle-video-btn').addEventListener('click', () => {
      this.toggleVideo();
    });
  }

  async startCall(audioOnly = true) {
    if (!chatManager.currentPartnerId) {
      authManager.showToast('Kein Chat-Partner ausgewählt', 'error');
      return;
    }

    this.isAudioCall = audioOnly;

    try {
      // Hole Media Streams
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: !audioOnly
      });

      // Zeige lokales Video
      if (!audioOnly) {
        document.getElementById('local-video').srcObject = this.localStream;
      }

      // Erstelle Peer Connection
      this.peerConnection = new RTCPeerConnection(this.configuration);

      // Füge lokale Streams hinzu
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      // Handle Remote Stream
      this.peerConnection.ontrack = (event) => {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
          document.getElementById('remote-video').srcObject = this.remoteStream;
        }
        this.remoteStream.addTrack(event.track);
      };

      // Handle ICE Candidates
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignal('ice-candidate', {
            candidate: event.candidate
          });
        }
      };

      // Erstelle Offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      // Sende Offer an Partner
      await this.sendSignal('call-offer', {
        offer: offer,
        audioOnly: audioOnly
      });

      // Zeige Call Screen
      this.showCallScreen();
      
      // Spiele Klingelton
      this.playRingtone();

    } catch (error) {
      console.error('Fehler beim Starten des Anrufs:', error);
      authManager.showToast('Anruf konnte nicht gestartet werden', 'error');
    }
  }

  async handleIncomingCall(data) {
    const accept = confirm(`Eingehender ${data.audioOnly ? 'Sprach' : 'Video'}anruf. Annehmen?`);

    if (!accept) {
      await this.sendSignal('call-rejected', {});
      return;
    }

    try {
      this.isAudioCall = data.audioOnly;

      // Hole Media Streams
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: !data.audioOnly
      });

      if (!data.audioOnly) {
        document.getElementById('local-video').srcObject = this.localStream;
      }

      // Erstelle Peer Connection
      this.peerConnection = new RTCPeerConnection(this.configuration);

      // Füge lokale Streams hinzu
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      // Handle Remote Stream
      this.peerConnection.ontrack = (event) => {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
          document.getElementById('remote-video').srcObject = this.remoteStream;
        }
        this.remoteStream.addTrack(event.track);
      };

      // Handle ICE Candidates
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignal('ice-candidate', {
            candidate: event.candidate
          });
        }
      };

      // Setze Remote Description
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

      // Erstelle Answer
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      // Sende Answer
      await this.sendSignal('call-answer', {
        answer: answer
      });

      // Zeige Call Screen
      this.showCallScreen();
      this.startCallTimer();

    } catch (error) {
      console.error('Fehler beim Annehmen des Anrufs:', error);
      authManager.showToast('Anruf konnte nicht angenommen werden', 'error');
    }
  }

  async handleCallAnswer(data) {
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      this.stopRingtone();
      this.startCallTimer();
    } catch (error) {
      console.error('Fehler beim Verarbeiten der Antwort:', error);
    }
  }

  async handleIceCandidate(data) {
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error('Fehler beim Hinzufügen des ICE-Kandidaten:', error);
    }
  }

  async sendSignal(type, data) {
    await supabase
      .from('call_signals')
      .insert({
        sender_id: authManager.currentUser.id,
        receiver_id: chatManager.currentPartnerId,
        signal_type: type,
        signal_data: data,
        created_at: new Date().toISOString()
      });
  }

  subscribeToCallSignals() {
    supabase
      .channel('call_signals')
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_signals',
          filter: `receiver_id=eq.${authManager.currentUser?.id}`
        },
        async (payload) => {
          const signal = payload.new;

          switch (signal.signal_type) {
            case 'call-offer':
              await this.handleIncomingCall(signal.signal_data);
              break;
            case 'call-answer':
              await this.handleCallAnswer(signal.signal_data);
              break;
            case 'ice-candidate':
              await this.handleIceCandidate(signal.signal_data);
              break;
            case 'call-ended':
              this.handleCallEnded();
              break;
            case 'call-rejected':
              this.handleCallRejected();
              break;
          }

          // Lösche Signal nach Verarbeitung
          await supabase
            .from('call_signals')
            .delete()
            .eq('id', signal.id);
        }
      )
      .subscribe();
  }

  showCallScreen() {
    document.getElementById('chat-screen').classList.remove('active');
    document.getElementById('call-screen').classList.add('active');

    // Update Partner Info
    const partnerName = document.getElementById('chat-partner-name').textContent;
    document.getElementById('call-partner-name').textContent = partnerName;
    
    document.getElementById('call-status').textContent = this.isAudioCall 
      ? 'Sprachanruf läuft...' 
      : 'Videoanruf läuft...';
  }

  startCallTimer() {
    this.callDuration = 0;
    this.callInterval = setInterval(() => {
      this.callDuration++;
      const minutes = Math.floor(this.callDuration / 60);
      const seconds = this.callDuration % 60;
      document.getElementById('call-duration').textContent = 
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
  }

  async endCall() {
    // Sende Signal
    await this.sendSignal('call-ended', {});

    // Cleanup
    this.cleanup();

    // Log Call
    await this.logCall();

    // Zurück zum Chat
    document.getElementById('call-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');

    authManager.showToast('Anruf beendet', 'info');
  }

  handleCallEnded() {
    this.cleanup();
    document.getElementById('call-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');
    authManager.showToast('Anruf wurde beendet', 'info');
  }

  handleCallRejected() {
    this.stopRingtone();
    this.cleanup();
    authManager.showToast('Anruf wurde abgelehnt', 'info');
  }

  cleanup() {
    // Stop Timer
    if (this.callInterval) {
      clearInterval(this.callInterval);
      this.callInterval = null;
    }

    // Stop Streams
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach(track => track.stop());
      this.remoteStream = null;
    }

    // Close Connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Reset UI
    document.getElementById('local-video').srcObject = null;
    document.getElementById('remote-video').srcObject = null;
  }

  toggleAudio() {
    if (!this.localStream) return;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const btn = document.getElementById('mute-audio-btn');
      btn.classList.toggle('active');
      btn.textContent = audioTrack.enabled ? '🎤' : '🔇';
    }
  }

  toggleVideo() {
    if (!this.localStream || this.isAudioCall) return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      const btn = document.getElementById('toggle-video-btn');
      btn.classList.toggle('active');
      btn.textContent = videoTrack.enabled ? '📹' : '📵';
    }
  }

  playRingtone() {
    // Einfacher Klingelton
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 440;
    gainNode.gain.value = 0.3;

    oscillator.start();

    this.ringtoneOscillator = oscillator;
    this.ringtoneContext = audioContext;
  }

  stopRingtone() {
    if (this.ringtoneOscillator) {
      this.ringtoneOscillator.stop();
      this.ringtoneContext.close();
      this.ringtoneOscillator = null;
      this.ringtoneContext = null;
    }
  }

  async logCall() {
    await supabase
      .from('call_logs')
      .insert({
        caller_id: authManager.currentUser.id,
        receiver_id: chatManager.currentPartnerId,
        call_type: this.isAudioCall ? 'audio' : 'video',
        duration: this.callDuration,
        created_at: new Date().toISOString()
      });
  }
}

// Init
const webrtcManager = new WebRTCManager();
