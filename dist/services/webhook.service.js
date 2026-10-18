"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookService = void 0;
const page_model_1 = require("../models/page.model");
const reader_model_1 = require("../models/reader.model");
const session_model_1 = require("../models/session.model");
const transaction_model_1 = require("../models/transaction.model");
const meta_api_service_1 = require("./meta-api.service");
const ocr_service_1 = require("./ocr.service");
const telegram_service_1 = require("./telegram.service");
const sheets_service_1 = require("./sheets.service");
const logger_1 = require("../utils/logger");
const currency_1 = require("../utils/currency");
class WebhookService {
    /**
      * Xử lý sự kiện tin nhắn từ Meta Business Suite (Facebook Page Messaging API)
     */
    static async handleMessagingEvent(event, entryPageId, payloadObject) {
        const isEcho = Boolean(event.message?.is_echo);
        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id;
        // Phân loại nguồn traffic: Instagram, Facebook hoặc Threads
        let platform = 'Instagram';
        const referralSource = event.message?.referral?.source || event.referral?.source;
        if (payloadObject === 'threads' || referralSource === 'THREADS') {
            platform = 'Threads';
        }
        else if (payloadObject === 'page') {
            platform = 'Facebook';
        }
        else {
            platform = 'Instagram';
        }
        // Xác định Facebook Fanpage ID từ event
        const targetFbPageId = isEcho ? senderId : (entryPageId || recipientId);
        const page = page_model_1.PageModel.getByFbPageId(targetFbPageId);
        if (!page) {
            logger_1.logger.warn(`[Webhook] Không tìm thấy Fanpage được cấu hình trong hệ thống cho FB Page ID: ${targetFbPageId}`);
            return;
        }
        // 1. LUỒNG OUTBOUND (Page rep khách - Cơ chế "Reader rep trước nhận khách")
        if (isEcho || senderId === page.fb_page_id) {
            const customerId = recipientId;
            const messageText = event.message?.text || '';
            logger_1.logger.info(`[Webhook] Outbound message từ Fanpage [${page.page_name}] tới khách [${customerId}]: "${messageText}"`);
            // Lấy hoặc tạo phiên làm việc cho khách
            const session = session_model_1.SessionModel.getOrCreateSession(page.id, customerId, `Khách (${customerId.slice(-4)})`);
            // Nếu phiên đang UNCLAIMED, quét xem tin nhắn có chứa Tag của Reader nào không
            if (session.status === 'UNCLAIMED') {
                const matchedReader = reader_model_1.ReaderModel.findByTagInMessage(page.id, messageText);
                if (matchedReader) {
                    const claimed = session_model_1.SessionModel.claimSession(session.id, matchedReader.id);
                    if (claimed) {
                        logger_1.logger.info(`🎯 [FIRST-COME CLAIM] Reader "${matchedReader.reader_name}" (Tag: "${matchedReader.tag_prefix}") đã nhận khách [${customerId}] trên Page [${page.page_name}]`);
                    }
                }
            }
            return;
        }
        // 2. LUỒNG INBOUND (Khách gửi tin nhắn hoặc ảnh bill tới Fanpage)
        const customerId = senderId;
        // Lấy thông tin Tên/Nickname của khách qua Graph API
        const profile = await meta_api_service_1.MetaApiService.getCustomerProfile(customerId, page.access_token);
        let customerName = profile.name;
        // Cập nhật phiên trò chuyện của khách
        const session = session_model_1.SessionModel.getOrCreateSession(page.id, customerId, customerName);
        // Kiểm tra nếu khách có gửi ảnh bill đính kèm
        const attachments = event.message?.attachments || [];
        const imageAttachments = attachments.filter(att => att.type === 'image');
        if (imageAttachments.length > 0) {
            logger_1.logger.info(`[Webhook] Khách "${customerName}" đã gửi ${imageAttachments.length} ảnh bill tới Fanpage [${page.page_name}] (${platform})`);
            for (const att of imageAttachments) {
                const imageUrl = att.payload?.url;
                if (!imageUrl)
                    continue;
                try {
                    // OCR bóc tách số tiền, mã giao dịch và tên người chuyển (hoàn toàn cục bộ, 0 token AI)
                    const ocrResult = await ocr_service_1.OCRService.processBill(imageUrl);
                    if (!ocrResult.amount || ocrResult.amount <= 0) {
                        logger_1.logger.warn(`[OCR] Không nhận diện được số tiền hợp lệ trong ảnh của khách "${customerName}"`);
                        await telegram_service_1.TelegramService.sendOcrFailedAlert(customerName);
                        continue;
                    }
                    // Nếu tên khách qua API chưa lấy được (dạng fallback "Khách (xxxx)") và OCR đọc được tên người chuyển trên bill:
                    if ((!profile.isReal || customerName.startsWith('Khách')) && ocrResult.senderName) {
                        logger_1.logger.info(`[CustomerName] Cập nhật tên khách từ bill ngân hàng: "${customerName}" ➔ "${ocrResult.senderName}"`);
                        customerName = ocrResult.senderName;
                        session_model_1.SessionModel.updateCustomerName(session.id, customerName);
                    }
                    const transactionCode = ocrResult.transactionCode || `TXN_${Date.now()}`;
                    // Kiểm tra lọc trùng (Deduplication)
                    const existingTx = transaction_model_1.TransactionModel.getByTransactionCode(transactionCode);
                    if (existingTx) {
                        logger_1.logger.warn(`[Deduplication] Giao dịch mã ${transactionCode} đã tồn tại trong DB, bỏ qua không lưu lại.`);
                        await telegram_service_1.TelegramService.sendDuplicateAlert(customerName, transactionCode, ocrResult.amount);
                        continue;
                    }
                    // Xác định Reader đã nhận ca
                    let readerName = 'Chưa có Reader nhận ca';
                    let readerId = null;
                    let commissionRate = 0;
                    let commissionAmount = 0;
                    if (session.claimed_by_reader_id) {
                        const reader = reader_model_1.ReaderModel.getById(session.claimed_by_reader_id);
                        if (reader) {
                            readerName = reader.reader_name;
                            readerId = reader.id;
                            commissionRate = reader.commission_rate || 40.0;
                            // Tính hoa hồng thuần bằng code (ví dụ: 200.000 * 40% = 80.000)
                            commissionAmount = Math.round(ocrResult.amount * (commissionRate / 100));
                        }
                    }
                    // Đánh số đơn tự động trong ngày (#1, #2, #3...)
                    const dailyOrderNumber = transaction_model_1.TransactionModel.getNextDailyOrderNumber();
                    // Định dạng theo đúng chuẩn các dòng có sẵn trên file Google Sheets của người dùng:
                    // [Cột A: Ngày (DD/MM/YYYY) | Cột B: Khách | Cột C: Reader | Cột D: Gói xem ('Tarot') | Cột E: Số tiền | Cột F: Page | Cột G: Nguồn]
                    const dateStr = (0, currency_1.formatDateVN)(new Date());
                    const displayPageName = page.page_name === 'tarotchips' ? 'tarotchips03' : page.page_name;
                    const packageName = 'Tarot';
                    let sheetRowNumber = null;
                    try {
                        sheetRowNumber = await sheets_service_1.GoogleSheetsService.appendTransaction({
                            dateTime: dateStr,
                            customerName: customerName,
                            readerName: readerName === 'Chưa có Reader nhận ca' ? '' : readerName,
                            packageName: packageName,
                            amount: ocrResult.amount,
                            pageName: displayPageName,
                            trafficSource: platform
                        });
                    }
                    catch (sheetErr) {
                        logger_1.logger.error(`[GoogleSheets] Lỗi ghi sheet: ${sheetErr.message}`);
                    }
                    // 2. Lưu giao dịch nội bộ vào SQLite Database
                    const newTx = transaction_model_1.TransactionModel.create({
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
                    logger_1.logger.info(`[DB] Đã ghi nhận ĐƠN #${dailyOrderNumber} - ${packageName} - ${ocrResult.amount}đ (Hoa hồng: ${commissionAmount}đ)`);
                    // 3. Bắn thông báo REAL-TIME về nhóm Telegram duy nhất theo mẫu yêu cầu
                    await telegram_service_1.TelegramService.sendRealtimeTransactionAlert({
                        dailyOrderNumber: dailyOrderNumber,
                        pageName: displayPageName,
                        customerName: customerName,
                        readerName: readerName,
                        amount: ocrResult.amount,
                        commissionAmount: commissionAmount,
                        commissionRate: commissionRate,
                        platform: platform
                    });
                }
                catch (ocrErr) {
                    logger_1.logger.error(`[Webhook] Lỗi xử lý OCR bill: ${ocrErr.message}`);
                }
            }
        }
    }
}
exports.WebhookService = WebhookService;
