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

  /**
   * Quét nhận diện Reader từ tin nhắn rep khách:
   * 1. Chi: dấu '.' cuối câu
   * 2. NA: dấu ',' cuối câu
   * 3. Các tag_prefix khác như [Chi], [NA], [Hieu], [Nhung]...
   */
  static findByTagInMessage(pageId: number, text: string): Reader | null {
    if (!text) return null;
    const readers = this.getByPageId(pageId);
    const trimmed = text.trim();
    const normalized = text.toLowerCase();

    // 1. Nhận diện dấu câu đặc trưng ở cuối tin nhắn:
    // Dấu '.' ở cuối câu -> Chi
    if (trimmed.endsWith('.')) {
      const chi = readers.find(r => r.reader_name.toLowerCase() === 'chi');
      if (chi) return chi;
    }

    // Dấu ',' ở cuối câu -> NA
    if (trimmed.endsWith(',')) {
      const na = readers.find(r => r.reader_name.toLowerCase() === 'na');
      if (na) return na;
    }

    // 2. Nhận diện theo tag prefix (ví dụ: [Chi], [NA], [Hieu], [Nhung]...)
    for (const reader of readers) {
      if (reader.tag_prefix && reader.tag_prefix !== '.' && reader.tag_prefix !== ',') {
        if (normalized.includes(reader.tag_prefix.toLowerCase())) {
          return reader;
        }
      }
    }

    return null;
  }
}
