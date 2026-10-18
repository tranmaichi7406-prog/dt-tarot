"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const app_1 = require("./app");
const config_1 = require("./config");
const db_1 = require("./database/db");
const telegram_bot_1 = require("./bot/telegram.bot");
const daily_report_cron_1 = require("./cron/daily-report.cron");
const heartbeat_service_1 = require("./services/heartbeat.service");
const logger_1 = require("./utils/logger");
async function bootstrap() {
    try {
        logger_1.logger.info('🚀 Đang khởi động hệ thống DT Tarot Backend...');
        // 1. Khởi tạo cơ sở dữ liệu SQLite
        (0, db_1.initDatabase)();
        // 2. Kích hoạt Telegram Bot & các lệnh tương tác
        (0, telegram_bot_1.setupTelegramBotCommands)();
        // 2.1 Bật cập nhật trạng thái trực tuyến 24/7 trên tin nhắn ghim nhóm
        heartbeat_service_1.HeartbeatService.startHeartbeat(3);
        // 3. Khởi động Cron Job sao kê tự động lúc 23:00 hàng ngày
        (0, daily_report_cron_1.startDailyReportCron)();
        // 4. Khởi chạy HTTP Server Express
        const app = (0, app_1.createApp)();
        const server = app.listen(config_1.config.port, () => {
            logger_1.logger.info(`✨ Server đang chạy tại port ${config_1.config.port} (Mode: ${config_1.config.nodeEnv})`);
            logger_1.logger.info(`🔗 Webhook URL: http://localhost:${config_1.config.port}/webhook`);
            logger_1.logger.info(`💡 Xem báo cáo & quản trị tại Telegram Bot`);
        });
        // 5. Keep-Alive: Tự động ping mỗi 10 phút để Render không bao giờ ngủ (24/7 online)
        const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'https://dt-tarot.onrender.com';
        setInterval(async () => {
            try {
                await axios_1.default.get(`${RENDER_EXTERNAL_URL}/health`, { timeout: 10000 });
                logger_1.logger.debug('[KeepAlive] Tự động ping máy chủ giữ online 24/7 thành công.');
            }
            catch (err) {
                logger_1.logger.warn(`[KeepAlive] Ping cảnh báo: ${err.message}`);
            }
        }, 10 * 60 * 1000);
        // Xử lý ngắt tiến trình (Graceful Shutdown)
        const gracefulShutdown = () => {
            logger_1.logger.info('🛑 Nhận tín hiệu dừng máy chủ, đang đóng các kết nối...');
            server.close(() => {
                logger_1.logger.info('✅ Đã tắt máy chủ thành công.');
                process.exit(0);
            });
        };
        process.on('SIGINT', gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);
    }
    catch (error) {
        logger_1.logger.error('❌ Lỗi nghiêm trọng khi khởi động server:', error.stack || error.message);
        process.exit(1);
    }
}
bootstrap();
