export interface KickTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope?: string;
  user_id?: number;
  username?: string;
}

export interface KickUserRef {
  user_id: number;
  username?: string;
  [key: string]: unknown;
}

// chat.message.sent v1 webhook payload (fields we use; Kick sends more).
export interface ChatMessageSentEvent {
  message_id: string;
  broadcaster: KickUserRef;
  sender: KickUserRef;
  content: string;
  created_at?: string;
  [key: string]: unknown;
}
