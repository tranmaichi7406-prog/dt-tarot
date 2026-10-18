"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramService = void 0;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const currency_1 = require("../utils/currency");
const transaction_model_1 = require("../models/transaction.model");
const sheets_service_1 = require("./sheets.service");
class TelegramService {
    static botInstance = null;
    static getBot() {
        if (this.botInstance) {
            return this.botInstance;
        }
        if (!config_1.config.telegram.botToken) {
            logger_1.logger.warn('[Telegram] Chưa cấu hình TELEGRAM_BOT_TOKEN trong .env');
            return null;
        }
        try {
            this.botInstance = new node_telegram_bot_api_1.default(config_1.config.telegram.botToken, { polling: true });
            this.botInstance.on('polling_error', (error) => {
                // Ghi log cảnh báo polling nhưng không làm sập ứng dụng
                logger_1.logger.warn(`[Telegram] Polling notice: ${error.message}`);
            });
            logger_1.logger.info('[Telegram] Đã kết nối Telegram Bot thành công!');
            return this.botInstance;
        }
        catch (err) {
            logger_1.logger.error('[Telegram] Lỗi khởi tạo Telegram Bot:', err.message);
            return null;
        }
    }
    /**
     * 1. THÔNG BÁO TỨC THÌ (REAL-TIME) - Đúng chuẩn format yêu cầu:
     * 🔔 ĐƠN #1 - [PAGE: tarotchips03]
     * 👤 Khách: Nguyễn Văn A
     * 🔮 Reader: Chi
     * 💰 Bill: 200.000đ
     */
    static async sendRealtimeTransactionAlert(data) {
        const bot = this.getBot();
        const chatId = config_1.config.telegram.managerChatId;
        if (!bot || !chatId) {
            logger_1.logger.warn('[Telegram] Không thể gửi thông báo (thiếu Bot hoặc TELEGRAM_MANAGER_CHAT_ID)');
            return false;
        }
        const amountFormatted = (0, currency_1.formatCurrencyVND)(data.amount);
        const platformStr = data.platform ? `\n📱 Nguồn: <b>${data.platform}</b>` : '';
        const message = `🔔 <b>ĐƠN #${data.dailyOrderNumber} - [PAGE: ${data.pageName}]</b>
👤 Khách: <b>${data.customerName}</b>
🔮 Reader: <b>${data.readerName}</b>
💰 Bill: <b>${amountFormatted}đ</b>${platformStr}`;
        try {
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            logger_1.logger.info(`[Telegram] Đã bắn thông báo ĐƠN #${data.dailyOrderNumber} vào nhóm chung: ${chatId}`);
            return true;
        }
        catch (error) {
            logger_1.logger.error(`[Telegram] Lỗi gửi thông báo ĐƠN #${data.dailyOrderNumber}:`, error.message);
            return false;
        }
    }
    /**
     * Thông báo khi ảnh bill bị trùng (đã ghi nhận trước đó)
     */
    static async sendDuplicateAlert(customerName, transactionCode, amount) {
        const bot = this.getBot();
        const chatId = config_1.config.telegram.managerChatId;
        if (!bot || !chatId)
            return;
        const message = `⚠️ <b>CẢNH BÁO TRÙNG BILL</b>
👤 Khách: <b>${customerName}</b>
💰 Số tiền: <b>${(0, currency_1.formatCurrencyVND)(amount)}đ</b>
🔖 Mã GD: <code>${transactionCode}</code>
<i>(Đơn này đã được ghi nhận trước đó. Hệ thống bỏ qua để tránh cộng trùng doanh thu)</i>`;
        try {
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        }
        catch { }
    }
    /**
     * Cảnh báo khi khách gửi ảnh nhưng OCR không đọc được số tiền
     */
    static async sendOcrFailedAlert(customerName) {
        const bot = this.getBot();
        const chatId = config_1.config.telegram.managerChatId;
        if (!bot || !chatId)
            return;
        const message = `⚠️ <b>KHÔNG ĐỌC ĐƯỢC BILL</b>
👤 Khách: <b>${customerName}</b>
<i>(Ảnh mờ hoặc không nhận diện được số tiền hợp lệ. Vui lòng kiểm tra lại tin nhắn)</i>`;
        try {
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        }
        catch { }
    }
    /**
     * 2. BÁO CÁO DOANH THU TOÀN HỆ THỐNG CUỐI NGÀY (Lấy chuẩn 100% từ Google Sheets tab Data)
     */
    static async generateSystemDailyReportMessage() {
        const dateFormatted = (0, currency_1.formatDateVN)(new Date());
        // 1. Đọc trực tiếp từ Google Sheets tab Data để báo cáo luôn luôn chuẩn xác
        const sheetRows = await sheets_service_1.GoogleSheetsService.getRowsByDate(dateFormatted);
        if (sheetRows.length > 0) {
            let totalRevenue = 0;
            let totalOrders = sheetRows.length;
            // Gom nhóm theo Page và Reader
            const pageMap = new Map();
            for (const row of sheetRows) {
                totalRevenue += row.amount;
                const pageKey = row.pageName || 'tarotchips03';
                if (!pageMap.has(pageKey)) {
                    pageMap.set(pageKey, { totalAmount: 0, readers: new Map() });
                }
                const pData = pageMap.get(pageKey);
                pData.totalAmount += row.amount;
                const readerKey = row.readerName || 'Chưa gán Reader';
                if (!pData.readers.has(readerKey)) {
                    pData.readers.set(readerKey, { count: 0, amount: 0 });
                }
                const rData = pData.readers.get(readerKey);
                rData.count += 1;
                rData.amount += row.amount;
            }
            let pagesSection = '';
            for (const [pName, pData] of pageMap.entries()) {
                const orderCount = Array.from(pData.readers.values()).reduce((sum, r) => sum + r.count, 0);
                pagesSection += `📍 <b>${pName}</b>: <b>${(0, currency_1.formatCurrencyVND)(pData.totalAmount)} VNĐ</b> (${orderCount} ca)\n`;
                for (const [rName, rData] of pData.readers.entries()) {
                    pagesSection += `   • Reader <b>${rName}</b>: ${rData.count} ca ➔ ${(0, currency_1.formatCurrencyVND)(rData.amount)} VNĐ\n`;
                }
                pagesSection += '\n';
            }
            return `📊 <b>BÁO CÁO DOANH THU TOÀN HỆ THỐNG NGÀY ${dateFormatted}</b>
━━━━━━━━━━━━━━━━━━━━━
💰 <b>TỔNG DOANH THU TẤT CẢ CÁC PAGE:</b> <b>${(0, currency_1.formatCurrencyVND)(totalRevenue)} VNĐ</b>
🎯 <b>TỔNG SỐ CA PHỤC VỤ:</b> <b>${totalOrders} ca</b>
━━━━━━━━━━━━━━━━━━━━━
<b>CHI TIẾT THEO TỪNG PAGE:</b>

${pagesSection.trim()}`;
        }
        // 2. Fallback sang SQLite nếu Sheets chưa có dòng nào
        const summary = transaction_model_1.TransactionModel.getSystemDailySummary();
        let pagesSection = '';
        for (const page of summary.pagesSummary) {
            pagesSection += `📍 <b>${page.page_name}</b>: <b>${(0, currency_1.formatCurrencyVND)(page.page_total_amount)} VNĐ</b> (${page.page_total_count} ca)\n`;
            if (page.readers.length === 0) {
                pagesSection += `   <i>(Chưa có ca nào trong ngày)</i>\n\n`;
            }
            else {
                for (const reader of page.readers) {
                    pagesSection += `   • Reader <b>${reader.reader_name}</b>: ${reader.count} ca ➔ ${(0, currency_1.formatCurrencyVND)(reader.amount)} VNĐ\n`;
                }
                pagesSection += '\n';
            }
        }
        return `📊 <b>BÁO CÁO DOANH THU TOÀN HỆ THỐNG NGÀY ${dateFormatted}</b>
━━━━━━━━━━━━━━━━━━━━━
💰 <b>TỔNG DOANH THU TẤT CẢ CÁC PAGE:</b> <b>${(0, currency_1.formatCurrencyVND)(summary.totalRevenueAllPages)} VNĐ</b>
🎯 <b>TỔNG SỐ CA PHỤC VỤ:</b> <b>${summary.totalOrdersAllPages} ca</b>
━━━━━━━━━━━━━━━━━━━━━
<b>CHI TIẾT THEO TỪNG PAGE:</b>

${pagesSection.trim()}`;
    }
    static async sendSystemDailyReport(targetChatId) {
        const bot = this.getBot();
        const chatId = targetChatId || config_1.config.telegram.managerChatId;
        if (!bot || !chatId)
            return false;
        const message = await this.generateSystemDailyReportMessage();
        try {
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            logger_1.logger.info(`[Telegram] Đã gửi báo cáo tổng hợp hệ thống tới: ${chatId}`);
            return true;
        }
        catch (error) {
            logger_1.logger.error(`[Telegram] Lỗi gửi báo cáo tổng hợp:`, error.message);
            return false;
        }
    }
}
exports.TelegramService = TelegramService;
