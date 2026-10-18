"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleSheetsService = void 0;
const googleapis_1 = require("googleapis");
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
class GoogleSheetsService {
    static sheetsClient = null;
    /**
     * Khởi tạo Google Sheets API client
     */
    static async getClient() {
        if (this.sheetsClient) {
            return this.sheetsClient;
        }
        try {
            let auth;
            // 1. Kiểm tra JSON trực tiếp từ biến môi trường
            if (config_1.config.google.serviceAccountJson) {
                const credentials = JSON.parse(config_1.config.google.serviceAccountJson);
                auth = new googleapis_1.google.auth.GoogleAuth({
                    credentials,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets']
                });
            }
            // 2. Kiểm tra file config/google-service-account.json
            else if (fs_1.default.existsSync(config_1.config.google.serviceAccountKeyPath)) {
                auth = new googleapis_1.google.auth.GoogleAuth({
                    keyFile: config_1.config.google.serviceAccountKeyPath,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets']
                });
            }
            else {
                logger_1.logger.warn(`[GoogleSheets] Chưa tìm thấy key Service Account tại: ${config_1.config.google.serviceAccountKeyPath}`);
                return null;
            }
            const client = googleapis_1.google.sheets({ version: 'v4', auth });
            this.sheetsClient = client;
            logger_1.logger.info('[GoogleSheets] Kết nối Google Sheets API thành công!');
            return client;
        }
        catch (error) {
            logger_1.logger.error('[GoogleSheets] Lỗi xác thực Service Account:', error.message);
            return null;
        }
    }
    /**
     * Ghi nối tiếp 1 dòng vào cuối file Google Sheets có sẵn theo đúng 7 cột:
     * [Cột A: Ngày | Cột B: Khách | Cột C: Reader | Cột D: Gói xem | Cột E: Số tiền | Cột F: Page | Cột G: Nguồn khách]
     * Trả về số thứ tự dòng vừa ghi (để lệnh /doi cập nhật nhanh).
     */
    static async appendTransaction(data) {
        const spreadsheetId = config_1.config.google.spreadsheetId;
        if (!spreadsheetId) {
            logger_1.logger.warn('[GoogleSheets] Chưa cấu hình GOOGLE_SPREADSHEET_ID, bỏ qua ghi Sheets.');
            return null;
        }
        const client = await this.getClient();
        if (!client)
            return null;
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
            logger_1.logger.info(`[GoogleSheets] Đã điền chính xác vào dòng kế tiếp: Data!A${nextRow}:G${nextRow}`);
            return nextRow;
        }
        catch (error) {
            logger_1.logger.error('[GoogleSheets] Lỗi khi ghi vào Sheets:', error.message);
            return null;
        }
    }
    /**
     * Cập nhật lại Cột C (Reader) khi dùng lệnh /doi [Số_Đơn] [Tên_Reader_Mới]
     */
    static async updateReaderColumn(rowNumber, newReaderName) {
        const spreadsheetId = config_1.config.google.spreadsheetId;
        if (!spreadsheetId || !rowNumber)
            return false;
        const client = await this.getClient();
        if (!client)
            return false;
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
            logger_1.logger.info(`[GoogleSheets] Đã cập nhật dòng C${rowNumber} thành: ${newReaderName}`);
            return true;
        }
        catch (error) {
            logger_1.logger.error(`[GoogleSheets] Lỗi khi cập nhật ô C${rowNumber}:`, error.message);
            return false;
        }
    }
    /**
     * Lấy danh sách tất cả các giao dịch trong ngày từ Google Sheets (tab Data)
     */
    static async getRowsByDate(dateStr) {
        const spreadsheetId = config_1.config.google.spreadsheetId;
        if (!spreadsheetId)
            return [];
        const client = await this.getClient();
        if (!client)
            return [];
        try {
            const res = await client.spreadsheets.values.get({
                spreadsheetId,
                range: 'Data!A:G'
            });
            const rows = res.data.values || [];
            const records = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || !row[0])
                    continue;
                const rowDate = row[0].toString().trim();
                if (rowDate === dateStr) {
                    const rawAmount = (row[4] || '0').toString().trim();
                    // Chuyển "100.000" hoặc "100000" thành number 100000
                    const numericAmount = parseInt(rawAmount.replace(/\D/g, ''), 10) || 0;
                    records.push({
                        rowNumber: i + 1,
                        date: rowDate,
                        customerName: (row[1] || '').toString().trim(),
                        readerName: (row[2] || '').toString().trim(),
                        packageName: (row[3] || '').toString().trim(),
                        amount: numericAmount,
                        rawAmount: rawAmount,
                        pageName: (row[5] || '').toString().trim(),
                        trafficSource: (row[6] || '').toString().trim()
                    });
                }
            }
            return records;
        }
        catch (error) {
            logger_1.logger.error('[GoogleSheets] Lỗi đọc dữ liệu Data:', error.message);
            return [];
        }
    }
    /**
     * Lấy địa chỉ email của Service Account để đưa cho người dùng bấm Chia sẻ
     */
    static getServiceAccountEmail() {
        try {
            if (config_1.config.google.serviceAccountJson) {
                const parsed = JSON.parse(config_1.config.google.serviceAccountJson);
                return parsed.client_email || null;
            }
            if (fs_1.default.existsSync(config_1.config.google.serviceAccountKeyPath)) {
                const raw = fs_1.default.readFileSync(config_1.config.google.serviceAccountKeyPath, 'utf-8');
                const parsed = JSON.parse(raw);
                return parsed.client_email || null;
            }
        }
        catch {
            return null;
        }
        return null;
    }
}
exports.GoogleSheetsService = GoogleSheetsService;
