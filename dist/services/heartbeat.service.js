"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HeartbeatService = void 0;
const telegram_service_1 = require("./telegram.service");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const currency_1 = require("../utils/currency");
class HeartbeatService {
    static statusMessageId = 69; // Dùng message vừa ghim hoặc tạo mới
    static heartbeatInterval = null;
    /**
     * Khởi động chu kỳ cập nhật trạng thái trực tuyến 24/7
     */
    static startHeartbeat(intervalMinutes = 3) {
        if (this.heartbeatInterval)
            return;
        logger_1.logger.info(`[Heartbeat] Bật cơ chế cập nhật trạng thái trực tuyến 24/7 (${intervalMinutes} phút/lần)...`);
        // Chạy cập nhật ngay khi khởi động
        this.updateStatus();
        // Định kỳ cập nhật lại tin nhắn ghim
        this.heartbeatInterval = setInterval(() => {
            this.updateStatus();
        }, intervalMinutes * 60 * 1000);
    }
    /**
     * Cập nhật nội dung tin nhắn trạng thái ghim trên đầu nhóm
     */
    static async updateStatus() {
        const bot = telegram_service_1.TelegramService.getBot();
        const chatId = config_1.config.telegram.managerChatId;
        if (!bot || !chatId)
            return;
        const now = new Date();
        const timeStr = now.toLocaleTimeString('vi-VN');
        const dateStr = (0, currency_1.formatDateVN)(now);
        const messageText = `🟢 <b>HỆ THỐNG ĐANG TRỰC TUYẾN 24/7</b>
━━━━━━━━━━━━━━━━━━━━━
⏰ <b>Cập nhật:</b> ${timeStr} - ${dateStr}
🔋 <b>Trạng thái:</b> Sẵn sàng nhận đơn & đọc bill tự động
📡 <b>Máy chủ:</b> Render (Đang hoạt động bình thường)
<i>(Tin nhắn này tự động cập nhật liên tục để bạn theo dõi trạng thái sống của bot)</i>`;
        try {
            if (this.statusMessageId) {
                await bot.editMessageText(messageText, {
                    chat_id: chatId,
                    message_id: this.statusMessageId,
                    parse_mode: 'HTML'
                });
                logger_1.logger.debug(`[Heartbeat] Đã cập nhật trạng thái Live: ${timeStr}`);
            }
            else {
                const sent = await bot.sendMessage(chatId, messageText, { parse_mode: 'HTML' });
                this.statusMessageId = sent.message_id;
                await bot.pinChatMessage(chatId, sent.message_id, { disable_notification: true }).catch(() => { });
            }
        }
        catch (err) {
            // Nếu tin nhắn cũ bị xóa, tạo tin nhắn mới
            if (err.message && err.message.includes('message to edit not found')) {
                try {
                    const sent = await bot.sendMessage(chatId, messageText, { parse_mode: 'HTML' });
                    this.statusMessageId = sent.message_id;
                    await bot.pinChatMessage(chatId, sent.message_id, { disable_notification: true }).catch(() => { });
                }
                catch { }
            }
        }
    }
}
exports.HeartbeatService = HeartbeatService;
