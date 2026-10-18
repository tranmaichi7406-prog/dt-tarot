"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const page_model_1 = require("../models/page.model");
const config_1 = require("../config");
class HealthController {
    static getStatus(req, res) {
        const pages = page_model_1.PageModel.getAll();
        res.json({
            status: 'ONLINE',
            system: 'DT Tarot Multi-tenant Backend (Meta Business)',
            version: '1.0.0',
            nodeEnv: config_1.config.nodeEnv,
            timezone: config_1.config.timezone,
            uptimeSeconds: process.uptime(),
            stats: {
                totalPages: pages.length,
                pages: pages.map(p => ({
                    id: p.id,
                    name: p.page_name,
                    fb_page_id: p.fb_page_id,
                    has_telegram_group: Boolean(p.telegram_group_id)
                }))
            }
        });
    }
}
exports.HealthController = HealthController;
