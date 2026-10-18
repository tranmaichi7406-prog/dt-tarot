import { db } from '../database/db';
import { Session } from '../types';

export class SessionModel {
  private static SESSION_TTL_HOURS = 24;

  static getById(id: number): Session | undefined {
    const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
    return stmt.get(id) as unknown as Session | undefined;
  }

  static getByConversationId(conversationId: string): Session | undefined {
    const stmt = db.prepare('SELECT * FROM sessions WHERE conversation_id = ?');
    return stmt.get(conversationId) as unknown as Session | undefined;
  }

  static getOrCreateSession(
    pageId: number,
    customerId: string,
    customerName: string
  ): Session {
    const conversationId = `${pageId}_${customerId}`;
    let session = this.getByConversationId(conversationId);

    const now = new Date();

    if (!session) {
      const stmt = db.prepare(`
        INSERT INTO sessions (
          conversation_id, page_id, customer_id, customer_name, 
          claimed_by_reader_id, status, last_message_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, 'UNCLAIMED', datetime('now'), datetime('now'))
      `);
      const info = stmt.run(conversationId, pageId, customerId, customerName);
      session = this.getById(Number(info.lastInsertRowid))!;
    } else {
      const lastMessageTime = new Date(session.last_message_at).getTime();
      const hoursDiff = (now.getTime() - lastMessageTime) / (1000 * 60 * 60);

      if (hoursDiff >= this.SESSION_TTL_HOURS) {
        const stmt = db.prepare(`
          UPDATE sessions 
          SET status = 'UNCLAIMED', claimed_by_reader_id = NULL, 
              customer_name = ?, last_message_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `);
        stmt.run(customerName, session.id);
      } else {
        const stmt = db.prepare(`
          UPDATE sessions 
          SET customer_name = ?, last_message_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `);
        stmt.run(customerName, session.id);
      }
      session = this.getById(session.id)!;
    }

    return session;
  }

  static claimSession(sessionId: number, readerId: number): boolean {
    const session = this.getById(sessionId);
    if (!session) return false;

    if (session.status === 'UNCLAIMED') {
      const stmt = db.prepare(`
        UPDATE sessions
        SET claimed_by_reader_id = ?, status = 'CLAIMED', updated_at = datetime('now')
        WHERE id = ?
      `);
      stmt.run(readerId, sessionId);
      return true;
    }
    return false;
  }

  static updateCustomerName(sessionId: number, customerName: string): boolean {
    const stmt = db.prepare(`
      UPDATE sessions
      SET customer_name = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    const res = stmt.run(customerName, sessionId);
    return res.changes > 0;
  }
}
