"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDailyReportCron = startDailyReportCron;
exports.executeDailyReports = executeDailyReports;
const node_cron_1 = __importDefault(require("node-cron"));
const telegram_service_1 = require("../services/telegram.service");
const reconciliation_service_1 = require("../services/reconciliation.service");
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
/**
 * Khởi chạy Cron Job tự động chạy lúc 23:00 hàng ngày
 */
function startDailyReportCron() {
    // "0 23 * * *" = Đúng 23:00 mỗi tối
    node_cron_1.default.schedule('0 23 * * *', async () => {
        logger_1.logger.info('⏰ [CRON] Bắt đầu tự động rà soát bill Meta và tổng hợp Báo Cáo Doanh Thu Cuối Ngày lúc 23:00...');
        try {
            // 1. Tự động rà soát bill trên Meta trước để bù bill bị lỡ (nếu có)
            await reconciliation_service_1.ReconciliationService.runReconciliation(false);
        }
        catch (recErr) {
            logger_1.logger.error('[CRON] Lỗi khi chạy rà soát bill tự động:', recErr.message);
        }
        // 2. Gửi báo cáo doanh thu cuối ngày chính xác 100%
        await executeDailyReports();
    }, {
        scheduled: true,
        timezone: config_1.config.timezone
    });
    logger_1.logger.info(`[CRON] Đã lên lịch tự động tổng kết doanh thu lúc 23:00 hàng ngày (Timezone: ${config_1.config.timezone})`);
}
/**
 * Thực thi tổng hợp và gửi Báo Cáo Toàn Hệ Thống về nhóm Telegram chung duy nhất
 */
async function executeDailyReports() {
    if (config_1.config.telegram.managerChatId) {
        try {
            await telegram_service_1.TelegramService.sendSystemDailyReport(config_1.config.telegram.managerChatId);
            logger_1.logger.info('[CRON] Đã gửi báo cáo tổng hợp toàn hệ thống cho nhóm chung!');
        }
        catch (err) {
            logger_1.logger.error('[CRON] Lỗi gửi báo cáo tổng hợp cuối ngày:', err.message);
        }
    }
}
