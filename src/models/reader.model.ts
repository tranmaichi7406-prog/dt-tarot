import { db } from '../database/db';
import { Reader } from '../types';

export class ReaderModel {
  static getById(id: number): Reader | undefined {
    const stmt = db.prepare('SELECT * FROM readers WHERE id = ?');
    return stmt.get(id) as unknown as Reader | undefined;
  }

  static getByName(name: string): Reader | undefined {
    const stmt = db.prepare('SELECT * FROM readers WHERE LOWER(reader_name) = LOWER(?)');
    return stmt.get(name) as unknown as Reader | undefined;
  }

  static getByPageId(pageId: number): Reader[] {
    const stmt = db.prepare('SELECT * FROM readers WHERE page_id = ? ORDER BY id ASC');
    return stmt.all(pageId) as unknown as Reader[];
  }

  static getAll(): Reader[] {
    const stmt = db.prepare('SELECT * FROM readers ORDER BY id ASC');
    return stmt.all() as unknown as Reader[];
  }

  static create(data: {
    page_id: number;
    reader_name: string;
    tag_prefix: string;
    commission_rate?: number;
  }): Reader {
    const stmt = db.prepare(`
      INSERT INTO readers (page_id, reader_name, tag_prefix, commission_rate)
      VALUES (?, ?, ?, ?)
    `);
    const rate = data.commission_rate !== undefined ? data.commission_rate : 0.0;
    const info = stmt.run(data.page_id, data.reader_name, data.tag_prefix, rate);
    return this.getById(Number(info.lastInsertRowid))!;
  }

  static deleteByName(name: string): boolean {
    const stmt = db.prepare('DELETE FROM readers WHERE LOWER(reader_name) = LOWER(?)');
    const result = stmt.run(name);
    return (result.changes || 0) > 0;
  }

  static updateTagPrefix(name: string, newTagPrefix: string): boolean {
    const stmt = db.prepare('UPDATE readers SET tag_prefix = ? WHERE LOWER(reader_name) = LOWER(?)');
    const result = stmt.run(newTagPrefix, name);
    return (result.changes || 0) > 0;
  }

  /**
   * Quét nhận diện Reader từ tin nhắn rep khách:
   * 1. Dấu '.' ở cuối câu -> Chi
   * 2. Tag đặc biệt của các Reader khác (nếu có cấu hình, vd: [My], [Hieu]...)
   * 3. Tin nhắn bình thường không có dấu chấm -> Mặc định là NA
   */
  static findByTagInMessage(pageId: number, text: string): Reader | null {
    if (!text) return null;
    const readers = this.getByPageId(pageId);
    if (readers.length === 0) return null;

    const trimmed = text.trim();
    const normalized = text.toLowerCase();

    // Tìm reader Chi và NA
    const chiReader = readers.find(r => r.reader_name.toLowerCase() === 'chi');
    const naReader = readers.find(r => r.reader_name.toLowerCase() === 'na');

    // 1. Kiểm tra ký hiệu của Chi (mặc định dấu '.')
    const chiTag = chiReader?.tag_prefix || '.';
    if (chiTag && (trimmed.endsWith(chiTag) || normalized.includes(chiTag.toLowerCase()))) {
      return chiReader || null;
    }

    // 2. Nhận diện theo tag prefix của các Reader khác (nếu có)
    for (const reader of readers) {
      if (reader.reader_name.toLowerCase() !== 'chi' && reader.reader_name.toLowerCase() !== 'na') {
        if (reader.tag_prefix && normalized.includes(reader.tag_prefix.toLowerCase())) {
          return reader;
        }
      }
    }

    // 3. Không có dấu chấm / không có ký tự đặc biệt -> Mặc định là NA
    if (naReader) {
      return naReader;
    }

    return chiReader || null;
  }
}
