import { Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { WebhookService } from '../services/webhook.service';
import { MetaWebhookPayload } from '../types/meta';

export class WebhookController {
  /**
   * GET /webhook: Meta Webhook Verification
   * Meta gửi GET request kèm hub.mode, hub.verify_token, hub.challenge để xác thực endpoint
   */
  static verifyWebhook(req: Request, res: Response): void {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === config.meta.verifyToken) {
        logger.info('[MetaWebhook] Xác thực Webhook thành công!');
        res.status(200).send(challenge);
        return;
      } else {
        logger.warn('[MetaWebhook] Xác thực thất bại: Verify Token không khớp!');
        res.sendStatus(403);
        return;
      }
    }

    res.status(400).send('Missing webhook verification parameters');
  }

  /**
   * POST /webhook: Tiếp nhận sự kiện từ Instagram Messaging
   */
  static async handleWebhook(req: Request, res: Response): Promise<void> {
    const payload = req.body as MetaWebhookPayload;

    // Phản hồi 200 OK ngay lập tức cho Meta để tránh timeout (tiêu chuẩn Meta < 5s)
    res.status(200).send('EVENT_RECEIVED');

    if (!payload || (payload.object !== 'instagram' && payload.object !== 'page')) {
      logger.debug('[MetaWebhook] Bỏ qua payload không thuộc instagram/page:', payload?.object);
      return;
    }

    // Xử lý các sự kiện bất đồng bộ ở background
    if (Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        const entryPageId = entry.id;
        const events = entry.messaging || entry.standby || [];

        for (const event of events) {
          try {
            await WebhookService.handleMessagingEvent(event, entryPageId);
          } catch (eventErr: any) {
            logger.error('[MetaWebhook] Lỗi xử lý sự kiện messaging:', eventErr.message);
          }
        }
      }
    }
  }
}
