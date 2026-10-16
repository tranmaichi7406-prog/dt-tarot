import express, { Application, Request, Response } from 'express';
import { WebhookController } from './controllers/webhook.controller';
import { HealthController } from './controllers/health.controller';
import { verifyMetaSignature } from './middlewares/meta-security.middleware';
import { errorHandler } from './middlewares/error.middleware';

export function createApp(): Application {
  const app = express();

  // Middleware lưu lại rawBody dạng Buffer để tính toán chữ ký HMAC SHA256 của Meta
  app.use(express.json({
    verify: (req: Request, _res: Response, buf: Buffer) => {
      (req as any).rawBody = buf;
    }
  }));

  app.use(express.urlencoded({ extended: true }));

  // Endpoint kiểm tra trạng thái máy chủ
  app.get('/', HealthController.getStatus);
  app.get('/health', HealthController.getStatus);

  // Meta Webhook Endpoints
  // GET: Meta xác thực Webhook Token
  app.get('/webhook', WebhookController.verifyWebhook);

  // POST: Tiếp nhận sự kiện Instagram (Kiểm tra chữ ký Meta x-hub-signature-256)
  app.post('/webhook', verifyMetaSignature, WebhookController.handleWebhook);

  // Telegram Webhook Endpoint (Nhận lệnh từ Telegram không bao giờ bị conflict polling)
  app.post('/telegram-webhook', (req: Request, res: Response) => {
    try {
      const { TelegramService } = require('./services/telegram.service');
      const bot = TelegramService.getBot();
      if (bot && req.body) {
        bot.processUpdate(req.body);
      }
    } catch (err: any) {
      console.error('[TelegramWebhook] Error:', err.message);
    }
    res.sendStatus(200);
  });

  // Xử lý lỗi tập trung
  app.use(errorHandler);

  return app;
}
