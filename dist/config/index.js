"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'production',
    timezone: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',
    // Database SQLite lưu trữ nội bộ
    databasePath: process.env.DATABASE_PATH || path_1.default.resolve(process.cwd(), 'data', 'tarot_revenue.sqlite'),
    // Meta Webhook (Facebook Graph API v19.0+ / Meta Business Suite)
    meta: {
        verifyToken: process.env.META_VERIFY_TOKEN || 'dt_tarot_verify_token_default',
        appSecret: process.env.META_APP_SECRET || '',
        graphApiVersion: 'v19.0',
        graphApiBaseUrl: 'https://graph.facebook.com/v19.0'
    },
    // Telegram Bot
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        managerChatId: process.env.TELEGRAM_MANAGER_CHAT_ID || '', // Gom tất cả thông báo về 1 nhóm duy nhất
        adminIds: (process.env.TELEGRAM_ADMIN_IDS || '')
            .split(',')
            .map(id => id.trim())
            .filter(id => id.length > 0)
    },
    // Google Sheets (Ghi nối tiếp file có sẵn của Phụ huynh xem)
    google: {
        spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
        serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || path_1.default.resolve(process.cwd(), 'config', 'google-service-account.json'),
        serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ''
    },
    // OCR
    ocr: {
        languages: process.env.OCR_LANGUAGES || 'eng+vie'
    },
    // Mapping giá gói Tarot
    packagePriceMap: [
        { amount: 25000, name: 'Gói 1 Câu Hỏi (Quick)' },
        { amount: 50000, name: 'Gói 2 Câu Hỏi' },
        { amount: 70000, name: 'Gói 3 Câu Hỏi' },
        { amount: 100000, name: 'Gói Tổng Quan 30 Phút' },
        { amount: 150000, name: 'Gói Tình Duyên / Sự Nghiệp 45 Phút' },
        { amount: 200000, name: 'Gói Chuyên Sâu 60 Phút' },
        { amount: 300000, name: 'Gói VIP 90 Phút' }
    ]
};
