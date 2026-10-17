import { db } from '../database/db';
import { Transaction } from '../types';

export class TransactionModel {
  static getById(id: number): Transaction | undefined {
    const stmt = db.prepare('SELECT * FROM transactions WHERE id = ?');
    return stmt.get(id) as unknown as Transaction | undefined;
  }

  static getByTransactionCode(code: string): Transaction | undefined {
    const stmt = db.prepare('SELECT * FROM transactions WHERE transaction_code = ?');
    return stmt.get(code) as unknown as Transaction | undefined;
  }

  /**
   * Tính số thứ tự đơn trong ngày (#1, #2... tự reset khi sang ngày mới)
   */
  static getNextDailyOrderNumber(): number {
    const stmt = db.prepare(`
      SELECT COUNT(id) as total 
      FROM transactions 
      WHERE date(created_at) = date('now', 'localtime')
    `);
    const result = stmt.get() as unknown as { total: number };
    return (result?.total || 0) + 1;
  }

  static create(data: {
    daily_order_number: number;
    page_id: number;
    reader_id: number | null;
    customer_name: string;
    package_name: string;
    amount: number;
    commission_rate: number;
    commission_amount: number;
    transaction_code: string;
    bill_image_url: string;
    sheet_row_number?: number | null;
  }): Transaction {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO transactions (
        daily_order_number, page_id, reader_id, customer_name, package_name, 
        amount, commission_rate, commission_amount, transaction_code, 
        bill_image_url, sheet_row_number, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `);
    const info = stmt.run(
      data.daily_order_number,
      data.page_id,
      data.reader_id,
      data.customer_name,
      data.package_name,
      data.amount,
      data.commission_rate,
      data.commission_amount,
      data.transaction_code,
      data.bill_image_url,
      data.sheet_row_number || null
    );
    return this.getById(Number(info.lastInsertRowid))!;
  }

  static updateSheetRowNumber(id: number, rowNumber: number): void {
    const stmt = db.prepare('UPDATE transactions SET sheet_row_number = ? WHERE id = ?');
    stmt.run(rowNumber, id);
  }

  /**
   * Tìm đơn hàng hôm nay theo số thứ tự đơn (ví dụ: tìm đơn #1 của ngày hôm nay)
   */
  static getByTodayOrderNumber(orderNumber: number): (Transaction & { reader_name?: string; page_name?: string }) | undefined {
    const stmt = db.prepare(`
      SELECT t.*, r.reader_name, p.page_name
      FROM transactions t
      LEFT JOIN readers r ON t.reader_id = r.id
      LEFT JOIN pages p ON t.page_id = p.id
      WHERE t.daily_order_number = ? 
        AND date(t.created_at) = date('now', 'localtime')
      ORDER BY t.id DESC
      LIMIT 1
    `);
    return stmt.get(orderNumber) as unknown as (Transaction & { reader_name?: string; page_name?: string }) | undefined;
  }

  /**
   * Cập nhật reader mới và tính lại hoa hồng khi dùng lệnh /doi [Số_Đơn] [Tên_Reader]
   */
  static updateReaderForOrder(
    orderNumber: number,
    newReaderId: number,
    commissionRate: number,
    commissionAmount: number
  ): (Transaction & { reader_name?: string; page_name?: string }) | undefined {
    const stmt = db.prepare(`
      UPDATE transactions
      SET reader_id = ?, commission_rate = ?, commission_amount = ?
      WHERE daily_order_number = ? 
        AND date(created_at) = date('now', 'localtime')
    `);
    stmt.run(newReaderId, commissionRate, commissionAmount, orderNumber);
    return this.getByTodayOrderNumber(orderNumber);
  }

  static getTodayTransactions(pageId?: number): Array<Transaction & { reader_name?: string; page_name?: string }> {
    if (pageId) {
      const stmt = db.prepare(`
        SELECT t.*, r.reader_name, p.page_name 
        FROM transactions t
        LEFT JOIN readers r ON t.reader_id = r.id
        LEFT JOIN pages p ON t.page_id = p.id
        WHERE t.page_id = ? 
          AND date(t.created_at) = date('now', 'localtime')
        ORDER BY t.daily_order_number ASC
      `);
      return stmt.all(pageId) as unknown as Array<Transaction & { reader_name?: string; page_name?: string }>;
    } else {
      const stmt = db.prepare(`
        SELECT t.*, r.reader_name, p.page_name 
        FROM transactions t
        LEFT JOIN readers r ON t.reader_id = r.id
        LEFT JOIN pages p ON t.page_id = p.id
        WHERE date(t.created_at) = date('now', 'localtime')
        ORDER BY t.daily_order_number ASC
      `);
      return stmt.all() as unknown as Array<Transaction & { reader_name?: string; page_name?: string }>;
    }
  }

  static getSystemDailySummary(): {
    totalRevenueAllPages: number;
    totalOrdersAllPages: number;
    pagesSummary: Array<{
      page_id: number;
      page_name: string;
      page_total_amount: number;
      page_total_count: number;
      readers: Array<{
        reader_name: string;
        count: number;
        amount: number;
        commission_total: number;
      }>;
    }>;
  } {
    const pagesStmt = db.prepare('SELECT id, page_name FROM pages ORDER BY id ASC');
    const allPages = pagesStmt.all() as unknown as Array<{ id: number; page_name: string }>;

    let totalRevenueAllPages = 0;
    let totalOrdersAllPages = 0;

    const pagesSummary = allPages.map(page => {
      const readerStmt = db.prepare(`
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
      const readers = readerStmt.all(page.id) as unknown as Array<{
        reader_name: string;
        count: number;
        amount: number;
        commission_total: number;
      }>;

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
