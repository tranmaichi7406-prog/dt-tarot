import axios from 'axios';
import { createApp } from './app';
import { config } from './config';
import { initDatabase } from './database/db';
import { setupTelegramBotCommands } from './bot/telegram.bot';
import { startDailyReportCron } from './cron/daily-report.cron';
import { HeartbeatService } from './services/heartbeat.service';
import { logger } from './utils/logger';

async function bootstrap() {
  try {
    logger.info('🚀 Đang khởi động hệ thống DT Tarot Backend...');

    // 1. Khởi tạo cơ sở dữ liệu SQLite
    initDatabase();

    // 2. Kích hoạt Telegram Bot & các lệnh tương tác
    setupTelegramBotCommands();

    // 2.1 Bật cập nhật trạng thái trực tuyến 24/7 trên tin nhắn ghim nhóm
    HeartbeatService.startHeartbeat(3);

    // 3. Khởi động Cron Job sao kê tự động lúc 23:00 hàng ngày
    startDailyReportCron();

    // 4. Khởi chạy HTTP Server Express
    const app = createApp();
    const server = app.listen(config.port, () => {
      logger.info(`✨ Server đang chạy tại port ${config.port} (Mode: ${config.nodeEnv})`);
      logger.info(`🔗 Webhook URL: http://localhost:${config.port}/webhook`);
      logger.info(`💡 Xem báo cáo & quản trị tại Telegram Bot`);
    });

    // 5. Keep-Alive: Tự động ping mỗi 10 phút để Render không bao giờ ngủ (24/7 online)
    const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'https://dt-tarot.onrender.com';
    setInterval(async () => {
      try {
        await axios.get(`${RENDER_EXTERNAL_URL}/health`, { timeout: 10000 });
        logger.debug('[KeepAlive] Tự động ping máy chủ giữ online 24/7 thành công.');
      } catch (err: any) {
        logger.warn(`[KeepAlive] Ping cảnh báo: ${err.message}`);
      }
    }, 10 * 60 * 1000);

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
