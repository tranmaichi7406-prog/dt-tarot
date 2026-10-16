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

// Khởi tạo schema SQL và migration an toàn
export function initDatabase(): void {
  // Migration các cột mới nếu đang dùng file database cũ
  try { db.exec('ALTER TABLE transactions ADD COLUMN daily_order_number INTEGER NOT NULL DEFAULT 1;'); } catch {}
  try { db.exec('ALTER TABLE transactions ADD COLUMN commission_rate REAL DEFAULT 0.0;'); } catch {}
  try { db.exec('ALTER TABLE transactions ADD COLUMN commission_amount INTEGER DEFAULT 0;'); } catch {}
  try { db.exec('ALTER TABLE transactions ADD COLUMN sheet_row_number INTEGER;'); } catch {}
  try { db.exec('ALTER TABLE readers ADD COLUMN commission_rate REAL DEFAULT 40.0;'); } catch {}

  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);

  console.log(`[Database] Đã kết nối và khởi tạo SQLite tại: ${config.databasePath}`);
}
