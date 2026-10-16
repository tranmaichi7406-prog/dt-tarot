import { Request, Response } from 'express';
import { PageModel } from '../models/page.model';
import { config } from '../config';

export class HealthController {
  static getStatus(req: Request, res: Response): void {
    const pages = PageModel.getAll();
    res.json({
      status: 'ONLINE',
      system: 'DT Tarot Multi-tenant Backend (Meta Business)',
      version: '1.0.0',
      nodeEnv: config.nodeEnv,
      timezone: config.timezone,
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
