import { createWorker, Worker } from 'tesseract.js';
import axios from 'axios';
import crypto from 'crypto';
import { OCRResult } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

export class OCRService {
  private static workerInstance: Worker | null = null;
  private static isInitializing = false;

  /**
   * Khởi tạo Singleton Tesseract Worker chạy offline 100% miễn phí
   */
  private static async getWorker(): Promise<Worker> {
    if (this.workerInstance) {
      return this.workerInstance;
    }

    if (this.isInitializing) {
      // Đợi worker hoàn tất khởi tạo nếu có request song song
      await new Promise(resolve => setTimeout(resolve, 500));
      return this.getWorker();
    }

    this.isInitializing = true;
    try {
      logger.info(`[OCR] Đang khởi tạo Tesseract worker (languages: ${config.ocr.languages})...`);
      const worker = await createWorker(config.ocr.languages);
      this.workerInstance = worker;
      logger.info('[OCR] Khởi tạo Tesseract worker thành công!');
      return worker;
    } catch (err: any) {
      logger.error('[OCR] Lỗi khi tạo Tesseract worker:', err.message);
      // Fallback về eng nếu không tải được vie
      const fallbackWorker = await createWorker('eng');
      this.workerInstance = fallbackWorker;
      return fallbackWorker;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Tải ảnh từ URL về dạng Buffer
   */
  static async downloadImage(imageUrl: string): Promise<Buffer> {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 DT-Tarot-Backend/1.0'
        }
      });
      return Buffer.from(response.data);
    } catch (error: any) {
      logger.error(`[OCR] Lỗi tải ảnh từ ${imageUrl}: ${error.message}`);
      throw new Error(`Không thể tải ảnh bill: ${error.message}`);
    }
  }

  /**
   * Xử lý OCR đọc bill từ Image Buffer hoặc URL
   */
  static async processBill(imageInput: string | Buffer): Promise<OCRResult> {
    try {
      let imageBuffer: Buffer;
      if (typeof imageInput === 'string') {
        imageBuffer = await this.downloadImage(imageInput);
      } else {
        imageBuffer = imageInput;
      }

      const worker = await this.getWorker();
      const result = await worker.recognize(imageBuffer);
      const text = result.data.text || '';
      const confidence = result.data.confidence || 0;

      logger.debug('[OCR] Raw text nhận diện:', text);

      // Trích xuất số tiền và mã giao dịch bằng biểu thức chính quy (Regex)
      const amount = this.extractAmount(text);
      const transactionCode = this.extractTransactionCode(text, imageBuffer);

      return {
        rawText: text,
        amount,
        transactionCode,
        confidence
      };
    } catch (error: any) {
      logger.error('[OCR] Lỗi trong quá trình nhận diện bill:', error.message);
      return {
        rawText: '',
        amount: null,
        transactionCode: null,
        confidence: 0
      };
    }
  }

  /**
   * Trích xuất số tiền chuyển khoản từ bill ngân hàng
   */
  private static extractAmount(text: string): number | null {
    // 1. Tìm các mẫu có tiền tố rõ ràng như "Số tiền", "Giao dịch thành công", "VND", "đ"
    // Ví dụ: "Số tiền: 100.000 VND", "Số tiền: 200,000 đ", "100.000 đ"
    const explicitPatterns = [
      /(?:số\s*tiền|amount|thành\s*công|vnd|đ|vnđ)[^\d]{0,10}(\d{1,3}(?:[.,]\d{3})+)/i,
      /(\d{1,3}(?:[.,]\d{3})+)\s*(?:vnd|đ|vnđ)/i,
      /(?:số\s*tiền|amount)[^\d]{0,10}(\d{4,8})\b/i,
      /(\d{2,4})\s*(?:k|K)\b/ // Bắt dạng 50k, 100k, 200k
    ];

    for (const pattern of explicitPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let valStr = match[1].toLowerCase().trim();
        // Nếu là dạng 50k -> 50 * 1000 = 50000
        if (text.match(/(\d{2,4})\s*(?:k|K)\b/)) {
          const kMatch = text.match(/(\d{2,4})\s*(?:k|K)\b/);
          if (kMatch && kMatch[1]) {
            const kVal = parseInt(kMatch[1], 10) * 1000;
            if (kVal >= 10000 && kVal <= 50000000) return kVal;
          }
        }

        // Loại bỏ dấu chấm, phẩy
        const cleanNumber = parseInt(valStr.replace(/[.,]/g, ''), 10);
        if (!isNaN(cleanNumber) && cleanNumber >= 10000 && cleanNumber <= 50000000) {
          return cleanNumber;
        }
      }
    }

    // 2. Quét mọi cụm số phân tách 3 chữ số (VD: 50.000, 100.000, 150,000, 200.000)
    const generalMatches = text.match(/\b\d{1,3}(?:[.,]\d{3})+\b/g);
    if (generalMatches) {
      for (const raw of generalMatches) {
        const num = parseInt(raw.replace(/[.,]/g, ''), 10);
        // Hầu hết các ca Tarot có mức giá từ 20.000đ đến 5.000.000đ
        if (num >= 20000 && num <= 5000000) {
          return num;
        }
      }
    }

    // 3. Quét số nguyên liền nhau (VD: 100000, 200000, 50000)
    const rawNumberMatches = text.match(/\b\d{5,7}\b/g);
    if (rawNumberMatches) {
      for (const raw of rawNumberMatches) {
        const num = parseInt(raw, 10);
        if (num >= 20000 && num <= 5000000 && (num % 1000 === 0)) {
          return num;
        }
      }
    }

    return null;
  }

  /**
   * Trích xuất mã giao dịch ngân hàng để lọc trùng (Deduplication)
   */
  private static extractTransactionCode(text: string, imageBuffer: Buffer): string {
    // 1. Tìm các từ khóa ngân hàng hay dùng: Mã giao dịch, Mã tham chiếu, Số GD, FT..., MB...
    const codePatterns = [
      /(?:mã\s*(?:giao\s*dịch|gd|tham\s*chiếu|tra\s*cứu|bút\s*toán)|txn\s*id|transaction\s*id|ref\s*no)[^\w]{0,5}([a-zA-Z0-9]{6,25})/i,
      /\b(FT\d{10,20}[a-zA-Z0-9]*)\b/i, // Vietcombank / Techcombank FT codes
      /\b(MB\d{8,18})\b/i, // MB Bank
      /\b(VND\d{8,18})\b/i,
      /\b(\d{10,18})\b/ // Chuỗi 10-18 chữ số riêng biệt
    ];

    for (const pattern of codePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim().toUpperCase();
      }
    }

    // 2. Fallback: Nếu ảnh mờ hoặc không đọc rõ mã GD, tạo mã hash băm SHA256 ngắn từ buffer ảnh
    // Đảm bảo không trùng và nếu khách gửi lại đúng ảnh đó thì vẫn nhận diện được trùng
    const hash = crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 12).toUpperCase();
    return `IMG_${hash}`;
  }

  /**
   * Xác định tên gói dịch vụ dựa vào số tiền hoặc từ khóa
   */
  static detectPackage(amount: number | null): string {
    if (!amount) return 'Gói Tarot Tùy Chỉnh';

    // Tìm trong config mapping chính xác
    const matched = config.packagePriceMap.find(p => p.amount === amount);
    if (matched) return matched.name;

    // Phân loại thông minh dựa trên khoảng giá nếu không khớp chính xác
    if (amount <= 50000) return 'Gói 1 Câu Hỏi (Quick)';
    if (amount <= 90000) return 'Gói 2 Câu Hỏi';
    if (amount <= 120000) return 'Gói Tổng Quan 30 Phút';
    if (amount <= 180000) return 'Gói Tình Duyên / Sự Nghiệp 45 Phút';
    if (amount <= 250000) return 'Gói Chuyên Sâu 60 Phút';
    return 'Gói VIP Trải Bài Chuyên Sâu';
  }
}
