-- Bảng quản lý Facebook Fanpages thuộc Meta Business Suite (Multi-tenant)
CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_name TEXT NOT NULL UNIQUE,
    fb_page_id TEXT NOT NULL UNIQUE,       -- Facebook Page ID trên Meta Business
    access_token TEXT NOT NULL,           -- Page Access Token vĩnh viễn/dài hạn
    telegram_group_id TEXT NOT NULL,      -- ID nhóm Telegram nhận thông báo
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bảng quản lý Reader phụ trách và tỷ lệ hoa hồng
CREATE TABLE IF NOT EXISTS readers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    reader_name TEXT NOT NULL,
    tag_prefix TEXT NOT NULL,             -- Mã nhận diện (vd: [May], [Tue], [An]...)
    commission_rate REAL DEFAULT 40.0,    -- % hoa hồng của reader (vd: 40 = 40%)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_id, tag_prefix),
    UNIQUE(page_id, reader_name)
);

-- Bảng quản lý phiên trò chuyện & cơ chế Reader rep trước nhận khách
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL UNIQUE, -- Định danh duy nhất: pageId_customerId
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL,            -- PSID (Page-Scoped ID của khách hàng)
    customer_name TEXT NOT NULL,          -- Tên hiển thị Facebook của khách
    claimed_by_reader_id INTEGER REFERENCES readers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'UNCLAIMED' CHECK(status IN ('UNCLAIMED', 'CLAIMED', 'COMPLETED')),
    last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bảng lưu trữ lịch sử giao dịch chuyển khoản từ bill OCR
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    daily_order_number INTEGER NOT NULL DEFAULT 1, -- Đơn #1, #2... tự reset theo ngày
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    reader_id INTEGER REFERENCES readers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    package_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    commission_rate REAL DEFAULT 0.0,
    commission_amount INTEGER DEFAULT 0,
    transaction_code TEXT NOT NULL UNIQUE,
    bill_image_url TEXT NOT NULL,
    sheet_row_number INTEGER,             -- Số dòng trên Google Sheets để lệnh /doi sửa cột C
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tối ưu hóa truy vấn
CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON sessions(page_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_code ON transactions(transaction_code);
CREATE INDEX IF NOT EXISTS idx_transactions_daily ON transactions(daily_order_number, created_at);
CREATE INDEX IF NOT EXISTS idx_readers_page ON readers(page_id);
