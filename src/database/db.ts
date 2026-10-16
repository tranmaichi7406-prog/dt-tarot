import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

// Đảm bảo thư mục lưu trữ database tồn tại
const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Khởi tạo native SQLite instance tích hợp sẵn trong Node.js (0 đồng, 0 phụ thuộc C++)
export const db = new DatabaseSync(config.databasePath);

// Bật chế độ WAL và Foreign Keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_name TEXT NOT NULL UNIQUE,
    fb_page_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    telegram_group_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS readers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    reader_name TEXT NOT NULL,
    tag_prefix TEXT NOT NULL,
    commission_rate REAL DEFAULT 40.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_id, tag_prefix),
    UNIQUE(page_id, reader_name)
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL UNIQUE,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    claimed_by_reader_id INTEGER REFERENCES readers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'UNCLAIMED' CHECK(status IN ('UNCLAIMED', 'CLAIMED', 'COMPLETED')),
    last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    daily_order_number INTEGER NOT NULL DEFAULT 1,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    reader_id INTEGER REFERENCES readers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    package_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    commission_rate REAL DEFAULT 0.0,
    commission_amount INTEGER DEFAULT 0,
    transaction_code TEXT NOT NULL UNIQUE,
    bill_image_url TEXT NOT NULL,
    sheet_row_number INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON sessions(page_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_code ON transactions(transaction_code);
CREATE INDEX IF NOT EXISTS idx_transactions_daily ON transactions(daily_order_number, created_at);
CREATE INDEX IF NOT EXISTS idx_readers_page ON readers(page_id);
`;

// Khởi tạo schema SQL và migration an toàn
export function initDatabase(): void {
  // Migration các cột mới nếu đang dùng file database cũ
  try { db.exec('ALTER TABLE transactions ADD COLUMN daily_order_number INTEGER NOT NULL DEFAULT 1;'); } catch {}
  try { db.exec('ALTER TABLE transactions ADD COLUMN commission_rate REAL DEFAULT 0.0;'); } catch {}
  try { db.exec('ALTER TABLE transactions ADD COLUMN commission_amount INTEGER DEFAULT 0;'); } catch {}
  try { db.exec('ALTER TABLE transactions ADD COLUMN sheet_row_number INTEGER;'); } catch {}
  try { db.exec('ALTER TABLE readers ADD COLUMN commission_rate REAL DEFAULT 40.0;'); } catch {}

  db.exec(SCHEMA_SQL);

  // Tự động nạp sẵn Fanpage và 2 Reader mặc định (Chi & NA) để hệ thống chạy ngay không cần gõ lệnh cấu hình
  try {
    const pageStmt = db.prepare('SELECT COUNT(*) as count FROM pages');
    const pageCount = (pageStmt.get() as any)?.count || 0;
    const currentToken = 'EAAdXu1ebxMUBSpU6ZC48OB8DwcOKSjQzAV8KzXaPjCfptCTZBbBrz5CVcFwxplFGqfhTglUJrHoHHcf0ZAYRfnvWpAq1p4b4eZC2M2wgkh3tyWHzDd0rSFv0dGsijUT4VruXMAEVDMUoL4FFv1IumBLeg8oFjbPPIXafNf8JL0cK8mksMZA000aczZCCtJe8CHnCPPB4CkSXxHeq4Kq70k156MuS6QciLTwtwKBqgZD';
    if (pageCount === 0) {
      db.prepare(`
        INSERT INTO pages (id, page_name, fb_page_id, access_token, telegram_group_id)
        VALUES (1, 'tarotchips', '992148840643936', ?, '-1004418215870')
      `).run(currentToken);
      console.log('[Database] Đã tự động tạo Fanpage tarotchips (992148840643936)');
    } else {
      // Tự động cập nhật Page Access Token mới nhất cho tarotchips
      db.prepare(`
        UPDATE pages SET access_token = ? WHERE fb_page_id = '992148840643936' OR id = 1
      `).run(currentToken);
      console.log('[Database] Đã cập nhật Page Access Token mới cho tarotchips');
    }

    const readerStmt = db.prepare('SELECT COUNT(*) as count FROM readers');
    const readerCount = (readerStmt.get() as any)?.count || 0;
    if (readerCount === 0) {
      db.prepare(`
        INSERT INTO readers (page_id, reader_name, tag_prefix, commission_rate)
        VALUES 
          (1, 'Chi', '.', 40.0),
          (1, 'NA', '', 40.0)
      `).run();
      console.log('[Database] Đã tự động nạp 2 Reader: Chi (dấu .) & NA (không ký tự - mặc định)');
    } else {
      // Đảm bảo NA không có ký tự nếu đang lưu dấu phẩy cũ
      db.prepare("UPDATE readers SET tag_prefix = '' WHERE LOWER(reader_name) = 'na' AND tag_prefix = ','").run();
    }
  } catch (seedErr: any) {
    console.error('[Database] Lỗi khi seed dữ liệu ban đầu:', seedErr.message);
  }

  console.log(`[Database] Đã kết nối và khởi tạo SQLite tại: ${config.databasePath}`);
}
