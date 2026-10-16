import { db } from '../database/db';
import { Page } from '../types';

export class PageModel {
  static getById(id: number): Page | undefined {
    const stmt = db.prepare('SELECT * FROM pages WHERE id = ?');
    return stmt.get(id) as unknown as Page | undefined;
  }

  static getByFbPageId(fbPageId: string): Page | undefined {
    const stmt = db.prepare('SELECT * FROM pages WHERE fb_page_id = ?');
    const exact = stmt.get(fbPageId) as unknown as Page | undefined;
    if (exact) return exact;

    // Fallback đa nền tảng: Nếu chỉ có 1 Page trong hệ thống, nhận luôn cho cả Instagram Direct & Facebook
    const all = this.getAll();
    if (all.length === 1) {
      return all[0];
    }

    return undefined;
  }

  static getAll(): Page[] {
    const stmt = db.prepare('SELECT * FROM pages ORDER BY id ASC');
    return stmt.all() as unknown as Page[];
  }

  static getByName(pageName: string): Page | undefined {
    const stmt = db.prepare('SELECT * FROM pages WHERE LOWER(page_name) = LOWER(?)');
    return stmt.get(pageName) as unknown as Page | undefined;
  }

  static create(data: {
    page_name: string;
    fb_page_id: string;
    access_token: string;
    telegram_group_id?: string;
  }): Page {
    const stmt = db.prepare(`
      INSERT INTO pages (page_name, fb_page_id, access_token, telegram_group_id)
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(
      data.page_name,
      data.fb_page_id,
      data.access_token,
      data.telegram_group_id || ''
    );
    return this.getById(Number(info.lastInsertRowid))!;
  }

  static deleteByName(name: string): boolean {
    const stmt = db.prepare('DELETE FROM pages WHERE LOWER(page_name) = LOWER(?)');
    const result = stmt.run(name);
    return (result.changes || 0) > 0;
  }

  static updateToken(id: number, newToken: string): void {
    const stmt = db.prepare('UPDATE pages SET access_token = ? WHERE id = ?');
    stmt.run(newToken, id);
  }
}
