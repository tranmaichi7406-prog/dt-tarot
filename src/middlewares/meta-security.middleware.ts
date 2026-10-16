import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Middleware xác thực chữ ký Meta Webhook (x-hub-signature-256)
 * Tuân thủ nghiêm ngặt tiêu chuẩn bảo mật của Meta Business API
 */
export function verifyMetaSignature(req: Request, res: Response, next: NextFunction): void {
  // Bỏ qua kiểm tra chữ ký nếu là request GET xác thực webhook
  if (req.method === 'GET') {
    return next();
  }

  // Nếu chưa cấu hình APP_SECRET trong môi trường development, cảnh báo và cho qua
  if (!config.meta.appSecret) {
    if (config.nodeEnv === 'production') {
      logger.error('[Security] META_APP_SECRET chưa được cấu hình trong môi trường Production!');
      res.status(500).json({ error: 'Server security misconfiguration' });
      return;
    }
    return next();
  }

  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) {
    logger.warn('[Security] Từ chối request: Thiếu header x-hub-signature-256');
    res.status(401).json({ error: 'Missing x-hub-signature-256 header' });
    return;
  }

  try {
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      logger.error('[Security] Không tìm thấy rawBody để xác thực chữ ký');
      res.status(500).json({ error: 'Raw body missing' });
      return;
    }

    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', config.meta.appSecret)
      .update(rawBody)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      logger.warn('[Security] Chữ ký x-hub-signature-256 không hợp lệ!');
      res.status(403).json({ error: 'Invalid webhook signature' });
      return;
    }

    next();
  } catch (error: any) {
    logger.error('[Security] Lỗi trong quá trình xác thực chữ ký Meta:', error.message);
    res.status(403).json({ error: 'Signature verification failed' });
  }
}
