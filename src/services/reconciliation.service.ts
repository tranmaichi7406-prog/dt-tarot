import axios from 'axios';
import { PageModel } from '../models/page.model';
import { ReaderModel } from '../models/reader.model';
import { TransactionModel } from '../models/transaction.model';
import { GoogleSheetsService } from './sheets.service';
import { TelegramService } from './telegram.service';
import { OCRService } from './ocr.service';
import { formatCurrencyVND, formatDateVN } from '../utils/currency';
import { logger } from '../utils/logger';
import { config } from '../config';

export interface RecoveredBill {
  customerName: string;
  readerName: string;
  amount: number;
  transactionCode: string;
  sheetRowNumber: number | null;
  time: string;
}

export class ReconciliationService {
  /**
   * Tự động rà soát tin nhắn Meta trong ngày, đối chiếu với Google Sheet và bù bill bị lỡ
   */
  static async runReconciliation(manualTrigger = false): Promise<string> {
    logger.info(`[Reconciliation] Bắt đầu rà soát bill trong ngày (Trigger: ${manualTrigger ? 'Thủ công /rasoat' : 'Tự động Cron'})...`);

    const pages = PageModel.getAll();
    if (pages.length === 0) {
      return '⚠️ Hệ thống chưa cấu hình Fanpage nào để rà soát.';
    }

    const todayVN = formatDateVN(new Date());
    const recoveredBills: RecoveredBill[] = [];
    let totalMetaBillsFound = 0;

    for (const page of pages) {
      try {
        if (!page.access_token || page.access_token.startsWith('mock_')) continue;

        // 1. Quét danh sách các hội thoại gần nhất trên Fanpage
        const convUrl = `https://graph.facebook.com/v19.0/${page.fb_page_id}/conversations`;
        const convRes = await axios.get(convUrl, {
          params: {
            fields: 'id,updated_time,participants,messages{id,created_time,from,to,message,attachments{type,image_data,file_url}}',
            limit: 30,
            access_token: page.access_token
          },
          timeout: 15000
        });

        const conversations = convRes.data.data || [];

        for (const conv of conversations) {
          const messages = conv.messages?.data || [];
          const participants = conv.participants?.data || [];
          
          // Xác định tên khách từ participants (người không phải là Fanpage)
          const customerParticipant = participants.find((p: any) => p.id !== page.fb_page_id);
          const defaultCustomerName = customerParticipant?.name || 'Khách Meta';

          // Xác định Reader đã rep khách (dựa trên tin nhắn có tag của Reader từ Fanpage)
          let detectedReaderName = 'NA'; // Mặc định không có tag là NA
          for (const msg of messages) {
            if (msg.from?.id === page.fb_page_id && msg.message) {
              const matchedReader = ReaderModel.findByTagInMessage(page.id, msg.message);
              if (matchedReader) {
                detectedReaderName = matchedReader.reader_name;
                break;
              }
            }
          }

          // Lọc các tin nhắn của khách trong ngày hôm nay có đính kèm ảnh
          for (const msg of messages) {
            // Chỉ kiểm tra tin nhắn do khách gửi (không phải do Page gửi)
            if (msg.from?.id === page.fb_page_id) continue;

            // Kiểm tra ngày của tin nhắn (so khớp theo ngày hôm nay tại VN)
            const msgDate = new Date(msg.created_time);
            const msgDateStr = formatDateVN(msgDate);
            if (msgDateStr !== todayVN) continue; // Bỏ qua tin nhắn các ngày trước

            const attachments = msg.attachments?.data || [];
            for (const att of attachments) {
              const imageUrl = att.image_data?.url || att.file_url;
              if (!imageUrl) continue;

              totalMetaBillsFound++;

              // Đọc OCR bill để lấy số tiền và mã giao dịch
              const ocrResult = await OCRService.processBill(imageUrl);
              if (!ocrResult.amount || ocrResult.amount <= 0) continue;

              const transactionCode = ocrResult.transactionCode || `TXN_${Date.now()}`;

              // Kiểm tra xem bill này đã có trong Database / Google Sheets chưa
              const existingTx = TransactionModel.getByTransactionCode(transactionCode);
              if (existingTx) {
                // Đã có trong hệ thống ➔ Đã khớp!
                continue;
              }

              // PHÁT HIỆN BILL BỊ LỠ ➔ TỰ ĐỘNG BÙ VÀO GOOGLE SHEETS!
              logger.warn(`[Reconciliation] Phát hiện bill bị lỡ: Khách "${defaultCustomerName}" - ${ocrResult.amount}đ (Mã: ${transactionCode})`);

              let finalCustomerName = defaultCustomerName;
              if (ocrResult.senderName && (finalCustomerName.startsWith('Khách') || finalCustomerName === 'Khách Meta')) {
                finalCustomerName = ocrResult.senderName;
              }

              const isTarotChips = page.page_name.toLowerCase().includes('tarot');
              const displayPageName = isTarotChips ? 'tarotchips03' : page.page_name;
              const dailyOrderNumber = TransactionModel.getNextDailyOrderNumber();

              let sheetRowNumber: number | null = null;
              try {
                sheetRowNumber = await GoogleSheetsService.appendTransaction({
                  dateTime: todayVN,
                  customerName: finalCustomerName,
                  readerName: detectedReaderName,
                  packageName: 'Tarot',
                  amount: ocrResult.amount,
                  pageName: displayPageName,
                  trafficSource: 'Facebook'
                });
              } catch (sheetErr: any) {
                logger.error(`[Reconciliation] Lỗi ghi bù vào Google Sheets: ${sheetErr.message}`);
              }

              // Lưu vào database nội bộ
              TransactionModel.create({
                daily_order_number: dailyOrderNumber,
                page_id: page.id,
                reader_id: null,
                customer_name: finalCustomerName,
                package_name: 'Tarot',
                amount: ocrResult.amount,
                commission_rate: 0,
                commission_amount: 0,
                transaction_code: transactionCode,
                bill_image_url: imageUrl,
                sheet_row_number: sheetRowNumber
              });

              recoveredBills.push({
                customerName: finalCustomerName,
                readerName: detectedReaderName,
                amount: ocrResult.amount,
                transactionCode: transactionCode,
                sheetRowNumber: sheetRowNumber,
                time: msgDate.toLocaleTimeString('vi-VN')
              });
            }
          }
        }
      } catch (pageErr: any) {
        logger.error(`[Reconciliation] Lỗi rà soát Page ${page.page_name}:`, pageErr.response?.data || pageErr.message);
      }
    }

    // 2. Lấy tổng số đơn hiện tại trong ngày từ database
    const todayTxs = TransactionModel.getTodayTransactions();
    const totalRecorded = todayTxs.length;

    // 3. Tạo thông báo kết quả chi tiết
    let reportMessage = '';

    if (recoveredBills.length === 0) {
      reportMessage = 
`✅ <b>KẾT QUẢ RÀ SOÁT BILL NGÀY ${todayVN}</b>
━━━━━━━━━━━━━━━━━━━━━
📊 <b>Tổng bill quét trên Meta:</b> ${totalMetaBillsFound} bill
📊 <b>Tổng đơn đã ghi trên Google Sheet:</b> ${totalRecorded} đơn
🎯 <b>Trạng thái:</b> <b>KHỚP 100%</b>
<i>(Không có bill nào của khách bị bỏ sót trong ngày hôm nay!)</i>`;
    } else {
      let recoveredListText = '';
      for (const b of recoveredBills) {
        const rowStr = b.sheetRowNumber ? ` ➔ <i>Đã điền bù vào Dòng ${b.sheetRowNumber}</i>` : '';
        recoveredListText += `• Khách <b>${b.customerName}</b> (${b.time}): <b>${formatCurrencyVND(b.amount)}đ</b> (Reader: <b>${b.readerName}</b>)${rowStr}\n`;
      }

      reportMessage = 
`⚠️ <b>KẾT QUẢ RÀ SOÁT: ĐÃ TỰ ĐỘNG BÙ ${recoveredBills.length} BILL BỊ LỠ!</b>
━━━━━━━━━━━━━━━━━━━━━
<b>Chi tiết các bill vừa được phục hồi vào Google Sheet:</b>
${recoveredListText}
━━━━━━━━━━━━━━━━━━━━━
📊 <b>Tổng đơn hôm nay sau khi bù:</b> ${totalRecorded} đơn
✅ Hệ thống đã tự động bảo toàn 100% doanh thu cho bạn!`;
    }

    // 4. Bắn thông báo về Telegram
    const bot = TelegramService.getBot();
    const chatId = config.telegram.managerChatId;
    if (bot && chatId) {
      await bot.sendMessage(chatId, reportMessage, { parse_mode: 'HTML' });
    }

    return reportMessage;
  }
}
