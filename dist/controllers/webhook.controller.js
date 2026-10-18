"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookController = void 0;
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const webhook_service_1 = require("../services/webhook.service");
class WebhookController {
    /**
     * GET /webhook: Meta Webhook Verification
     * Meta gửi GET request kèm hub.mode, hub.verify_token, hub.challenge để xác thực endpoint
     */
    static verifyWebhook(req, res) {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode && token) {
            if (mode === 'subscribe' && token === config_1.config.meta.verifyToken) {
                logger_1.logger.info('[MetaWebhook] Xác thực Webhook thành công!');
                res.status(200).send(challenge);
                return;
            }
            else {
                logger_1.logger.warn('[MetaWebhook] Xác thực thất bại: Verify Token không khớp!');
                res.sendStatus(403);
                return;
            }
        }
        res.status(400).send('Missing webhook verification parameters');
    }
    /**
     * POST /webhook: Tiếp nhận sự kiện từ Instagram Messaging
     */
    static async handleWebhook(req, res) {
        const payload = req.body;
        // Phản hồi 200 OK ngay lập tức cho Meta để tránh timeout (tiêu chuẩn Meta < 5s)
        res.status(200).send('EVENT_RECEIVED');
        if (!payload || (payload.object !== 'instagram' && payload.object !== 'page' && payload.object !== 'threads')) {
            logger_1.logger.debug('[MetaWebhook] Bỏ qua payload không thuộc instagram/page/threads:', payload?.object);
            return;
        }
        // Xử lý các sự kiện bất đồng bộ ở background
        if (Array.isArray(payload.entry)) {
            for (const entry of payload.entry) {
                const entryPageId = entry.id;
                const events = entry.messaging || entry.standby || [];
                for (const event of events) {
                    try {
                        await webhook_service_1.WebhookService.handleMessagingEvent(event, entryPageId, payload.object);
                    }
                    catch (eventErr) {
                        logger_1.logger.error('[MetaWebhook] Lỗi xử lý sự kiện messaging:', eventErr.message);
                    }
                }
            }
        }
    }
}
exports.WebhookController = WebhookController;
