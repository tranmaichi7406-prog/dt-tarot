"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionModel = void 0;
const db_1 = require("../database/db");
class SessionModel {
    static SESSION_TTL_HOURS = 24;
    static getById(id) {
        const stmt = db_1.db.prepare('SELECT * FROM sessions WHERE id = ?');
        return stmt.get(id);
    }
    static getByConversationId(conversationId) {
        const stmt = db_1.db.prepare('SELECT * FROM sessions WHERE conversation_id = ?');
        return stmt.get(conversationId);
    }
    static getOrCreateSession(pageId, customerId, customerName) {
        const conversationId = `${pageId}_${customerId}`;
        let session = this.getByConversationId(conversationId);
        const now = new Date();
        if (!session) {
            const stmt = db_1.db.prepare(`
        INSERT INTO sessions (
          conversation_id, page_id, customer_id, customer_name, 
          claimed_by_reader_id, status, last_message_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, 'UNCLAIMED', datetime('now'), datetime('now'))
      `);
            const info = stmt.run(conversationId, pageId, customerId, customerName);
            session = this.getById(Number(info.lastInsertRowid));
        }
        else {
            const lastMessageTime = new Date(session.last_message_at).getTime();
            const hoursDiff = (now.getTime() - lastMessageTime) / (1000 * 60 * 60);
            if (hoursDiff >= this.SESSION_TTL_HOURS) {
                const stmt = db_1.db.prepare(`
          UPDATE sessions 
          SET status = 'UNCLAIMED', claimed_by_reader_id = NULL, 
              customer_name = ?, last_message_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `);
                stmt.run(customerName, session.id);
            }
            else {
                const stmt = db_1.db.prepare(`
          UPDATE sessions 
          SET customer_name = ?, last_message_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `);
                stmt.run(customerName, session.id);
            }
            session = this.getById(session.id);
        }
        return session;
    }
    static claimSession(sessionId, readerId) {
        const session = this.getById(sessionId);
        if (!session)
            return false;
        if (session.status === 'UNCLAIMED') {
            const stmt = db_1.db.prepare(`
        UPDATE sessions
        SET claimed_by_reader_id = ?, status = 'CLAIMED', updated_at = datetime('now')
        WHERE id = ?
      `);
            stmt.run(readerId, sessionId);
            return true;
        }
        return false;
    }
    static updateCustomerName(sessionId, customerName) {
        const stmt = db_1.db.prepare(`
      UPDATE sessions
      SET customer_name = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
        const res = stmt.run(customerName, sessionId);
        return res.changes > 0;
    }
}
exports.SessionModel = SessionModel;
