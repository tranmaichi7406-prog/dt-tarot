export interface Page {
  id: number;
  page_name: string;
  fb_page_id: string; // Facebook Page ID trên Meta Business
  access_token: string; // Page Access Token dài hạn
  telegram_group_id: string; // ID Telegram Group nhận thông báo
  created_at: string;
}

export interface Reader {
  id: number;
  page_id: number;
  reader_name: string;
  tag_prefix: string; // Ví dụ: "[May]", "~Tue", "[An]"
  commission_rate: number; // Tỷ lệ hoa hồng (ví dụ: 40 tức là 40%)
  created_at: string;
}

export type SessionStatus = 'UNCLAIMED' | 'CLAIMED' | 'COMPLETED';

export interface Session {
  id: number;
  conversation_id: string; // `${pageId}_${customerId}`
  page_id: number;
  customer_id: string;
  customer_name: string;
  claimed_by_reader_id: number | null;
  status: SessionStatus;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: number;
  daily_order_number: number; // Đánh số đơn tự động #1, #2... trong ngày
  page_id: number;
  reader_id: number | null;
  customer_name: string;
  package_name: string;
  amount: number;
  commission_rate: number;
  commission_amount: number;
  transaction_code: string;
  bill_image_url: string;
  sheet_row_number: number | null; // Lưu số dòng trên Google Sheets để lệnh /doi cập nhật đúng dòng
  created_at: string;
}

export interface OCRResult {
  rawText: string;
  amount: number | null;
  transactionCode: string | null;
  senderName?: string | null;
  confidence: number;
}
