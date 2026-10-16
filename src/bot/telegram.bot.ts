import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from '../services/telegram.service';
import { PageModel } from '../models/page.model';
import { ReaderModel } from '../models/reader.model';
import { TransactionModel } from '../models/transaction.model';
import { GoogleSheetsService } from '../services/sheets.service';
import { formatCurrencyVND } from '../utils/currency';
import { logger } from '../utils/logger';

export function setupTelegramBotCommands(): void {
  const bot = TelegramService.getBot();
  if (!bot) {
    logger.warn('[TelegramBot] Bot chưa được khởi tạo, bỏ qua thiết lập lệnh.');
    return;
  }

  // 1. Lệnh /start và /help
  bot.onText(/\/(start|help)/, (msg) => {
    const chatId = msg.chat.id;
    const helpText = 
`🔮 <b>BỘ LỆNH ĐIỀU KHIỂN HỆ THỐNG DT TAROT</b>
━━━━━━━━━━━━━━━━━━━━━
<b>1. Đổi Reader cho đơn vừa nhận:</b>
• <code>/doi [Số_Đơn] [Tên_Reader_Mới]</code>
<i>Ví dụ: <code>/doi 1 My</code> ➔ Đổi đơn #1 sang reader My, tự tính lại hoa hồng và tự sửa Cột C trên Google Sheets.</i>

<b>2. Quản lý Reader:</b>
• <code>/themreader [Tên] [Chữ_Ký] [%_Hoa_Hồng]</code>
<i>Ví dụ: <code>/themreader My [My] 40</code></i>
• <code>/xoareader [Tên]</code>
<i>Ví dụ: <code>/xoareader My</code></i>
• <code>/listreaders</code>: Xem danh sách tất cả Reader.

<b>3. Quản lý Page:</b>
• <code>/thempage [Tên_Page] [Page_ID] [Page_Access_Token]</code>
<i>Ví dụ: <code>/thempage tarotchips03 992148840643936 EAAB...</code></i>
• <code>/xoapage [Tên_Page]</code>
• <code>/listpages</code>: Xem danh sách Fanpage đang kết nối.

<b>4. Xem Báo Cáo Doanh Thu:</b>
• <code>/baocao</code>: Xem tổng hợp doanh thu & hoa hồng trong ngày.`;
    bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
  });

  // 2. Lệnh /doi [Số_Đơn] [Tên_Reader_Mới] (Hỗ trợ cả /doi 1 Chi, /doi Chi, /doi@bot 1 Chi)
  bot.onText(/\/(?:doi)(?:@\w+)?(?:\s+(\d+))?(?:\s+([^\s]+))?/i, async (msg, match) => {
    const chatId = msg.chat.id;

    let orderNumber: number | null = match && match[1] ? parseInt(match[1], 10) : null;
    let newReaderName: string | null = match && match[2] ? match[2].trim() : null;

    // Nếu người dùng chỉ gõ /doi Chi (không gõ số đơn), tự động lấy đơn mới nhất hôm nay
    if (!orderNumber && match && match[1] && isNaN(parseInt(match[1], 10))) {
      newReaderName = match[1].trim();
      const allTxToday = TransactionModel.getTodayTransactions();
      if (allTxToday.length > 0) {
        orderNumber = allTxToday[allTxToday.length - 1].daily_order_number;
      }
    }

    if (!newReaderName) {
      bot.sendMessage(chatId, '⚠️ Cú pháp đổi Reader:\n• <code>/doi [Số_Đơn] [Tên_Reader_Mới]</code>\n<i>Ví dụ: <code>/doi 1 Chi</code> hoặc <code>/doi 1 NA</code></i>', { parse_mode: 'HTML' });
      return;
    }

    // Nếu vẫn chưa có số đơn, mặc định là đơn #1
    if (!orderNumber) {
      orderNumber = 1;
    }

    try {
      // 1. Tìm đơn hàng hôm nay theo số thứ tự đơn
      const tx = TransactionModel.getByTodayOrderNumber(orderNumber);
      if (!tx) {
        bot.sendMessage(chatId, `❌ Không tìm thấy <b>ĐƠN #${orderNumber}</b> trong ngày hôm nay.`, { parse_mode: 'HTML' });
        return;
      }

      // 2. Tìm thông tin Reader mới (hoặc tự tạo nếu chưa có)
      let newReader = ReaderModel.getByName(newReaderName);
      if (!newReader) {
        // Tự tạo nhanh nếu là Chi hoặc NA
        const defaultTag = newReaderName.toLowerCase() === 'chi' ? '.' : (newReaderName.toLowerCase() === 'na' ? ',' : `[${newReaderName}]`);
        newReader = ReaderModel.create({
          page_id: tx.page_id,
          reader_name: newReaderName,
          tag_prefix: defaultTag,
          commission_rate: 40.0
        });
      }

      // 3. Tính lại hoa hồng theo % của Reader mới
      const newRate = newReader.commission_rate || 40.0;
      const newCommission = Math.round(tx.amount * (newRate / 100));

      // 4. Cập nhật vào Database
      TransactionModel.updateReaderForOrder(orderNumber, newReader.id, newRate, newCommission);

      // 5. Cập nhật lại Cột C trên Google Sheets
      let sheetStatusText = '';
      if (tx.sheet_row_number) {
        const sheetUpdated = await GoogleSheetsService.updateReaderColumn(tx.sheet_row_number, newReader.reader_name);
        if (sheetUpdated) {
          sheetStatusText = `\n• Google Sheets: Đã cập nhật dòng <b>${tx.sheet_row_number}</b> Cột C thành "<b>${newReader.reader_name}</b>"`;
        } else {
          sheetStatusText = '\n• Google Sheets: Cập nhật Cột C thất bại (Vui lòng kiểm tra quyền file Sheets)';
        }
      }

      const responseText = 
`✅ <b>ĐÃ ĐỔI READER CHO ĐƠN #${orderNumber}!</b>
━━━━━━━━━━━━━━━━━━━━━
• Khách hàng: <b>${tx.customer_name}</b>
• Số tiền: <b>${formatCurrencyVND(tx.amount)}đ</b>
• Reader mới: <b>${newReader.reader_name}</b> (Hoa hồng: <b>${formatCurrencyVND(newCommission)}đ</b> - ${newRate}%)${sheetStatusText}`;

      bot.sendMessage(chatId, responseText, { parse_mode: 'HTML' });
    } catch (err: any) {
      bot.sendMessage(chatId, `❌ Lỗi khi đổi reader: ${err.message}`);
    }
  });

  // 3. Lệnh /them hoặc /themreader (Hỗ trợ: /them Chi, /them_Chi, /themreader Chi . 40)
  bot.onText(/\/(?:themreader|them)(?:_([^\s@]+)|@\w+)?(?:\s+([^\s]+))?(?:\s+([^\s]+))?(?:\s+(\d+(?:\.\d+)?))?/i, (msg, match) => {
    const chatId = msg.chat.id;

    const rawName = match ? (match[1] || match[2]) : '';
    const readerName = rawName ? rawName.trim() : '';

    if (!readerName) {
      bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/them [Tên_Reader]</code> hoặc <code>/themreader [Tên] [Chữ_Ký] [%_Hoa_Hồng]</code>\n<i>Ví dụ: <code>/them Chi</code> hoặc <code>/them NA</code></i>', { parse_mode: 'HTML' });
      return;
    }

    // Tự động gán chữ ký mặc định nếu không điền
    let tagPrefix = match && match[3] ? match[3].trim() : '';
    if (!tagPrefix) {
      tagPrefix = readerName.toLowerCase() === 'chi' ? '.' : (readerName.toLowerCase() === 'na' ? ',' : `[${readerName}]`);
    }

    const commissionRate = match && match[4] ? parseFloat(match[4]) : 40.0;

    try {
      const allPages = PageModel.getAll();
      const defaultPageId = allPages.length > 0 ? allPages[0].id : 1;

      // Kiểm tra xem reader đã có chưa
      let reader = ReaderModel.getByName(readerName);
      if (reader) {
        bot.sendMessage(chatId, `ℹ️ Reader <b>${reader.reader_name}</b> đã có sẵn trên hệ thống (Chữ ký: <code>${reader.tag_prefix}</code>, Hoa hồng: <b>${reader.commission_rate}%</b>).`, { parse_mode: 'HTML' });
        return;
      }

      const newReader = ReaderModel.create({
        page_id: defaultPageId,
        reader_name: readerName,
        tag_prefix: tagPrefix,
        commission_rate: commissionRate
      });

      bot.sendMessage(chatId, `✅ <b>ĐÃ THÊM READER THÀNH CÔNG!</b>\n• Tên: <b>${newReader.reader_name}</b>\n• Chữ ký nhận ca: <code>${newReader.tag_prefix}</code>\n• Hoa hồng: <b>${newReader.commission_rate}%</b>`, { parse_mode: 'HTML' });
    } catch (err: any) {
      bot.sendMessage(chatId, `❌ Lỗi thêm reader: ${err.message}`);
    }
  });

  // 4. Lệnh /xoareader [Tên]
  bot.onText(/\/xoareader(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const name = match ? match[1]?.trim() : '';

    if (!name) {
      bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/xoareader [Tên]</code>\nVí dụ: <code>/xoareader My</code>', { parse_mode: 'HTML' });
      return;
    }

    const deleted = ReaderModel.deleteByName(name);
    if (deleted) {
      bot.sendMessage(chatId, `✅ Đã xóa Reader "<b>${name}</b>" khỏi hệ thống.`, { parse_mode: 'HTML' });
    } else {
      bot.sendMessage(chatId, `❌ Không tìm thấy Reader có tên "<b>${name}</b>".`, { parse_mode: 'HTML' });
    }
  });

  // 5. Lệnh /listreaders
  bot.onText(/\/listreaders/, (msg) => {
    const chatId = msg.chat.id;
    const readers = ReaderModel.getAll();

    if (readers.length === 0) {
      bot.sendMessage(chatId, 'Hiện chưa có Reader nào. Thêm bằng lệnh: <code>/themreader [Tên] [Chữ_Ký] [%_Hoa_Hồng]</code>', { parse_mode: 'HTML' });
      return;
    }

    let text = `👥 <b>DANH SÁCH READER TRÊN HỆ THỐNG:</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const r of readers) {
      text += `• Reader: <b>${r.reader_name}</b> | Chữ ký: <code>${r.tag_prefix}</code> | Hoa hồng: <b>${r.commission_rate}%</b>\n`;
    }
    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  });

  // 6. Lệnh /thempage [Tên_Page] [Page_ID] [Page_Access_Token]
  bot.onText(/\/thempage(?:\s+([^\s]+)\s+([^\s]+)\s+([^\s]+))?/, (msg, match) => {
    const chatId = msg.chat.id;

    if (!match || !match[1] || !match[2] || !match[3]) {
      bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/thempage [Tên_Page] [Page_ID] [Page_Access_Token]</code>\nVí dụ: <code>/thempage tarotchips03 992148840643936 EAAB...</code>', { parse_mode: 'HTML' });
      return;
    }

    const pageName = match[1].trim();
    const fbPageId = match[2].trim();
    const token = match[3].trim();

    try {
      const newPage = PageModel.create({
        page_name: pageName,
        fb_page_id: fbPageId,
        access_token: token
      });
      bot.sendMessage(chatId, `✅ <b>KẾT NỐI FANPAGE THÀNH CÔNG!</b>\n• Tên Page: <b>${newPage.page_name}</b>\n• FB Page ID: <code>${newPage.fb_page_id}</code>`, { parse_mode: 'HTML' });
    } catch (err: any) {
      bot.sendMessage(chatId, `❌ Lỗi thêm Page: ${err.message}`);
    }
  });

  // 7. Lệnh /xoapage [Tên_Page]
  bot.onText(/\/xoapage(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const pageName = match ? match[1]?.trim() : '';

    if (!pageName) {
      bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/xoapage [Tên_Page]</code>\nVí dụ: <code>/xoapage tarotchips03</code>', { parse_mode: 'HTML' });
      return;
    }

    const deleted = PageModel.deleteByName(pageName);
    if (deleted) {
      bot.sendMessage(chatId, `✅ Đã xóa Page "<b>${pageName}</b>" khỏi hệ thống.`, { parse_mode: 'HTML' });
    } else {
      bot.sendMessage(chatId, `❌ Không tìm thấy Page có tên "<b>${pageName}</b>".`, { parse_mode: 'HTML' });
    }
  });

  // 8. Lệnh /listpages
  bot.onText(/\/listpages/, (msg) => {
    const chatId = msg.chat.id;
    const pages = PageModel.getAll();

    if (pages.length === 0) {
      bot.sendMessage(chatId, 'Chưa có Page nào. Thêm bằng lệnh: <code>/thempage [Tên_Page] [Page_ID] [Token]</code>', { parse_mode: 'HTML' });
      return;
    }

    let text = `📋 <b>DANH SÁCH FANPAGE ĐANG HOẠT ĐỘNG:</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const p of pages) {
      text += `📍 <b>${p.page_name}</b> (ID: <code>${p.fb_page_id}</code>)\n`;
    }
    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  });

  // 9. Lệnh /baocao
  bot.onText(/\/baocao/, (msg) => {
    const chatId = msg.chat.id;
    const systemReport = TelegramService.generateSystemDailyReportMessage();
    bot.sendMessage(chatId, systemReport, { parse_mode: 'HTML' });
  });

  logger.info('[TelegramBot] Đã đăng ký tất cả các lệnh tương tác Telegram siêu ngắn!');
}
