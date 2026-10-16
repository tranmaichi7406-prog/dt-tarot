import { TelegramService } from './telegram.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import { formatDateVN } from '../utils/currency';

export class HeartbeatService {
  private static statusMessageId: number | null = 69; // Dùng message vừa ghim hoặc tạo mới
  private static heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Khởi động chu kỳ cập nhật trạng thái trực tuyến 24/7
   */
  static startHeartbeat(intervalMinutes = 3): void {
    if (this.heartbeatInterval) return;

    logger.info(`[Heartbeat] Bật cơ chế cập nhật trạng thái trực tuyến 24/7 (${intervalMinutes} phút/lần)...`);

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
  static async updateStatus(): Promise<void> {
    const bot = TelegramService.getBot();
    const chatId = config.telegram.managerChatId;
    if (!bot || !chatId) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN');
    const dateStr = formatDateVN(now);

    const messageText = 
`🟢 <b>HỆ THỐNG ĐANG TRỰC TUYẾN 24/7</b>
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
        logger.debug(`[Heartbeat] Đã cập nhật trạng thái Live: ${timeStr}`);
      } else {
        const sent = await bot.sendMessage(chatId, messageText, { parse_mode: 'HTML' });
        this.statusMessageId = sent.message_id;
        await bot.pinChatMessage(chatId, sent.message_id, { disable_notification: true }).catch(() => {});
      }
    } catch (err: any) {
      // Nếu tin nhắn cũ bị xóa, tạo tin nhắn mới
      if (err.message && err.message.includes('message to edit not found')) {
        try {
          const sent = await bot.sendMessage(chatId, messageText, { parse_mode: 'HTML' });
          this.statusMessageId = sent.message_id;
          await bot.pinChatMessage(chatId, sent.message_id, { disable_notification: true }).catch(() => {});
        } catch {}
      }
    }
  }
}
