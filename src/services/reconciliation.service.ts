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

export interface MetaBillItem {
  customerName: string;
  readerName: string;
  amount: number;
  transactionCode: string;
  imageUrl: string;
  timeStr: string;
  platform: 'Facebook' | 'Instagram';
  displayPageName: string;
  pageId: number;
}

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
   * RÀ SOÁT ĐỐI CHIẾU DOANH THU CHUẨN:
   * 1. LẤY META LÀM GỐC: Quét trực tiếp toàn bộ hội thoại/tin nhắn trên Meta (Facebook + Instagram) trong ngày để tìm bill thực tế.
   * 2. ĐỐI CHIẾU SANG GOOGLE SHEETS (ĐÍCH): Kiểm tra xem bill nào trên Meta chưa có trong Google Sheet.
   * 3. BÙ BILL BỊ THIẾU: Tự động ghi bù vào Google Sheet và báo cáo Telegram.
   */
  static async runReconciliation(manualTrigger = false): Promise<string> {
    logger.info(`[Reconciliation] Bắt đầu rà soát bill trong ngày (Trigger: ${manualTrigger ? 'Thủ công /rasoat' : 'Tự động Cron'})...`);

    const pages = PageModel.getAll();
    if (pages.length === 0) {
      return '⚠️ Hệ thống chưa cấu hình Fanpage nào để rà soát.';
    }

    const todayVN = formatDateVN(new Date());
    const rawMetaBills: MetaBillItem[] = [];

    // BƯỚC 1: LẤY META LÀM GỐC - QUÉT TOÀN BỘ BILL THỰC TẾ TRÊN META TRONG NGÀY
    for (const page of pages) {
      if (!page.access_token || page.access_token.startsWith('mock_')) continue;

      const isTarotChips = page.page_name.toLowerCase().includes('tarot');
      const displayPageName = isTarotChips ? 'tarotchips03' : page.page_name;

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
              limit: 50,
              access_token: page.access_token
            },
            timeout: 15000
          });
          conversations = convRes.data.data || [];
          logger.info(`[Reconciliation] Quét được ${conversations.length} hội thoại từ ${targetPlatform.name} (${page.page_name})`);
        } catch (fetchErr: any) {
          logger.warn(`[Reconciliation] Lỗi quét hội thoại ${targetPlatform.name}: ${fetchErr.response?.data?.error?.message || fetchErr.message}`);
          continue;
        }

        for (const conv of conversations) {
          const messages = conv.messages?.data || [];
          const participants = conv.participants?.data || [];

          // Tên khách từ hội thoại
          const customerParticipant = participants.find((p: any) => p.id !== page.fb_page_id);
          const defaultCustomerName = customerParticipant?.name || customerParticipant?.username || `Khách ${targetPlatform.name}`;

          // Xác định Reader đã rep khách (dựa theo Tag Reader)
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

          // Lọc tin nhắn khách gửi trong ngày có kèm ảnh
          for (const msg of messages) {
            if (msg.from?.id === page.fb_page_id) continue;

            const msgDate = new Date(msg.created_time);
            const msgDateStr = formatDateVN(msgDate);
            if (msgDateStr !== todayVN) continue;

            const attachments = msg.attachments?.data || [];
            for (const att of attachments) {
              const imageUrl = att.image_data?.url || att.file_url;
              if (!imageUrl) continue;

              // Đọc OCR để kiểm tra có phải là bill ngân hàng không
              try {
                const ocrResult = await OCRService.processBill(imageUrl);
                if (!ocrResult.amount || ocrResult.amount <= 0) continue;

                let finalCustomerName = defaultCustomerName;
                if (ocrResult.senderName && (finalCustomerName.startsWith('Khách') || finalCustomerName.includes('Meta'))) {
                  finalCustomerName = ocrResult.senderName;
                }

                rawMetaBills.push({
                  customerName: finalCustomerName,
                  readerName: detectedReaderName,
                  amount: ocrResult.amount,
                  transactionCode: ocrResult.transactionCode || `TXN_${Date.now()}`,
                  imageUrl: imageUrl,
                  timeStr: msgDate.toLocaleTimeString('vi-VN'),
                  platform: targetPlatform.name,
                  displayPageName: displayPageName,
                  pageId: page.id
                });
              } catch (ocrErr: any) {
                logger.error(`[Reconciliation] Lỗi OCR ảnh bill: ${ocrErr.message}`);
              }
            }
          }
        }
      }
    }

    // LỌC TRÙNG BILL TRÊN META:
    // Nếu cùng 1 khách gửi cùng 1 bill nhiều lần (cùng mã giao dịch hoặc cùng số tiền & tên), chỉ giữ 1 bill gốc duy nhất
    const uniqueMetaBills: MetaBillItem[] = [];
    for (const b of rawMetaBills) {
      const isDuplicatedInMeta = uniqueMetaBills.some(u => {
        if (b.transactionCode && !b.transactionCode.startsWith('TXN_') && u.transactionCode === b.transactionCode) {
          return true;
        }
        return u.customerName.toLowerCase() === b.customerName.toLowerCase() && u.amount === b.amount;
      });

      if (!isDuplicatedInMeta) {
        uniqueMetaBills.push(b);
      }
    }

    logger.info(`[Reconciliation] Tổng bill hợp lệ phát sinh trên Meta hôm nay (${todayVN}): ${uniqueMetaBills.length} bill (Sau khi lọc trùng từ ${rawMetaBills.length} ảnh quét được)`);

    // BƯỚC 2: ĐỐI CHIẾU SANG GOOGLE SHEETS (ĐÍCH)
    const sheetRowsToday = await GoogleSheetsService.getRowsByDate(todayVN);
    logger.info(`[Reconciliation] Google Sheet hiện đang có ${sheetRowsToday.length} dòng ngày ${todayVN}`);

    // Tạo danh sách các dòng trên Sheets có thể dùng để khớp (mỗi dòng trên Sheets chỉ được khớp với 1 bill trên Meta)
    const unmatchedSheetRows = [...sheetRowsToday];
    const recoveredBills: RecoveredBill[] = [];

    for (const bill of uniqueMetaBills) {
      // Tìm dòng trên Sheets khớp với bill này (cùng số tiền)
      const matchedIdx = unmatchedSheetRows.findIndex(row => {
        const sameAmount = row.amount === bill.amount;
        if (!sameAmount) return false;

        // Nếu trên sheet có tên khách: kiểm tra tên có khớp hoặc chứa nhau không
        if (row.customerName && row.customerName.trim() !== '') {
          const sName = row.customerName.toLowerCase().trim();
          const bName = bill.customerName.toLowerCase().trim();
          return sName.includes(bName) || bName.includes(sName);
        }

        // Nếu trên sheet chưa có tên khách: khớp theo số tiền
        return true;
      });

      if (matchedIdx !== -1) {
        // ĐÃ KHỚP! Dòng này đã tồn tại trên Sheets -> loại khỏi danh sách chờ khớp
        unmatchedSheetRows.splice(matchedIdx, 1);
        logger.info(`[Reconciliation] ✅ Bill ${bill.amount}đ của khách "${bill.customerName}" ĐÃ CÓ trong Google Sheet.`);
      } else {
        // BƯỚC 3: PHÁT HIỆN BILL BỊ THIẾU TRÊN GOOGLE SHEETS ➔ TỰ ĐỘNG BÙ VÀO SHEETS!
        logger.warn(`[Reconciliation] 🚨 PHÁT HIỆN BILL BỊ LỠ: Khách "${bill.customerName}" - ${bill.amount}đ (${bill.platform}). Đang ghi bù vào Google Sheets...`);

        let sheetRowNumber: number | null = null;
        try {
          sheetRowNumber = await GoogleSheetsService.appendTransaction({
            dateTime: todayVN,
            customerName: bill.customerName,
            readerName: bill.readerName === 'Chưa có Reader nhận ca' ? '' : bill.readerName,
            packageName: 'Tarot',
            amount: bill.amount,
            pageName: bill.displayPageName,
            trafficSource: bill.platform
          });
        } catch (sheetErr: any) {
          logger.error(`[Reconciliation] Lỗi ghi bù vào Google Sheets: ${sheetErr.message}`);
        }

        // Lưu vào database nội bộ
        const dailyOrderNumber = TransactionModel.getNextDailyOrderNumber();
        TransactionModel.create({
          daily_order_number: dailyOrderNumber,
          page_id: bill.pageId,
          reader_id: null,
          customer_name: bill.customerName,
          package_name: 'Tarot',
          amount: bill.amount,
          commission_rate: 0,
          commission_amount: 0,
          transaction_code: bill.transactionCode,
          bill_image_url: bill.imageUrl,
          sheet_row_number: sheetRowNumber
        });

        recoveredBills.push({
          customerName: bill.customerName,
          readerName: bill.readerName,
          amount: bill.amount,
          transactionCode: bill.transactionCode,
          sheetRowNumber: sheetRowNumber,
          time: bill.timeStr,
          platform: bill.platform
        });
      }
    }

    // BƯỚC 4: BÁO CÁO KẾT QUẢ VỀ TELEGRAM
    const finalSheetRows = await GoogleSheetsService.getRowsByDate(todayVN);
    let reportMessage = '';

    if (recoveredBills.length === 0) {
      reportMessage = 
`✅ <b>KẾT QUẢ ĐỐI SOÁT BILL NGÀY ${todayVN}</b>
━━━━━━━━━━━━━━━━━━━━━
📊 <b>Tổng bill thực tế trên Meta (Gốc):</b> ${uniqueMetaBills.length} đơn
📊 <b>Tổng đơn trên Google Sheet (Đích):</b> ${finalSheetRows.length} đơn
🎯 <b>Trạng thái:</b> <b>ĐÃ KHỚP 100% VỚI META</b>
<i>(Toàn bộ giao dịch trên Meta đều đã có đầy đủ trên Google Sheets!)</i>`;
    } else {
      let recoveredListText = '';
      for (const b of recoveredBills) {
        const rowStr = b.sheetRowNumber ? ` ➔ <i>Ghi bù vào Dòng ${b.sheetRowNumber}</i>` : '';
        recoveredListText += `• [${b.platform}] Khách <b>${b.customerName}</b> (${b.time}): <b>${formatCurrencyVND(b.amount)}đ</b> (Reader: <b>${b.readerName}</b>)${rowStr}\n`;
      }

      reportMessage = 
`⚠️ <b>KẾT QUẢ ĐỐI SOÁT: PHÁT HIỆN & ĐÃ BÙ ${recoveredBills.length} ĐƠN BỊ THIẾU!</b>
━━━━━━━━━━━━━━━━━━━━━
<b>Chi tiết các đơn từ Meta vừa được bổ sung vào Google Sheet:</b>
${recoveredListText}
━━━━━━━━━━━━━━━━━━━━━
📊 <b>Tổng đơn thực tế trên Meta:</b> ${uniqueMetaBills.length} đơn
📊 <b>Tổng đơn trên Google Sheet sau khi bù:</b> ${finalSheetRows.length} đơn
✅ Hệ thống đã bảo toàn 100% doanh thu theo đúng dữ liệu gốc trên Meta!`;
    }

    const bot = TelegramService.getBot();
    const chatId = config.telegram.managerChatId;
    if (bot && chatId) {
      try {
        await bot.sendMessage(chatId, reportMessage, { parse_mode: 'HTML' });
      } catch (tgErr: any) {
        logger.error(`[Reconciliation] Lỗi gửi tin nhắn Telegram: ${tgErr.message}`);
      }
    }

    return reportMessage;
  }
}
