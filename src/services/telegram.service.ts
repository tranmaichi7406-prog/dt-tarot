import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { logger } from '../utils/logger';
import { formatCurrencyVND, formatDateTimeVN, formatDateVN } from '../utils/currency';
import { TransactionModel } from '../models/transaction.model';
import { GoogleSheetsService } from './sheets.service';

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
    platform?: string;
  }): Promise<boolean> {
    const bot = this.getBot();
    const chatId = config.telegram.managerChatId;
    if (!bot || !chatId) {
      logger.warn('[Telegram] Không thể gửi thông báo (thiếu Bot hoặc TELEGRAM_MANAGER_CHAT_ID)');
      return false;
    }

    const amountFormatted = formatCurrencyVND(data.amount);
    const platformStr = data.platform ? `\n📱 Nguồn: <b>${data.platform}</b>` : '';
    const message = 
`🔔 <b>ĐƠN #${data.dailyOrderNumber} - [PAGE: ${data.pageName}]</b>
👤 Khách: <b>${data.customerName}</b>
🔮 Reader: <b>${data.readerName}</b>
💰 Bill: <b>${amountFormatted}đ</b>${platformStr}`;

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
   * Thông báo khi ảnh bill bị trùng (đã ghi nhận trước đó)
   */
  static async sendDuplicateAlert(customerName: string, transactionCode: string, amount: number): Promise<void> {
    const bot = this.getBot();
    const chatId = config.telegram.managerChatId;
    if (!bot || !chatId) return;

    const message = 
`⚠️ <b>CẢNH BÁO TRÙNG BILL</b>
👤 Khách: <b>${customerName}</b>
💰 Số tiền: <b>${formatCurrencyVND(amount)}đ</b>
🔖 Mã GD: <code>${transactionCode}</code>
<i>(Đơn này đã được ghi nhận trước đó. Hệ thống bỏ qua để tránh cộng trùng doanh thu)</i>`;

    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch {}
  }

  /**
   * Cảnh báo khi khách gửi ảnh nhưng OCR không đọc được số tiền
   */
  static async sendOcrFailedAlert(customerName: string): Promise<void> {
    const bot = this.getBot();
    const chatId = config.telegram.managerChatId;
    if (!bot || !chatId) return;

    const message = 
`⚠️ <b>KHÔNG ĐỌC ĐƯỢC BILL</b>
👤 Khách: <b>${customerName}</b>
<i>(Ảnh mờ hoặc không nhận diện được số tiền hợp lệ. Vui lòng kiểm tra lại tin nhắn)</i>`;

    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch {}
  }

  /**
   * 2. BÁO CÁO DOANH THU TOÀN HỆ THỐNG CUỐI NGÀY (Lấy chuẩn 100% từ Google Sheets tab Data)
   */
  static async generateSystemDailyReportMessage(): Promise<string> {
    const dateFormatted = formatDateVN(new Date());

    // 1. Đọc trực tiếp từ Google Sheets tab Data để báo cáo luôn luôn chuẩn xác
    const sheetRows = await GoogleSheetsService.getRowsByDate(dateFormatted);

    if (sheetRows.length > 0) {
      let totalRevenue = 0;
      let totalOrders = sheetRows.length;

      // Gom nhóm theo Page và Reader
      const pageMap = new Map<string, {
        totalAmount: number;
        readers: Map<string, { count: number; amount: number }>;
      }>();

      for (const row of sheetRows) {
        totalRevenue += row.amount;
        const pageKey = row.pageName || 'tarotchips03';
        if (!pageMap.has(pageKey)) {
          pageMap.set(pageKey, { totalAmount: 0, readers: new Map() });
        }
        const pData = pageMap.get(pageKey)!;
        pData.totalAmount += row.amount;

        const readerKey = row.readerName || 'Chưa gán Reader';
        if (!pData.readers.has(readerKey)) {
          pData.readers.set(readerKey, { count: 0, amount: 0 });
        }
        const rData = pData.readers.get(readerKey)!;
        rData.count += 1;
        rData.amount += row.amount;
      }

      let pagesSection = '';
      for (const [pName, pData] of pageMap.entries()) {
        const orderCount = Array.from(pData.readers.values()).reduce((sum, r) => sum + r.count, 0);
        pagesSection += `📍 <b>${pName}</b>: <b>${formatCurrencyVND(pData.totalAmount)} VNĐ</b> (${orderCount} ca)\n`;
        for (const [rName, rData] of pData.readers.entries()) {
          pagesSection += `   • Reader <b>${rName}</b>: ${rData.count} ca ➔ ${formatCurrencyVND(rData.amount)} VNĐ\n`;
        }
        pagesSection += '\n';
      }

      return `📊 <b>BÁO CÁO DOANH THU TOÀN HỆ THỐNG NGÀY ${dateFormatted}</b>
━━━━━━━━━━━━━━━━━━━━━
💰 <b>TỔNG DOANH THU TẤT CẢ CÁC PAGE:</b> <b>${formatCurrencyVND(totalRevenue)} VNĐ</b>
🎯 <b>TỔNG SỐ CA PHỤC VỤ:</b> <b>${totalOrders} ca</b>
━━━━━━━━━━━━━━━━━━━━━
<b>CHI TIẾT THEO TỪNG PAGE:</b>

${pagesSection.trim()}`;
    }

    // 2. Fallback sang SQLite nếu Sheets chưa có dòng nào
    const summary = TransactionModel.getSystemDailySummary();
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

    return `📊 <b>BÁO CÁO DOANH THU TOÀN HỆ THỐNG NGÀY ${dateFormatted}</b>
━━━━━━━━━━━━━━━━━━━━━
💰 <b>TỔNG DOANH THU TẤT CẢ CÁC PAGE:</b> <b>${formatCurrencyVND(summary.totalRevenueAllPages)} VNĐ</b>
🎯 <b>TỔNG SỐ CA PHỤC VỤ:</b> <b>${summary.totalOrdersAllPages} ca</b>
━━━━━━━━━━━━━━━━━━━━━
<b>CHI TIẾT THEO TỪNG PAGE:</b>

${pagesSection.trim()}`;
  }

  static async sendSystemDailyReport(targetChatId?: string): Promise<boolean> {
    const bot = this.getBot();
    const chatId = targetChatId || config.telegram.managerChatId;
    if (!bot || !chatId) return false;

    const message = await this.generateSystemDailyReportMessage();
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
