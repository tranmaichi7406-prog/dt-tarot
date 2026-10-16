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

  // 2. Lệnh /doi [Số_Đơn] [Tên_Reader_Mới] (Ví dụ: /doi 1 My)
  bot.onText(/\/doi(?:\s+(\d+)\s+([^\s]+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    if (!match || !match[1] || !match[2]) {
      bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/doi [Số_Đơn] [Tên_Reader_Mới]</code>\nVí dụ: <code>/doi 1 My</code>', { parse_mode: 'HTML' });
      return;
    }

    const orderNumber = parseInt(match[1], 10);
    const newReaderName = match[2].trim();

    try {
      // 1. Tìm đơn hàng hôm nay theo số thứ tự đơn
      const tx = TransactionModel.getByTodayOrderNumber(orderNumber);
      if (!tx) {
        bot.sendMessage(chatId, `❌ Không tìm thấy <b>ĐƠN #${orderNumber}</b> trong ngày hôm nay.`, { parse_mode: 'HTML' });
        return;
      }

      // 2. Tìm thông tin Reader mới
      const newReader = ReaderModel.getByName(newReaderName);
      if (!newReader) {
        bot.sendMessage(chatId, `❌ Không tìm thấy Reader có tên "<b>${newReaderName}</b>". Dùng lệnh <code>/listreaders</code> để kiểm tra.`, { parse_mode: 'HTML' });
        return;
      }

      // 3. Tính lại hoa hồng theo % của Reader mới
      const newRate = newReader.commission_rate || 40.0;
      const newCommission = Math.round(tx.amount * (newRate / 100));

      // 4. Cập nhật vào Database
      TransactionModel.updateReaderForOrder(orderNumber, newReader.id, newRate, newCommission);

      // 5. Cập nhật lại Cột C trên Google Sheets nếu có lưu sheet_row_number
      let sheetStatusText = '';
      if (tx.sheet_row_number) {
        const sheetUpdated = await GoogleSheetsService.updateReaderColumn(tx.sheet_row_number, newReader.reader_name);
        if (sheetUpdated) {
          sheetStatusText = `\n• Google Sheets: Đã cập nhật dòng <b>${tx.sheet_row_number}</b> Cột C thành "<b>${newReader.reader_name}</b>"`;
        } else {
          sheetStatusText = '\n• Google Sheets: Cập nhật Cột C thất bại (Vui lòng kiểm tra lại quyền file Sheets)';
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

  // 3. Lệnh /themreader [Tên] [Chữ_Ký] [%_Hoa_Hồng] (Ví dụ: /themreader My [My] 40)
  bot.onText(/\/themreader(?:\s+([^\s]+)\s+([^\s]+)(?:\s+(\d+(?:\.\d+)?))?)?/, (msg, match) => {
    const chatId = msg.chat.id;

    if (!match || !match[1] || !match[2]) {
      bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/themreader [Tên] [Chữ_Ký] [%_Hoa_Hồng]</code>\nVí dụ: <code>/themreader My [My] 40</code>', { parse_mode: 'HTML' });
      return;
    }

    const readerName = match[1].trim();
    const tagPrefix = match[2].trim();
    const commissionRate = match[3] ? parseFloat(match[3]) : 40.0;

    try {
      const allPages = PageModel.getAll();
      const defaultPageId = allPages.length > 0 ? allPages[0].id : 1;

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
