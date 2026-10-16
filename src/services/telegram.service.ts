import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { logger } from '../utils/logger';
import { formatCurrencyVND, formatDateTimeVN, formatDateVN } from '../utils/currency';
import { TransactionModel } from '../models/transaction.model';

export class TelegramService {
  private static botInstance: TelegramBot | null = null;

  static getBot(): TelegramBot | null {
    if (this.botInstance) {
      return this.botInstance;
    }

    if (!config.telegram.botToken) {
      logger.warn('[Telegram] Chưa cấu hình TELEGRAM_BOT_TOKEN trong .env');
      return null;
    }

    try {
      this.botInstance = new TelegramBot(config.telegram.botToken, { polling: true });
      this.botInstance.on('polling_error', (error: any) => {
        // Ghi log cảnh báo polling nhưng không làm sập ứng dụng
        logger.warn(`[Telegram] Polling notice: ${error.message}`);
      });
      logger.info('[Telegram] Đã kết nối Telegram Bot thành công!');
      return this.botInstance;
    } catch (err: any) {
      logger.error('[Telegram] Lỗi khởi tạo Telegram Bot:', err.message);
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
  static async sendRealtimeTransactionAlert(data: {
    dailyOrderNumber: number;
    pageName: string;
    customerName: string;
    readerName: string;
    amount: number;
    commissionAmount?: number;
    commissionRate?: number;
  }): Promise<boolean> {
    const bot = this.getBot();
    const chatId = config.telegram.managerChatId;
    if (!bot || !chatId) {
      logger.warn('[Telegram] Không thể gửi thông báo (thiếu Bot hoặc TELEGRAM_MANAGER_CHAT_ID)');
      return false;
    }

    const amountFormatted = formatCurrencyVND(data.amount);
    const message = 
`🔔 <b>ĐƠN #${data.dailyOrderNumber} - [PAGE: ${data.pageName}]</b>
👤 Khách: <b>${data.customerName}</b>
🔮 Reader: <b>${data.readerName}</b>
💰 Bill: <b>${amountFormatted}đ</b>`;

    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      logger.info(`[Telegram] Đã bắn thông báo ĐƠN #${data.dailyOrderNumber} vào nhóm chung: ${chatId}`);
      return true;
    } catch (error: any) {
      logger.error(`[Telegram] Lỗi gửi thông báo ĐƠN #${data.dailyOrderNumber}:`, error.message);
      return false;
    }
  }

  /**
   * 2. BÁO CÁO DOANH THU TOÀN HỆ THỐNG CUỐI NGÀY (Gộp tất cả các Page & Reader)
   */
  static generateSystemDailyReportMessage(): string {
    const summary = TransactionModel.getSystemDailySummary();
    const dateFormatted = formatDateVN(new Date());

    let pagesSection = '';

    for (const page of summary.pagesSummary) {
      pagesSection += `📍 <b>${page.page_name}</b>: <b>${formatCurrencyVND(page.page_total_amount)} VNĐ</b> (${page.page_total_count} ca)\n`;
      if (page.readers.length === 0) {
        pagesSection += `   <i>(Chưa có ca nào trong ngày)</i>\n\n`;
      } else {
        for (const reader of page.readers) {
          pagesSection += `   • Reader <b>${reader.reader_name}</b>: ${reader.count} ca ➔ ${formatCurrencyVND(reader.amount)} VNĐ\n`;
        }
        pagesSection += '\n';
      }
    }

    const reportMessage = 
`📊 <b>BÁO CÁO DOANH THU TOÀN HỆ THỐNG NGÀY ${dateFormatted}</b>
━━━━━━━━━━━━━━━━━━━━━
💰 <b>TỔNG DOANH THU TẤT CẢ CÁC PAGE:</b> <b>${formatCurrencyVND(summary.totalRevenueAllPages)} VNĐ</b>
🎯 <b>TỔNG SỐ CA PHỤC VỤ:</b> <b>${summary.totalOrdersAllPages} ca</b>
━━━━━━━━━━━━━━━━━━━━━
<b>CHI TIẾT THEO TỪNG PAGE:</b>

${pagesSection.trim()}`;

    return reportMessage;
  }

  static async sendSystemDailyReport(targetChatId?: string): Promise<boolean> {
    const bot = this.getBot();
    const chatId = targetChatId || config.telegram.managerChatId;
    if (!bot || !chatId) return false;

    const message = this.generateSystemDailyReportMessage();
    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      logger.info(`[Telegram] Đã gửi báo cáo tổng hợp hệ thống tới: ${chatId}`);
      return true;
    } catch (error: any) {
      logger.error(`[Telegram] Lỗi gửi báo cáo tổng hợp:`, error.message);
      return false;
    }
  }
}
