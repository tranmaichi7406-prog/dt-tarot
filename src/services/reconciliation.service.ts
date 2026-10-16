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
  platform: string;
}

export class ReconciliationService {
  /**
   * Tự động rà soát tin nhắn Meta trong ngày (cả Facebook & Instagram), 
   * đối chiếu trực tiếp với Google Sheet tab Data và bù bill bị lỡ.
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

    // 1. Đọc danh sách tất cả các dòng hôm nay đã có sẵn trong Google Sheet
    let todaySheetRows = await GoogleSheetsService.getRowsByDate(todayVN);
    logger.info(`[Reconciliation] Google Sheet hiện có ${todaySheetRows.length} dòng ngày ${todayVN}`);

    for (const page of pages) {
      try {
        if (!page.access_token || page.access_token.startsWith('mock_')) continue;

        // Quét các nền tảng: Facebook Messenger và Instagram Direct
        const platformsToScan: Array<{ name: 'Facebook' | 'Instagram'; url: string }> = [
          {
            name: 'Facebook',
            url: `https://graph.facebook.com/v19.0/${page.fb_page_id}/conversations`
          },
          {
            name: 'Instagram',
            url: `https://graph.facebook.com/v19.0/${page.fb_page_id}/conversations?platform=instagram`
          },
          {
            name: 'Instagram',
            url: `https://graph.facebook.com/v19.0/17841436212431682/conversations`
          }
        ];

        for (const targetPlatform of platformsToScan) {
          let conversations: any[] = [];
          try {
            const convRes = await axios.get(targetPlatform.url, {
              params: {
                fields: 'id,updated_time,participants,messages{id,created_time,from,to,message,attachments{type,image_data,file_url}}',
                limit: 30,
                access_token: page.access_token
              },
              timeout: 15000
            });
            conversations = convRes.data.data || [];
            logger.info(`[Reconciliation] Đã quét được ${conversations.length} hội thoại từ ${targetPlatform.name} trên Page [${page.page_name}]`);
          } catch (fetchErr: any) {
            logger.warn(`[Reconciliation] Không thể quét hội thoại ${targetPlatform.name}: ${fetchErr.response?.data?.error?.message || fetchErr.message}`);
            continue;
          }

          for (const conv of conversations) {
            const messages = conv.messages?.data || [];
            const participants = conv.participants?.data || [];

            // Xác định tên khách từ participants
            const customerParticipant = participants.find((p: any) => p.id !== page.fb_page_id);
            const defaultCustomerName = customerParticipant?.name || `Khách ${targetPlatform.name}`;

            // Xác định Reader đã rep khách (dựa trên tin nhắn có tag của Reader từ Fanpage)
            let detectedReaderName = 'NA';
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
              if (msg.from?.id === page.fb_page_id) continue;

              const msgDate = new Date(msg.created_time);
              const msgDateStr = formatDateVN(msgDate);
              if (msgDateStr !== todayVN) continue;

              const attachments = msg.attachments?.data || [];
              for (const att of attachments) {
                const imageUrl = att.image_data?.url || att.file_url;
                if (!imageUrl) continue;

                totalMetaBillsFound++;

                // Đọc OCR bill để lấy số tiền và mã giao dịch
                const ocrResult = await OCRService.processBill(imageUrl);
                if (!ocrResult.amount || ocrResult.amount <= 0) continue;

                const transactionCode = ocrResult.transactionCode || `TXN_${Date.now()}`;

                let finalCustomerName = defaultCustomerName;
                if (ocrResult.senderName && (finalCustomerName.startsWith('Khách') || finalCustomerName.includes('Meta'))) {
                  finalCustomerName = ocrResult.senderName;
                }

                // 2. ĐỐI CHIẾU TRỰC TIẾP VỚI GOOGLE SHEET:
                // Kiểm tra xem bill này đã có trong Google Sheet hôm nay chưa (khớp số tiền và tên khách hoặc nguồn)
                const isAlreadyInSheet = todaySheetRows.some(row => {
                  const sameAmount = row.amount === ocrResult.amount;
                  const nameA = row.customerName.toLowerCase().trim();
                  const nameB = finalCustomerName.toLowerCase().trim();
                  const nameMatch = nameA.includes(nameB) || nameB.includes(nameA) || nameA === '' || nameB === '';
                  return sameAmount && nameMatch;
                });

                if (isAlreadyInSheet) {
                  logger.info(`[Reconciliation] Bill ${ocrResult.amount}đ của khách "${finalCustomerName}" ĐÃ CÓ trong Google Sheet. Đã khớp!`);
                  continue;
                }

                // PHÁT HIỆN BILL BỊ LỠ ➔ TỰ ĐỘNG BÙ VÀO GOOGLE SHEET!
                logger.warn(`[Reconciliation] 🚨 Phát hiện bill BỊ LỠ: Khách "${finalCustomerName}" - ${ocrResult.amount}đ (${targetPlatform.name}). Đang ghi bù vào Google Sheet...`);

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
                    trafficSource: targetPlatform.name
                  });

                  // Thêm vào danh sách tạm để không bị trùng lặp ở lần quét tiếp theo
                  todaySheetRows.push({
                    rowNumber: sheetRowNumber || 0,
                    date: todayVN,
                    customerName: finalCustomerName,
                    readerName: detectedReaderName,
                    packageName: 'Tarot',
                    amount: ocrResult.amount,
                    rawAmount: ocrResult.amount.toString(),
                    pageName: displayPageName,
                    trafficSource: targetPlatform.name
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
                  time: msgDate.toLocaleTimeString('vi-VN'),
                  platform: targetPlatform.name
                });
              }
            }
          }
        }
      } catch (pageErr: any) {
        logger.error(`[Reconciliation] Lỗi rà soát Page ${page.page_name}:`, pageErr.response?.data || pageErr.message);
      }
    }

    // 3. Lấy tổng số đơn hiện tại trong ngày từ Google Sheet (đã cập nhật)
    const finalSheetRows = await GoogleSheetsService.getRowsByDate(todayVN);
    const totalRecorded = finalSheetRows.length;

    // 4. Tạo thông báo kết quả chi tiết
    let reportMessage = '';

    if (recoveredBills.length === 0) {
      reportMessage = 
`✅ <b>KẾT QUẢ RÀ SOÁT BILL NGÀY ${todayVN}</b>
━━━━━━━━━━━━━━━━━━━━━
📊 <b>Tổng bill quét trên Meta (FB + IG):</b> ${totalMetaBillsFound} bill
📊 <b>Tổng đơn đã có trên Google Sheet:</b> ${totalRecorded} đơn
🎯 <b>Trạng thái:</b> <b>KHỚP 100% VỚI GOOGLE SHEET</b>
<i>(Không có bill nào trên Meta bị bỏ sót trong ngày hôm nay!)</i>`;
    } else {
      let recoveredListText = '';
      for (const b of recoveredBills) {
        const rowStr = b.sheetRowNumber ? ` ➔ <i>Đã điền bù vào Dòng ${b.sheetRowNumber}</i>` : '';
        recoveredListText += `• [${b.platform}] Khách <b>${b.customerName}</b> (${b.time}): <b>${formatCurrencyVND(b.amount)}đ</b> (Reader: <b>${b.readerName}</b>)${rowStr}\n`;
      }

      reportMessage = 
`⚠️ <b>KẾT QUẢ RÀ SOÁT: ĐÃ TỰ ĐỘNG BÙ ${recoveredBills.length} BILL BỊ LỠ!</b>
━━━━━━━━━━━━━━━━━━━━━
<b>Chi tiết các bill từ Meta vừa được đối chiếu và bù vào Google Sheet:</b>
${recoveredListText}
━━━━━━━━━━━━━━━━━━━━━
📊 <b>Tổng đơn hôm nay sau khi bù:</b> ${totalRecorded} đơn
✅ Hệ thống đã tự động bảo toàn 100% doanh thu trên Google Sheet cho bạn!`;
    }

    // 5. Bắn thông báo về Telegram
    const bot = TelegramService.getBot();
    const chatId = config.telegram.managerChatId;
    if (bot && chatId) {
      await bot.sendMessage(chatId, reportMessage, { parse_mode: 'HTML' });
    }

    return reportMessage;
  }
}
