"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionModel = void 0;
const db_1 = require("../database/db");
class TransactionModel {
    static getById(id) {
        const stmt = db_1.db.prepare('SELECT * FROM transactions WHERE id = ?');
        return stmt.get(id);
    }
    static getByTransactionCode(code) {
        const stmt = db_1.db.prepare('SELECT * FROM transactions WHERE transaction_code = ?');
        return stmt.get(code);
    }
    /**
     * Tính số thứ tự đơn trong ngày (#1, #2... tự reset khi sang ngày mới)
     */
    static getNextDailyOrderNumber() {
        const stmt = db_1.db.prepare(`
      SELECT COUNT(id) as total 
      FROM transactions 
      WHERE date(created_at) = date('now', 'localtime')
    `);
        const result = stmt.get();
        return (result?.total || 0) + 1;
    }
    static create(data) {
        const stmt = db_1.db.prepare(`
      INSERT OR REPLACE INTO transactions (
        daily_order_number, page_id, reader_id, customer_name, package_name, 
        amount, commission_rate, commission_amount, transaction_code, 
        bill_image_url, sheet_row_number, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `);
        const info = stmt.run(data.daily_order_number, data.page_id, data.reader_id, data.customer_name, data.package_name, data.amount, data.commission_rate, data.commission_amount, data.transaction_code, data.bill_image_url, data.sheet_row_number || null);
        return this.getById(Number(info.lastInsertRowid));
    }
    static updateSheetRowNumber(id, rowNumber) {
        const stmt = db_1.db.prepare('UPDATE transactions SET sheet_row_number = ? WHERE id = ?');
        stmt.run(rowNumber, id);
    }
    /**
     * Tìm đơn hàng hôm nay theo số thứ tự đơn (ví dụ: tìm đơn #1 của ngày hôm nay)
     */
    static getByTodayOrderNumber(orderNumber) {
        const stmt = db_1.db.prepare(`
      SELECT t.*, r.reader_name, p.page_name
      FROM transactions t
      LEFT JOIN readers r ON t.reader_id = r.id
      LEFT JOIN pages p ON t.page_id = p.id
      WHERE t.daily_order_number = ? 
        AND date(t.created_at) = date('now', 'localtime')
      ORDER BY t.id DESC
      LIMIT 1
    `);
        return stmt.get(orderNumber);
    }
    /**
     * Cập nhật reader mới và tính lại hoa hồng khi dùng lệnh /doi [Số_Đơn] [Tên_Reader]
     */
    static updateReaderForOrder(orderNumber, newReaderId, commissionRate, commissionAmount) {
        const stmt = db_1.db.prepare(`
      UPDATE transactions
      SET reader_id = ?, commission_rate = ?, commission_amount = ?
      WHERE daily_order_number = ? 
        AND date(created_at) = date('now', 'localtime')
    `);
        stmt.run(newReaderId, commissionRate, commissionAmount, orderNumber);
        return this.getByTodayOrderNumber(orderNumber);
    }
    static getTodayTransactions(pageId) {
        if (pageId) {
            const stmt = db_1.db.prepare(`
        SELECT t.*, r.reader_name, p.page_name 
        FROM transactions t
        LEFT JOIN readers r ON t.reader_id = r.id
        LEFT JOIN pages p ON t.page_id = p.id
        WHERE t.page_id = ? 
          AND date(t.created_at) = date('now', 'localtime')
        ORDER BY t.daily_order_number ASC
      `);
            return stmt.all(pageId);
        }
        else {
            const stmt = db_1.db.prepare(`
        SELECT t.*, r.reader_name, p.page_name 
        FROM transactions t
        LEFT JOIN readers r ON t.reader_id = r.id
        LEFT JOIN pages p ON t.page_id = p.id
        WHERE date(t.created_at) = date('now', 'localtime')
        ORDER BY t.daily_order_number ASC
      `);
            return stmt.all();
        }
    }
    static getSystemDailySummary() {
        const pagesStmt = db_1.db.prepare('SELECT id, page_name FROM pages ORDER BY id ASC');
        const allPages = pagesStmt.all();
        let totalRevenueAllPages = 0;
        let totalOrdersAllPages = 0;
        const pagesSummary = allPages.map(page => {
            const readerStmt = db_1.db.prepare(`
        SELECT 
          COALESCE(r.reader_name, 'Chưa rõ Reader') as reader_name,
          COUNT(t.id) as count,
          SUM(t.amount) as amount,
          SUM(t.commission_amount) as commission_total
        FROM transactions t
        LEFT JOIN readers r ON t.reader_id = r.id
        WHERE t.page_id = ? 
          AND date(t.created_at) = date('now', 'localtime')
        GROUP BY t.reader_id
        ORDER BY amount DESC
      `);
            const readers = readerStmt.all(page.id);
            let page_total_amount = 0;
            let page_total_count = 0;
            for (const r of readers) {
                page_total_amount += Number(r.amount || 0);
                page_total_count += Number(r.count || 0);
            }
            totalRevenueAllPages += page_total_amount;
            totalOrdersAllPages += page_total_count;
            return {
                page_id: page.id,
                page_name: page.page_name,
                page_total_amount,
                page_total_count,
                readers
            };
        });
        return {
            totalRevenueAllPages,
            totalOrdersAllPages,
            pagesSummary
        };
    }
}
exports.TransactionModel = TransactionModel;
