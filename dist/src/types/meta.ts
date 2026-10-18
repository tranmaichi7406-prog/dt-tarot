// Types cho Meta Webhook payload (Instagram Messaging API via Facebook Graph API v19.0+)

export interface MetaWebhookPayload {
  object: 'instagram' | 'page' | 'threads' | string;
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id: string; // Page ID hoặc Instagram Business Account ID
  time: number;
  messaging?: MetaMessagingEvent[];
  standby?: MetaMessagingEvent[];
}

export interface MetaMessagingEvent {
  sender: {
    id: string; // Instagram-scoped ID (IGSID) hoặc PSID
  };
  recipient: {
    id: string; // Instagram Page ID
  };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean; // True nếu tin nhắn do Page gửi đi
    app_id?: number;
    attachments?: MetaAttachment[];
    quick_reply?: {
      payload: string;
    };
    referral?: {
      source?: string;
      type?: string;
    };
  };
  referral?: {
    source?: string;
    type?: string;
  };
  read?: {
    watermark: number;
  };
  delivery?: {
    mids: string[];
    watermark: number;
  };
}

export interface MetaAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'fallback';
  payload: {
    url: string;
    title?: string;
  };
}
