import { MetaMessagingEvent } from '../types/meta';
import { PageModel } from '../models/page.model';
import { ReaderModel } from '../models/reader.model';
import { SessionModel } from '../models/session.model';
import { TransactionModel } from '../models/transaction.model';
import { MetaApiService } from './meta-api.service';
import { OCRService } from './ocr.service';
import { TelegramService } from './telegram.service';
import { GoogleSheetsService } from './sheets.service';
import { logger } from '../utils/logger';
import { formatDateTimeVN, formatDateVN } from '../utils/currency';

export class WebhookService {
  /**
    * Xử lý sự kiện tin nhắn từ Meta Business Suite (Facebook Page Messaging API)
   */
  static async handleMessagingEvent(
    event: MetaMessagingEvent,
    entryPageId?: string,
    payloadObject?: string
  ): Promise<void> {
    const isEcho = Boolean(event.message?.is_echo);
    const senderId = event.sender?.id;
    const recipientId = event.recipient?.id;

    // Phân loại nguồn traffic: Instagram, Facebook hoặc Threads
    let platform: 'Instagram' | 'Facebook' | 'Threads' = 'Instagram';
    const referralSource = (event.message as any)?.referral?.source || (event as any).referral?.source;
    if (payloadObject === 'threads' || referralSource === 'THREADS') {
      platform = 'Threads';
    } else if (payloadObject === 'page') {
      platform = 'Facebook';
    } else {
      platform = 'Instagram';
    }

    // Xác định Facebook Fanpage ID từ event
    const targetFbPageId = isEcho ? senderId : (entryPageId || recipientId);
    const page = PageModel.getByFbPageId(targetFbPageId);

    if (!page) {
      logger.warn(`[Webhook] Không tìm thấy Fanpage được cấu hình trong hệ thống cho FB Page ID: ${targetFbPageId}`);
      return;
    }

    // 1. LUỒNG OUTBOUND (Page rep khách - Cơ chế "Reader rep trước nhận khách")
    if (isEcho || senderId === page.fb_page_id) {
      const customerId = recipientId;
      const messageText = event.message?.text || '';

      logger.info(`[Webhook] Outbound message từ Fanpage [${page.page_name}] tới khách [${customerId}]: "${messageText}"`);

      // Lấy hoặc tạo phiên làm việc cho khách
      const session = SessionModel.getOrCreateSession(page.id, customerId, `Khách (${customerId.slice(-4)})`);

      // Nếu phiên đang UNCLAIMED, quét xem tin nhắn có chứa Tag của Reader nào không
      if (session.status === 'UNCLAIMED') {
        const matchedReader = ReaderModel.findByTagInMessage(page.id, messageText);
        if (matchedReader) {
          const claimed = SessionModel.claimSession(session.id, matchedReader.id);
          if (claimed) {
            logger.info(`🎯 [FIRST-COME CLAIM] Reader "${matchedReader.reader_name}" (Tag: "${matchedReader.tag_prefix}") đã nhận khách [${customerId}] trên Page [${page.page_name}]`);
          }
        }
      }
      return;
    }

    // 2. LUỒNG INBOUND (Khách gửi tin nhắn hoặc ảnh bill tới Fanpage)
    const customerId = senderId;
    
    // Lấy thông tin Tên/Nickname của khách qua Graph API
    const profile = await MetaApiService.getCustomerProfile(customerId, page.access_token);
    let customerName = profile.name;

    // Cập nhật phiên trò chuyện của khách
    const session = SessionModel.getOrCreateSession(page.id, customerId, customerName);

    // Kiểm tra nếu khách có gửi ảnh bill đính kèm
    const attachments = event.message?.attachments || [];
    const imageAttachments = attachments.filter(att => att.type === 'image');

    if (imageAttachments.length > 0) {
      logger.info(`[Webhook] Khách "${customerName}" đã gửi ${imageAttachments.length} ảnh bill tới Fanpage [${page.page_name}] (${platform})`);

      for (const att of imageAttachments) {
        const imageUrl = att.payload?.url;
        if (!imageUrl) continue;

        try {
          // OCR bóc tách số tiền, mã giao dịch và tên người chuyển (hoàn toàn cục bộ, 0 token AI)
          const ocrResult = await OCRService.processBill(imageUrl);

          if (!ocrResult.amount || ocrResult.amount <= 0) {
            logger.warn(`[OCR] Không nhận diện được số tiền hợp lệ trong ảnh của khách "${customerName}"`);
            await TelegramService.sendOcrFailedAlert(customerName);
            continue;
          }

          // Nếu tên khách qua API chưa lấy được (dạng fallback "Khách (xxxx)") và OCR đọc được tên người chuyển trên bill:
          if ((!profile.isReal || customerName.startsWith('Khách')) && ocrResult.senderName) {
            logger.info(`[CustomerName] Cập nhật tên khách từ bill ngân hàng: "${customerName}" ➔ "${ocrResult.senderName}"`);
            customerName = ocrResult.senderName;
            SessionModel.updateCustomerName(session.id, customerName);
          }

          const transactionCode = ocrResult.transactionCode || `TXN_${Date.now()}`;

          // Kiểm tra lọc trùng (Deduplication)
          const existingTx = TransactionModel.getByTransactionCode(transactionCode);
          if (existingTx) {
            logger.warn(`[Deduplication] Giao dịch mã ${transactionCode} đã tồn tại trong DB, bỏ qua không lưu lại.`);
            await TelegramService.sendDuplicateAlert(customerName, transactionCode, ocrResult.amount);
            continue;
          }

          // Xác định Reader đã nhận ca
          let readerName = 'Chưa có Reader nhận ca';
          let readerId: number | null = null;
          let commissionRate = 0;
          let commissionAmount = 0;

          if (session.claimed_by_reader_id) {
            const reader = ReaderModel.getById(session.claimed_by_reader_id);
            if (reader) {
              readerName = reader.reader_name;
              readerId = reader.id;
              commissionRate = reader.commission_rate || 40.0;
              // Tính hoa hồng thuần bằng code (ví dụ: 200.000 * 40% = 80.000)
              commissionAmount = Math.round(ocrResult.amount * (commissionRate / 100));
            }
          }

          // Đánh số đơn tự động trong ngày (#1, #2, #3...)
          const dailyOrderNumber = TransactionModel.getNextDailyOrderNumber();

          // Định dạng theo đúng chuẩn các dòng có sẵn trên file Google Sheets của người dùng:
          // [Cột A: Ngày (DD/MM/YYYY) | Cột B: Khách | Cột C: Reader | Cột D: Gói xem ('Tarot') | Cột E: Số tiền | Cột F: Page | Cột G: Nguồn]
          const dateStr = formatDateVN(new Date());
          const displayPageName = page.page_name === 'tarotchips' ? 'tarotchips03' : page.page_name;
          const packageName = 'Tarot';

          let sheetRowNumber: number | null = null;
          try {
            sheetRowNumber = await GoogleSheetsService.appendTransaction({
              dateTime: dateStr,
              customerName: customerName,
              readerName: readerName === 'Chưa có Reader nhận ca' ? '' : readerName,
              packageName: packageName,
              amount: ocrResult.amount,
              pageName: displayPageName,
              trafficSource: platform
            });
          } catch (sheetErr: any) {
            logger.error(`[GoogleSheets] Lỗi ghi sheet: ${sheetErr.message}`);
          }

          // 2. Lưu giao dịch nội bộ vào SQLite Database
          const newTx = TransactionModel.create({
            daily_order_number: dailyOrderNumber,
            page_id: page.id,
            reader_id: readerId,
            customer_name: customerName,
            package_name: packageName,
            amount: ocrResult.amount,
            commission_rate: commissionRate,
            commission_amount: commissionAmount,
            transaction_code: transactionCode,
            bill_image_url: imageUrl,
            sheet_row_number: sheetRowNumber
          });

          logger.info(`[DB] Đã ghi nhận ĐƠN #${dailyOrderNumber} - ${packageName} - ${ocrResult.amount}đ (Hoa hồng: ${commissionAmount}đ)`);

          // 3. Bắn thông báo REAL-TIME về nhóm Telegram duy nhất theo mẫu yêu cầu
          await TelegramService.sendRealtimeTransactionAlert({
            dailyOrderNumber: dailyOrderNumber,
            pageName: displayPageName,
            customerName: customerName,
            readerName: readerName,
            amount: ocrResult.amount,
            commissionAmount: commissionAmount,
            commissionRate: commissionRate,
            platform: platform
          });

        } catch (ocrErr: any) {
          logger.error(`[Webhook] Lỗi xử lý OCR bill: ${ocrErr.message}`);
        }
      }
    }
  }
}
