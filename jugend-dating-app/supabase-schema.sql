-- ==================== TEENCONNECT DATABASE SCHEMA ====================

-- ==================== EXTENSIONS ====================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== ENUMS ====================
CREATE TYPE user_role AS ENUM ('user', 'parent', 'moderator', 'admin', 'owner');
CREATE TYPE account_status AS ENUM ('active', 'restricted', 'banned', 'deleted');
CREATE TYPE report_status AS ENUM ('pending', 'reviewed', 'action_taken', 'rejected');
CREATE TYPE moderation_action AS ENUM ('allow', 'warn', 'block', 'mute', 'report', 'ban');

-- ==================== USERS TABLE ====================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(20) UNIQUE NOT NULL,
  geburtsdatum DATE NOT NULL,
  eltern_email VARCHAR(255),
  verified_parent BOOLEAN DEFAULT FALSE,
  profilbild_url TEXT,
  interessen TEXT,
  region VARCHAR(100) NOT NULL,
  stadt VARCHAR(100),
  
  -- Privacy Settings
  online_status BOOLEAN DEFAULT TRUE,
  gelesen_status BOOLEAN DEFAULT TRUE,
  schreibstatus BOOLEAN DEFAULT TRUE,
  zuletzt_online TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Moderation
  role user_role DEFAULT 'user',
  strikes INTEGER DEFAULT 0,
  account_status account_status DEFAULT 'active',
  ban_reason TEXT,
  
  -- Security
  last_ip INET,
  vpn_detected BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT username_length CHECK (char_length(username) >= 3),
  CONSTRAINT age_check CHECK (EXTRACT(YEAR FROM AGE(geburtsdatum)) >= 14)
);

-- ==================== PARENT VERIFICATIONS ====================
CREATE TABLE parent_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_email VARCHAR(255) NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== CHATS TABLE ====================
CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message TEXT,
  unread_user1 INTEGER DEFAULT 0,
  unread_user2 INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraint: Keine doppelten Chats
  CONSTRAINT unique_chat UNIQUE (user1_id, user2_id)
);

-- ==================== MESSAGES TABLE ====================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  empfaenger_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  deleted BOOLEAN DEFAULT FALSE,
  gelesen BOOLEAN DEFAULT FALSE,
  
  -- Moderation Metadata
  moderation_score INTEGER DEFAULT 0,
  moderation_classification VARCHAR(50),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT message_length CHECK (char_length(content) <= 1000)
);

-- ==================== TYPING STATUS ====================
CREATE TABLE typing_status (
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_typing BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (chat_id, user_id)
);

-- ==================== BLOCKS ====================
CREATE TABLE blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_block UNIQUE (blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id != blocked_id)
);

-- ==================== REPORTS ====================
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
  
  reason VARCHAR(50) NOT NULL,
  details TEXT,
  status report_status DEFAULT 'pending',
  
  -- Appeal System
  appealed BOOLEAN DEFAULT FALSE,
  appeal_reason TEXT,
  
  -- Moderator Review
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  action_taken VARCHAR(255),
  rejection_reason TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== MODERATION LOGS ====================
CREATE TABLE moderation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  action VARCHAR(50) NOT NULL,
  reason TEXT NOT NULL,
  
  -- Content Info
  content_type VARCHAR(50),
  content TEXT,
  classification VARCHAR(50),
  score INTEGER,
  
  -- Strike Info
  strikes_after INTEGER,
  
  -- Undo Option
  undone BOOLEAN DEFAULT FALSE,
  undone_by UUID REFERENCES users(id) ON DELETE SET NULL,
  undone_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== IMAGE HASHES ====================
CREATE TABLE image_hashes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_hash UNIQUE (hash)
);

-- ==================== CALL SIGNALS ====================
CREATE TABLE call_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_type VARCHAR(50) NOT NULL,
  signal_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== CALL LOGS ====================
CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_type VARCHAR(20) NOT NULL, -- 'audio' or 'video'
  duration INTEGER, -- seconds
  ended_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== NOTIFICATIONS ====================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSONB,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== MODERATION QUEUE ====================
CREATE TABLE moderation_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(50) NOT NULL, -- 'report', 'appeal', 'auto_flagged'
  report_id UUID REFERENCES reports(id) ON DELETE CASCADE,
  priority VARCHAR(20) DEFAULT 'normal', -- 'low', 'normal', 'high', 'critical'
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== INDEXES ====================
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_account_status ON users(account_status);

CREATE INDEX idx_messages_chat_id ON messages(chat_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

CREATE INDEX idx_chats_user1 ON chats(user1_id);
CREATE INDEX idx_chats_user2 ON chats(user2_id);
CREATE INDEX idx_chats_updated_at ON chats(updated_at DESC);

CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_reporter ON reports(reporter_id);
CREATE INDEX idx_reports_reported_user ON reports(reported_user_id);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(read);

-- ==================== ROW LEVEL SECURITY (RLS) ====================

-- Users: Jeder kann eigenes Profil sehen
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all active users"
  ON users FOR SELECT
  USING (account_status = 'active');

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- Messages: Nur Sender und Empfänger
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
  ON messages FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = empfaenger_id);

CREATE POLICY "Users can send messages"
  ON messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can delete own messages"
  ON messages FOR UPDATE
  USING (auth.uid() = sender_id);

-- Chats: Nur Teilnehmer
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chats"
  ON chats FOR SELECT
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can create chats"
  ON chats FOR INSERT
  WITH CHECK (auth.uid() = user1_id);

-- Reports: Eigene Reports sehen
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reports"
  ON reports FOR SELECT
  USING (auth.uid() = reporter_id);

CREATE POLICY "Users can create reports"
  ON reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

-- Moderators can view all reports
CREATE POLICY "Moderators can view all reports"
  ON reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('moderator', 'admin', 'owner')
    )
  );

-- Notifications: Nur eigene
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

-- ==================== FUNCTIONS ====================

-- Auto-Update last_active_at
CREATE OR REPLACE FUNCTION update_last_active()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE users 
  SET last_active_at = NOW() 
  WHERE id = NEW.sender_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_last_active
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_last_active();

-- Auto-Update Chat timestamp
CREATE OR REPLACE FUNCTION update_chat_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chats 
  SET updated_at = NOW() 
  WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_chat_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_chat_timestamp();

-- ==================== STORAGE BUCKETS ====================
-- Führe in Supabase Dashboard aus:
-- Storage > Create Bucket > "profile-pictures" (Public)

-- ==================== INITIAL DATA ====================
-- Owner wird automatisch bei Registrierung mit der E-Mail gesetzt
