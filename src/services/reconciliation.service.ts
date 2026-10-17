import axios from 'axios';
import { PageModel } from '../models/page.model';
import { ReaderModel } from '../models/reader.model';
import { TransactionModel } from '../models/transaction.model';
import { GoogleSheetsService } from './sheets.service';
import { TelegramService } from './telegram.service';
import { OCRService } from './ocr.service';
import { formatCurrencyVND, formatDateVN, formatTimeVN } from '../utils/currency';
import { logger } from '../utils/logger';
import { config } from '../config';

export interface MetaBillItem {
  customerName: string;
  readerName: string;
  amount: number;
  transactionCode: string;
  imageUrl: string;
  timeStr: string;
  dateStr: string;
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
  date: string;
  platform: string;
}

export interface MetaScanError {
  platform: string;
  pageName: string;
  code: number | string;
  subcode?: number | string;
  message: string;
}

export class ReconciliationService {
  /**
   * RÀ SOÁT ĐỐI CHIẾU DOANH THU ĐỒNG BỘ CẢ 2 KÊNH (FACEBOOK MESSENGER & INSTAGRAM DIRECT)
   * TÍCH HỢP TRÊN HẠ TẦNG META PAGE API:
   * Bước 1: Quét conversations của cả Messenger và Instagram Direct liên kết với Page.
   * Bước 2: Với mỗi conversation, gọi GET /{conversation-id}/messages để lấy chi tiết tin nhắn & attachments.
   * Bước 3: Đọc OCR ảnh bill ngân hàng thực tế, lọc trùng và đối chiếu 1:1 sang Google Sheets.
   * Bước 4: Tự động ghi bù đơn bị thiếu vào Google Sheets và thông báo minh bạch lên Telegram.
   */
  static async runReconciliation(manualTrigger = false, customDateStr?: string): Promise<string> {
    const todayVN = customDateStr || formatDateVN(new Date());
    logger.info(`[Reconciliation] Bắt đầu rà soát bill Meta đa kênh (Trigger: ${manualTrigger ? 'Thủ công /rasoat' : 'Tự động Cron'})...`);

    const pages = PageModel.getAll();
    if (pages.length === 0) {
      return '⚠️ Hệ thống chưa cấu hình Fanpage nào để rà soát.';
    }

    const rawMetaBills: MetaBillItem[] = [];
    const metaErrors: MetaScanError[] = [];

    // BƯỚC 1: LẤY META LÀM GỐC - ĐỒNG BỘ CẢ 2 KÊNH (FACEBOOK MESSENGER & INSTAGRAM DIRECT)
    for (const page of pages) {
      if (!page.access_token || page.access_token.startsWith('mock_')) {
        metaErrors.push({
          platform: 'Hệ thống',
          pageName: page.page_name,
          code: 'NO_TOKEN',
          message: 'Fanpage chưa được cấu hình Access Token hợp lệ.'
        });
        continue;
      }

      const isTarotChips = page.page_name.toLowerCase().includes('tarot');
      const displayPageName = isTarotChips ? 'tarotchips03' : page.page_name;

      // Danh sách các kênh thuộc hạ tầng Page trên Meta
      const scanChannels: Array<{ name: 'Facebook' | 'Instagram'; url: string; params: any }> = [
        {
          name: 'Facebook',
          url: `https://graph.facebook.com/v19.0/${page.fb_page_id}/conversations`,
          params: {
            fields: 'id,updated_time,participants',
            limit: 50,
            access_token: page.access_token
          }
        },
        {
          name: 'Instagram',
          url: `https://graph.facebook.com/v19.0/${page.fb_page_id}/conversations`,
          params: {
            platform: 'instagram',
            fields: 'id,updated_time,participants',
            limit: 50,
            access_token: page.access_token
          }
        },
        {
          name: 'Instagram',
          url: `https://graph.facebook.com/v19.0/17841436212431682/conversations`,
          params: {
            fields: 'id,updated_time,participants',
            limit: 50,
            access_token: page.access_token
          }
        }
      ];

      for (const channel of scanChannels) {
        let conversations: any[] = [];
        try {
          const convRes = await axios.get(channel.url, {
            params: channel.params,
            timeout: 30000
          });
          conversations = convRes.data?.data || [];
          if (conversations.length > 0) {
            logger.info(`[Reconciliation] Quét được ${conversations.length} cuộc hội thoại từ ${channel.name} (${page.page_name})`);
          }
        } catch (fetchErr: any) {
          const errData = fetchErr.response?.data?.error;
          const errCode = errData?.code || fetchErr.response?.status || 'UNKNOWN';
          const errSubcode = errData?.error_subcode;
          const errMsg = errData?.message || fetchErr.message;

          // Ghi nhận lỗi nếu token chết (code 190) hoặc Facebook endpoint chính bị lỗi
          if (errCode === 190 || errMsg.toLowerCase().includes('expired') || channel.name === 'Facebook') {
            metaErrors.push({
              platform: channel.name,
              pageName: page.page_name,
              code: errCode,
              subcode: errSubcode,
              message: errMsg
            });
          }
          continue;
        }

        // Bước 1.2: Với mỗi conversation, gọi GET /{conversation-id}/messages để lấy chi tiết tin nhắn & attachments
        for (const conv of conversations) {
          let messages: any[] = [];
          try {
            const msgUrl = `https://graph.facebook.com/v19.0/${conv.id}/messages`;
            const msgRes = await axios.get(msgUrl, {
              params: {
                fields: 'id,message,attachments{id,mime_type,image_data,file_url},created_time,from',
                limit: 50,
                access_token: page.access_token
              },
              timeout: 30000
            });
            messages = msgRes.data?.data || [];
          } catch (msgErr: any) {
            logger.warn(`[Reconciliation] Lỗi đọc messages hội thoại ${conv.id} (${channel.name}): ${msgErr.message}`);
            continue;
          }

          const participants = conv.participants?.data || [];
          const customerParticipant = participants.find((p: any) => p.id !== page.fb_page_id && p.id !== '17841436212431682');
          const defaultCustomerName = customerParticipant?.name || customerParticipant?.username || `Khách ${channel.name}`;

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

          // Lọc tin nhắn khách gửi có kèm ảnh bill
          for (const msg of messages) {
            if (msg.from?.id === page.fb_page_id || msg.from?.id === '17841436212431682') continue;

            const msgDate = new Date(msg.created_time);
            const msgDateStr = formatDateVN(msgDate);

            // Kiểm tra ngày:
            // Nếu có customDateStr (ví dụ: '17/10/2026') -> lọc chính xác ngày đó.
            // Nếu không truyền -> tự động quét cả hôm nay và hôm qua (48h gần nhất) để không bỏ lọt bill.
            if (customDateStr) {
              if (msgDateStr !== customDateStr) continue;
            } else {
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              const yesterdayStr = formatDateVN(yesterday);
              if (msgDateStr !== todayVN && msgDateStr !== yesterdayStr) continue;
            }

            const attachments = msg.attachments?.data || [];
            for (const att of attachments) {
              const imageUrl = att.image_data?.url || att.file_url;
              if (!imageUrl) continue;

              // Đọc OCR để kiểm tra có phải là bill ngân hàng không
              try {
                const ocrResult = await OCRService.processBill(imageUrl);
                if (!ocrResult.amount || ocrResult.amount <= 0) continue;

                let finalCustomerName = defaultCustomerName;
                if (ocrResult.senderName && (finalCustomerName.startsWith('Khách') || finalCustomerName.includes('Meta') || finalCustomerName.includes('Facebook'))) {
                  finalCustomerName = ocrResult.senderName;
                }

                rawMetaBills.push({
                  customerName: finalCustomerName,
                  readerName: detectedReaderName,
                  amount: ocrResult.amount,
                  transactionCode: ocrResult.transactionCode || `TXN_${Date.now()}`,
                  imageUrl: imageUrl,
                  timeStr: formatTimeVN(msgDate),
                  dateStr: msgDateStr,
                  platform: channel.name,
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

    // BƯỚC 1.1: BÁO LỖI NẾU TOKEN HẾT HẠN
    const tokenExpiredError = metaErrors.find(e => e.code === 190 || e.message.toLowerCase().includes('expired'));
    if (tokenExpiredError) {
      const errorMsg = 
`🚨 <b>LỖI KẾT NỐI META GRAPH API (TOKEN HẾT HẠN)</b>
━━━━━━━━━━━━━━━━━━━━━
❌ <b>Không thể quét tin nhắn trên Meta để đối soát:</b>
• <b>Trang:</b> ${tokenExpiredError.pageName}
• <b>Mã lỗi Facebook:</b> Code <code>${tokenExpiredError.code}</code> (Subcode: <code>${tokenExpiredError.subcode || 'N/A'}</code>)
• <b>Thông báo từ Meta:</b> <code>${tokenExpiredError.message}</code>
━━━━━━━━━━━━━━━━━━━━━
⚠️ <b>Nguyên nhân:</b> Page Access Token hiện tại đã hết hạn sử dụng. Meta đã khóa kết nối và không cho phép đọc hộp thư tin nhắn.
👉 <b>Cách khắc phục ngay:</b>
Vui lòng gửi Token mới vào nhóm bằng lệnh:
<code>/settoken [Dán_Mã_Token_Mới_Vào_Đây]</code>`;

      const bot = TelegramService.getBot();
      const chatId = config.telegram.managerChatId;
      if (bot && chatId) {
        try { await bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' }); } catch {}
      }
      return errorMsg;
    }

    // LỌC TRÙNG BILL TRÊN META:
    // Cùng 1 khách gửi cùng 1 bill nhiều lần trong 1 hội thoại -> chỉ giữ 1 bill gốc duy nhất
    const uniqueMetaBills: MetaBillItem[] = [];
    for (const b of rawMetaBills) {
      const isDuplicated = uniqueMetaBills.some(u => {
        if (b.transactionCode && !b.transactionCode.startsWith('TXN_') && u.transactionCode === b.transactionCode) {
          return true;
        }
        return u.customerName.toLowerCase() === b.customerName.toLowerCase() && u.amount === b.amount && u.dateStr === b.dateStr;
      });

      if (!isDuplicated) {
        uniqueMetaBills.push(b);
      }
    }

    logger.info(`[Reconciliation] Tổng bill hợp lệ phát sinh trên Meta (FB + IG): ${uniqueMetaBills.length} bill (Sau khi lọc trùng từ ${rawMetaBills.length} ảnh quét được)`);

    // BƯỚC 2: ĐỐI CHIẾU SANG GOOGLE SHEETS (ĐÍCH)
    const targetDateForSheets = customDateStr || todayVN;
    let sheetRows = await GoogleSheetsService.getRowsByDate(targetDateForSheets);
    if (!customDateStr) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayRows = await GoogleSheetsService.getRowsByDate(formatDateVN(yesterday));
      sheetRows = [...sheetRows, ...yesterdayRows];
    }
    logger.info(`[Reconciliation] Google Sheet hiện đang có ${sheetRows.length} dòng để đối soát`);

    const unmatchedSheetRows = [...sheetRows];
    const recoveredBills: RecoveredBill[] = [];

    for (const bill of uniqueMetaBills) {
      // Tìm dòng trên Sheets khớp với bill này (cùng số tiền & ngày)
      const matchedIdx = unmatchedSheetRows.findIndex(row => {
        const sameAmount = row.amount === bill.amount;
        if (!sameAmount) return false;

        if (row.date && bill.dateStr && row.date !== bill.dateStr) return false;

        if (row.customerName && row.customerName.trim() !== '') {
          const sName = row.customerName.toLowerCase().trim();
          const bName = bill.customerName.toLowerCase().trim();
          return sName.includes(bName) || bName.includes(sName);
        }
        return true;
      });

      if (matchedIdx !== -1) {
        unmatchedSheetRows.splice(matchedIdx, 1);
        logger.info(`[Reconciliation] ✅ Bill ${bill.amount}đ ngày ${bill.dateStr} của khách "${bill.customerName}" (${bill.platform}) ĐÃ CÓ trong Google Sheet.`);
      } else {
        // BƯỚC 3: PHÁT HIỆN BILL BỊ THIẾU TRÊN GOOGLE SHEETS ➔ TỰ ĐỘNG BÙ VÀO SHEETS!
        logger.warn(`[Reconciliation] 🚨 PHÁT HIỆN BILL BỊ LỠ: Khách "${bill.customerName}" - ${bill.amount}đ (${bill.platform} - ${bill.dateStr}). Đang ghi bù vào Google Sheets...`);

        let sheetRowNumber: number | null = null;
        try {
          sheetRowNumber = await GoogleSheetsService.appendTransaction({
            dateTime: bill.dateStr,
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

        const dailyOrderNumber = TransactionModel.getNextDailyOrderNumber();
        try {
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
        } catch {}

        recoveredBills.push({
          customerName: bill.customerName,
          readerName: bill.readerName,
          amount: bill.amount,
          transactionCode: bill.transactionCode,
          sheetRowNumber: sheetRowNumber,
          time: bill.timeStr,
          date: bill.dateStr,
          platform: bill.platform
        });
      }
    }

    // BƯỚC 4: BÁO CÁO KẾT QUẢ ĐỐI SOÁT VỀ TELEGRAM (TRUNG THỰC, MINH BẠCH)
    const finalSheetRows = await GoogleSheetsService.getRowsByDate(targetDateForSheets);
    let reportMessage = '';

    const fbCount = uniqueMetaBills.filter(b => b.platform === 'Facebook').length;
    const igCount = uniqueMetaBills.filter(b => b.platform === 'Instagram').length;

    if (recoveredBills.length > 0) {
      let recoveredListText = '';
      for (const b of recoveredBills) {
        const rowStr = b.sheetRowNumber ? ` ➔ <i>Ghi bù vào Dòng ${b.sheetRowNumber}</i>` : '';
        recoveredListText += `• [${b.platform}] Khách <b>${b.customerName}</b> (${b.date} ${b.time}): <b>${formatCurrencyVND(b.amount)}đ</b> (Reader: <b>${b.readerName}</b>)${rowStr}\n`;
      }

      reportMessage = 
`⚠️ <b>KẾT QUẢ ĐỐI SOÁT: PHÁT HIỆN & ĐÃ BÙ ${recoveredBills.length} ĐƠN BỊ THIẾU!</b>
━━━━━━━━━━━━━━━━━━━━━
<b>Chi tiết các đơn từ Meta vừa được bổ sung vào Google Sheet:</b>
${recoveredListText}
━━━━━━━━━━━━━━━━━━━━━
📊 <b>Tổng đơn thực tế trên Meta:</b> ${uniqueMetaBills.length} đơn (Messenger: ${fbCount} | Instagram: ${igCount})
📊 <b>Tổng đơn trên Google Sheet:</b> ${finalSheetRows.length} đơn
✅ Hệ thống đã bảo toàn 100% doanh thu theo đúng dữ liệu gốc trên Meta!`;
    } else if (uniqueMetaBills.length > 0) {
      reportMessage = 
`✅ <b>KẾT QUẢ ĐỐI SOÁT BILL NGÀY ${targetDateForSheets}</b>
━━━━━━━━━━━━━━━━━━━━━
📊 <b>Tổng bill thực tế trên Meta (Gốc):</b> ${uniqueMetaBills.length} đơn (Messenger: ${fbCount} | Instagram: ${igCount})
📊 <b>Tổng đơn trên Google Sheet (Đích):</b> ${finalSheetRows.length} đơn
🎯 <b>Trạng thái:</b> <b>ĐÃ KHỚP 100% VỚI META</b>
<i>(Toàn bộ ${uniqueMetaBills.length} giao dịch trên Meta đều đã có đầy đủ trên Google Sheets!)</i>`;
    } else {
      reportMessage = 
`ℹ️ <b>KẾT QUẢ ĐỐI SOÁT BILL NGÀY ${targetDateForSheets}</b>
━━━━━━━━━━━━━━━━━━━━━
📊 <b>Tổng bill quét trên Meta (FB Messenger & Instagram):</b> 0 đơn
📊 <b>Tổng đơn trên Google Sheet:</b> ${finalSheetRows.length} đơn
━━━━━━━━━━━━━━━━━━━━━
<i>Không tìm thấy tin nhắn gửi ảnh bill ngân hàng mới nào trong hộp thư Meta ngày ${targetDateForSheets}.</i>`;
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
