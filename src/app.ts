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

  // Endpoint Chính sách quyền riêng tư (Bắt buộc cho Meta App Live Mode)
  app.get('/privacy', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <title>Chính Sách Quyền Riêng Tư - DT Tarot</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
          h1 { color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px; }
          h2 { color: #34495e; margin-top: 30px; }
          p { margin: 10px 0; }
        </style>
      </head>
      <body>
        <h1>Chính Sách Quyền Riêng Tư (Privacy Policy)</h1>
        <p><strong>Ngày có hiệu lực:</strong> 01/01/2026</p>
        <p>Hệ thống <strong>DT Tarot</strong> (vận hành cho Fanpage và Instagram Tarot Chips) cam kết bảo vệ quyền riêng tư và bảo mật thông tin của khách hàng.</p>
        
        <h2>1. Thông tin chúng tôi thu thập</h2>
        <p>- Thông tin tài khoản công khai (Tên người dùng, ID cuộc trò chuyện) khi bạn nhắn tin tới Fanpage hoặc Instagram của chúng tôi.</p>
        <p>- Hình ảnh hóa đơn/chứng từ chuyển khoản ngân hàng do khách hàng chủ động gửi để xác nhận thanh toán đặt lịch xem bài Tarot.</p>

        <h2>2. Mục đích sử dụng thông tin</h2>
        <p>- Tự động xác thực số tiền chuyển khoản của khách hàng để kích hoạt và xác nhận lịch hẹn xem bài Tarot.</p>
        <p>- Ghi nhận doanh thu nội bộ và đối soát đơn hàng cho các Reader trong hệ thống.</p>
        <p>- Hỗ trợ khách hàng trong suốt quá trình trải nghiệm dịch vụ.</p>

        <h2>3. Bảo mật thông tin</h2>
        <p>Chúng tôi tuyệt đối không chia sẻ, bán hoặc chuyển giao dữ liệu cá nhân của khách hàng cho bất kỳ bên thứ ba nào vì mục đích quảng cáo hay thương mại. Mọi dữ liệu được bảo vệ an toàn theo tiêu chuẩn bảo mật của Meta Platform.</p>

        <h2>4. Quyền của người dùng & Xóa dữ liệu</h2>
        <p>Khách hàng có quyền yêu cầu xóa bất kỳ dữ liệu nào liên quan đến thông tin cá nhân của mình bằng cách liên hệ trực tiếp qua hộp thư Fanpage Tarot Chips hoặc gửi email tới ban quản trị.</p>

        <h2>5. Liên hệ</h2>
        <p>Nếu bạn có bất kỳ câu hỏi nào về chính sách bảo mật này, vui lòng nhắn tin trực tiếp tới Fanpage <strong>Tarot Chips</strong>.</p>
      </body>
      </html>
    `);
  });

  // Điều khoản dịch vụ (Terms of Service)
  app.get('/terms', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <title>Điều Khoản Dịch Vụ - DT Tarot</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
          h1 { color: #2c3e50; }
        </style>
      </head>
      <body>
        <h1>Điều Khoản Dịch Vụ (Terms of Service)</h1>
        <p>Chào mừng bạn đến với dịch vụ của <strong>DT Tarot</strong>. Khi đặt lịch xem bài Tarot qua Fanpage hoặc Instagram của chúng tôi, bạn đồng ý với các điều khoản đặt lịch và thanh toán của chúng tôi.</p>
      </body>
      </html>
    `);
  });

  // Hướng dẫn xóa dữ liệu (User Data Deletion Callback)
  app.get('/data-deletion', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="vi">
      <head><meta charset="UTF-8"><title>Xóa Dữ Liệu - DT Tarot</title></head>
      <body style="font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px;">
        <h1>Hướng Dẫn Xóa Dữ Liệu Người Dùng</h1>
        <p>Theo quy định bảo mật của Meta, nếu bạn muốn yêu cầu xóa dữ liệu của mình khỏi hệ thống DT Tarot, vui lòng làm theo các bước sau:</p>
        <ol>
          <li>Gửi tin nhắn trực tiếp tới Fanpage <strong>Tarot Chips</strong> với cú pháp: "Yêu cầu xóa dữ liệu".</li>
          <li>Quản trị viên sẽ phản hồi và tiến hành xóa toàn bộ lịch sử đơn hàng và dữ liệu của bạn trong vòng 24 giờ.</li>
        </ol>
      </body>
      </html>
    `);
  });

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
