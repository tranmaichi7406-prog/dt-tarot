import { google, sheets_v4 } from 'googleapis';
import fs from 'fs';
import { config } from '../config';
import { logger } from '../utils/logger';

export class GoogleSheetsService {
  private static sheetsClient: sheets_v4.Sheets | null = null;

  /**
   * Khởi tạo Google Sheets API client
   */
  private static async getClient(): Promise<sheets_v4.Sheets | null> {
    if (this.sheetsClient) {
      return this.sheetsClient;
    }

    try {
      let auth;

      // 1. Kiểm tra JSON trực tiếp từ biến môi trường
      if (config.google.serviceAccountJson) {
        const credentials = JSON.parse(config.google.serviceAccountJson);
        auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
      }
      // 2. Kiểm tra file config/google-service-account.json
      else if (fs.existsSync(config.google.serviceAccountKeyPath)) {
        auth = new google.auth.GoogleAuth({
          keyFile: config.google.serviceAccountKeyPath,
          scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
      } else {
        logger.warn(`[GoogleSheets] Chưa tìm thấy key Service Account tại: ${config.google.serviceAccountKeyPath}`);
        return null;
      }

      const client = google.sheets({ version: 'v4', auth });
      this.sheetsClient = client;
      logger.info('[GoogleSheets] Kết nối Google Sheets API thành công!');
      return client;
    } catch (error: any) {
      logger.error('[GoogleSheets] Lỗi xác thực Service Account:', error.message);
      return null;
    }
  }

  /**
   * Ghi nối tiếp 1 dòng vào cuối file Google Sheets có sẵn theo đúng 7 cột:
   * [Cột A: Ngày | Cột B: Khách | Cột C: Reader | Cột D: Gói xem | Cột E: Số tiền | Cột F: Page | Cột G: Nguồn khách]
   * Trả về số thứ tự dòng vừa ghi (để lệnh /doi cập nhật nhanh).
   */
  static async appendTransaction(data: {
    dateTime: string;
    customerName: string;
    readerName: string;
    packageName: string;
    amount: number;
    pageName: string;
    trafficSource?: string;
  }): Promise<number | null> {
    const spreadsheetId = config.google.spreadsheetId;
    if (!spreadsheetId) {
      logger.warn('[GoogleSheets] Chưa cấu hình GOOGLE_SPREADSHEET_ID, bỏ qua ghi Sheets.');
      return null;
    }

    const client = await this.getClient();
    if (!client) return null;

    // Định dạng số tiền có dấu chấm phân cách hàng nghìn (vd: 25.000) giống toàn bộ các dòng có sẵn
    const formattedAmount = data.amount.toLocaleString('vi-VN');

    const rowValues = [
      data.dateTime,
      data.customerName,
      data.readerName || '',
      data.packageName || 'Tarot',
      formattedAmount,
      data.pageName,
      data.trafficSource || 'Facebook'
    ];

    try {
      // 1. Quét Cột A để tìm chính xác dòng trống tiếp theo (tránh bị nhảy dòng do công thức ở cột Năm/Tháng)
      const colARes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: 'Data!A:A'
      });
      const rows = colARes.data.values || [];
      
      let nextRow = 2; // Bắt đầu sau dòng tiêu đề (dòng 1)
      while (nextRow <= rows.length && rows[nextRow - 1] && rows[nextRow - 1][0] && rows[nextRow - 1][0].toString().trim() !== '') {
        nextRow++;
      }

      // 2. Điền chính xác vào dòng kế tiếp (ví dụ: dòng 237)
      await client.spreadsheets.values.update({
        spreadsheetId,
        range: `Data!A${nextRow}:G${nextRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowValues]
        }
      });

      logger.info(`[GoogleSheets] Đã điền chính xác vào dòng kế tiếp: Data!A${nextRow}:G${nextRow}`);
      return nextRow;
    } catch (error: any) {
      logger.error('[GoogleSheets] Lỗi khi ghi vào Sheets:', error.message);
      return null;
    }
  }

  /**
   * Cập nhật lại Cột C (Reader) khi dùng lệnh /doi [Số_Đơn] [Tên_Reader_Mới]
   */
  static async updateReaderColumn(rowNumber: number, newReaderName: string): Promise<boolean> {
    const spreadsheetId = config.google.spreadsheetId;
    if (!spreadsheetId || !rowNumber) return false;

    const client = await this.getClient();
    if (!client) return false;

    try {
      // Cột C tương ứng với Reader trên trang tính Data
      const range = `Data!C${rowNumber}`;
      await client.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[newReaderName]]
        }
      });

      logger.info(`[GoogleSheets] Đã cập nhật dòng C${rowNumber} thành: ${newReaderName}`);
      return true;
    } catch (error: any) {
      logger.error(`[GoogleSheets] Lỗi khi cập nhật ô C${rowNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Lấy địa chỉ email của Service Account để đưa cho người dùng bấm Chia sẻ
   */
  static getServiceAccountEmail(): string | null {
    try {
      if (config.google.serviceAccountJson) {
        const parsed = JSON.parse(config.google.serviceAccountJson);
        return parsed.client_email || null;
      }
      if (fs.existsSync(config.google.serviceAccountKeyPath)) {
        const raw = fs.readFileSync(config.google.serviceAccountKeyPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed.client_email || null;
      }
    } catch {
      return null;
    }
    return null;
  }
}
