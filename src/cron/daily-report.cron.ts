import cron from 'node-cron';
import { TelegramService } from '../services/telegram.service';
import { ReconciliationService } from '../services/reconciliation.service';
import { logger } from '../utils/logger';
import { config } from '../config';

/**
 * Khởi chạy Cron Job tự động chạy lúc 23:00 hàng ngày
 */
export function startDailyReportCron(): void {
  // "0 23 * * *" = Đúng 23:00 mỗi tối
  cron.schedule('0 23 * * *', async () => {
    logger.info('⏰ [CRON] Bắt đầu tự động rà soát bill Meta và tổng hợp Báo Cáo Doanh Thu Cuối Ngày lúc 23:00...');
    try {
      // 1. Tự động rà soát bill trên Meta trước để bù bill bị lỡ (nếu có)
      await ReconciliationService.runReconciliation(false);
    } catch (recErr: any) {
      logger.error('[CRON] Lỗi khi chạy rà soát bill tự động:', recErr.message);
    }

    // 2. Gửi báo cáo doanh thu cuối ngày chính xác 100%
    await executeDailyReports();
  }, {
    scheduled: true,
    timezone: config.timezone
  });

  logger.info(`[CRON] Đã lên lịch tự động tổng kết doanh thu lúc 23:00 hàng ngày (Timezone: ${config.timezone})`);
}

/**
 * Thực thi tổng hợp và gửi Báo Cáo Toàn Hệ Thống về nhóm Telegram chung duy nhất
 */
export async function executeDailyReports(): Promise<void> {
  if (config.telegram.managerChatId) {
    try {
      await TelegramService.sendSystemDailyReport(config.telegram.managerChatId);
      logger.info('[CRON] Đã gửi báo cáo tổng hợp toàn hệ thống cho nhóm chung!');
    } catch (err: any) {
      logger.error('[CRON] Lỗi gửi báo cáo tổng hợp cuối ngày:', err.message);
    }
  }
}
