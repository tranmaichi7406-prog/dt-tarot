"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageModel = void 0;
const db_1 = require("../database/db");
class PageModel {
    static getById(id) {
        const stmt = db_1.db.prepare('SELECT * FROM pages WHERE id = ?');
        return stmt.get(id);
    }
    static getByFbPageId(fbPageId) {
        const stmt = db_1.db.prepare('SELECT * FROM pages WHERE fb_page_id = ?');
        const exact = stmt.get(fbPageId);
        if (exact)
            return exact;
        // Nhận diện theo Instagram Business Account ID của Tarot Chips
        if (fbPageId === '17841436212431682') {
            const tarot = stmt.get('992148840643936');
            if (tarot)
                return tarot;
        }
        // Fallback đa nền tảng: Luôn chọn Page chính nếu có trong hệ thống
        const all = this.getAll();
        if (all.length > 0) {
            return all[0];
        }
        return undefined;
    }
    static getAll() {
        const stmt = db_1.db.prepare('SELECT * FROM pages ORDER BY id ASC');
        return stmt.all();
    }
    static getByName(pageName) {
        const stmt = db_1.db.prepare('SELECT * FROM pages WHERE LOWER(page_name) = LOWER(?)');
        return stmt.get(pageName);
    }
    static create(data) {
        const stmt = db_1.db.prepare(`
      INSERT INTO pages (page_name, fb_page_id, access_token, telegram_group_id)
      VALUES (?, ?, ?, ?)
    `);
        const info = stmt.run(data.page_name, data.fb_page_id, data.access_token, data.telegram_group_id || '');
        return this.getById(Number(info.lastInsertRowid));
    }
    static deleteByName(name) {
        const stmt = db_1.db.prepare('DELETE FROM pages WHERE LOWER(page_name) = LOWER(?)');
        const result = stmt.run(name);
        return (result.changes || 0) > 0;
    }
    static updateToken(id, newToken) {
        const stmt = db_1.db.prepare('UPDATE pages SET access_token = ? WHERE id = ?');
        stmt.run(newToken, id);
    }
}
exports.PageModel = PageModel;
