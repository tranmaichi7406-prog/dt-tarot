import { createApp } from './app';
import { config } from './config';
import { initDatabase } from './database/db';
import { setupTelegramBotCommands } from './bot/telegram.bot';
import { startDailyReportCron } from './cron/daily-report.cron';
import { logger } from './utils/logger';

async function bootstrap() {
  try {
    logger.info('🚀 Đang khởi động hệ thống DT Tarot Backend...');

    // 1. Khởi tạo cơ sở dữ liệu SQLite
    initDatabase();

    // 2. Kích hoạt Telegram Bot & các lệnh tương tác
    setupTelegramBotCommands();

    // 3. Khởi động Cron Job sao kê tự động lúc 23:00 hàng ngày
    startDailyReportCron();

    // 4. Khởi chạy HTTP Server Express
    const app = createApp();
    const server = app.listen(config.port, () => {
      logger.info(`✨ Server đang chạy tại port ${config.port} (Mode: ${config.nodeEnv})`);
      logger.info(`🔗 Webhook URL: http://localhost:${config.port}/webhook`);
      logger.info(`💡 Xem báo cáo & quản trị tại Telegram Bot`);
    });

    // Xử lý ngắt tiến trình (Graceful Shutdown)
    const gracefulShutdown = () => {
      logger.info('🛑 Nhận tín hiệu dừng máy chủ, đang đóng các kết nối...');
      server.close(() => {
        logger.info('✅ Đã tắt máy chủ thành công.');
        process.exit(0);
      });
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);

  } catch (error: any) {
    logger.error('❌ Lỗi nghiêm trọng khi khởi động server:', error.stack || error.message);
    process.exit(1);
  }
}

bootstrap();
