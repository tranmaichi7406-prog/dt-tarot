"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReaderModel = void 0;
const db_1 = require("../database/db");
class ReaderModel {
    static getById(id) {
        const stmt = db_1.db.prepare('SELECT * FROM readers WHERE id = ?');
        return stmt.get(id);
    }
    static getByName(name) {
        const stmt = db_1.db.prepare('SELECT * FROM readers WHERE LOWER(reader_name) = LOWER(?)');
        return stmt.get(name);
    }
    static getByPageId(pageId) {
        const stmt = db_1.db.prepare('SELECT * FROM readers WHERE page_id = ? ORDER BY id ASC');
        return stmt.all(pageId);
    }
    static getAll() {
        const stmt = db_1.db.prepare('SELECT * FROM readers ORDER BY id ASC');
        return stmt.all();
    }
    static create(data) {
        const stmt = db_1.db.prepare(`
      INSERT INTO readers (page_id, reader_name, tag_prefix, commission_rate)
      VALUES (?, ?, ?, ?)
    `);
        const rate = data.commission_rate !== undefined ? data.commission_rate : 0.0;
        const info = stmt.run(data.page_id, data.reader_name, data.tag_prefix, rate);
        return this.getById(Number(info.lastInsertRowid));
    }
    static deleteByName(name) {
        const stmt = db_1.db.prepare('DELETE FROM readers WHERE LOWER(reader_name) = LOWER(?)');
        const result = stmt.run(name);
        return (result.changes || 0) > 0;
    }
    static updateTagPrefix(name, newTagPrefix) {
        const stmt = db_1.db.prepare('UPDATE readers SET tag_prefix = ? WHERE LOWER(reader_name) = LOWER(?)');
        const result = stmt.run(newTagPrefix, name);
        return (result.changes || 0) > 0;
    }
    /**
     * Quét nhận diện Reader từ tin nhắn rep khách:
     * 1. Kiểm tra các Reader có ký tự nhận diện (ví dụ: Chi có dấu '.', hoặc [Tên]...)
     * 2. Nếu không khớp ký tự của ai -> Tự động nhận diện cho Reader được đặt là "không ký tự" (mặc định là NA)
     */
    static findByTagInMessage(pageId, text) {
        if (!text)
            return null;
        const readers = this.getByPageId(pageId);
        if (readers.length === 0)
            return null;
        const trimmed = text.trim();
        const normalized = text.toLowerCase();
        // 1. Quét các Reader có cài đặt ký tự riêng (khác rỗng và khác 'none')
        const readersWithTags = readers.filter(r => r.tag_prefix && r.tag_prefix.trim() !== '' && r.tag_prefix.toLowerCase() !== 'none' && r.tag_prefix.toLowerCase() !== 'khong');
        for (const reader of readersWithTags) {
            const tag = reader.tag_prefix.trim();
            // Nếu là dấu câu ở cuối câu (ví dụ dấu '.')
            if (tag === '.' || tag === ',' || tag === '!' || tag === '*' || tag === '-') {
                if (trimmed.endsWith(tag)) {
                    return reader;
                }
            }
            else {
                // Tag chữ hoặc ký hiệu (ví dụ [Chi], Chi:, ...)
                if (trimmed.endsWith(tag) || normalized.includes(tag.toLowerCase())) {
                    return reader;
                }
            }
        }
        // 2. Không khớp ký tự của ai -> Gán cho Reader không có ký tự (mặc định là NA)
        const defaultNoTagReader = readers.find(r => !r.tag_prefix || r.tag_prefix.trim() === '' || r.tag_prefix.toLowerCase() === 'none' || r.tag_prefix.toLowerCase() === 'khong');
        if (defaultNoTagReader) {
            return defaultNoTagReader;
        }
        // Fallback: nếu chưa ai được đặt rỗng, tìm reader tên NA
        const naReader = readers.find(r => r.reader_name.toLowerCase() === 'na');
        if (naReader) {
            return naReader;
        }
        return readers[0] || null;
    }
}
exports.ReaderModel = ReaderModel;
