import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from '../services/telegram.service';
import { PageModel } from '../models/page.model';
import { ReaderModel } from '../models/reader.model';
import { TransactionModel } from '../models/transaction.model';
import { GoogleSheetsService } from '../services/sheets.service';
import { ReconciliationService } from '../services/reconciliation.service';
import { formatCurrencyVND } from '../utils/currency';
import { logger } from '../utils/logger';

export function setupTelegramBotCommands(): void {
  const bot = TelegramService.getBot();
  if (!bot) {
    logger.warn('[TelegramBot] Bot chưa được khởi tạo, bỏ qua thiết lập lệnh.');
    return;
  }

  // Đăng ký menu lệnh gợi ý khi người dùng gõ "/" trên Telegram
  bot.setMyCommands([
    { command: 'doi', description: 'Đổi Reader cho đơn' },
    { command: 'them', description: 'Thêm Reader vào Page (Cú pháp: /them [Tên_Reader] [Tên_Page])' },
    { command: 'thempage', description: 'Thêm Fanpage mới' },
    { command: 'doikytu', description: 'Đổi ký tự nhận diện Reader' },
    { command: 'listreaders', description: 'Xem danh sách Reader theo từng Page' },
    { command: 'listpages', description: 'Xem danh sách các Fanpage' },
    { command: 'baocao', description: 'Xem tổng kết doanh thu hôm nay' },
    { command: 'rasoat', description: 'Rà soát bill Meta & tự động bù đơn bị lỡ' }
  ]).catch((err) => {
    logger.warn(`[TelegramBot] Không thể đăng ký setMyCommands: ${err.message}`);
  });

  // 1. Lệnh /start và /help
  bot.onText(/\/(start|help)/, (msg) => {
    const chatId = msg.chat.id;
    const helpText = 
`🔮 <b>BỘ LỆNH ĐIỀU KHIỂN HỆ THỐNG DT TAROT</b>
━━━━━━━━━━━━━━━━━━━━━
<b>1. Đổi Reader cho đơn vừa nhận:</b>
• <code>/doi [Số_Đơn] [Tên_Reader_Mới]</code>
<i>Ví dụ: <code>/doi 1 Chi</code> hoặc <code>/doi 1 NA</code></i>

<b>2. Thêm Reader cho Page:</b>
• <code>/them [Tên_Reader] [Tên_Page]</code>
<i>Ví dụ: <code>/them Chi tarotchips03</code> hoặc <code>/them My chips02</code></i>

<b>3. Quản lý Fanpage:</b>
• <code>/thempage [Tên_Page] [Page_ID] [Access_Token]</code>
• <code>/listpages</code>: Xem danh sách Fanpage đang chạy.
• <code>/xoapage [Tên_Page]</code>: Xóa Fanpage.

<b>4. Đổi ký tự nhận diện Reader:</b>
• <code>/doikytu [Tên_Reader] [Ký_Tự_Mới]</code>
<i>Ví dụ: <code>/doikytu Chi .</code></i>

<b>5. Xem danh sách Reader:</b>
• <code>/listreaders</code>: Xem Reader của từng Page.
• <code>/xoareader [Tên]</code>: Xóa Reader.

<b>6. Báo Cáo Doanh Thu:</b>
• <code>/baocao</code>: Xem tổng hợp doanh thu trong ngày.`;
    bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
  });

  // 2. Lệnh /doi [Số_Đơn] [Tên_Reader_Mới]
  bot.onText(/\/(?:doi)(?:@\w+)?(?:\s+(\d+))?(?:\s+([^\s]+))?/i, async (msg, match) => {
    const chatId = msg.chat.id;

    let orderNumber: number | null = match && match[1] ? parseInt(match[1], 10) : null;
    let newReaderName: string | null = match && match[2] ? match[2].trim() : null;

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

    if (!orderNumber) {
      orderNumber = 1;
    }

    try {
      const tx = TransactionModel.getByTodayOrderNumber(orderNumber);
      if (!tx) {
        bot.sendMessage(chatId, `❌ Không tìm thấy <b>ĐƠN #${orderNumber}</b> trong ngày hôm nay.`, { parse_mode: 'HTML' });
        return;
      }

      let newReader = ReaderModel.getByName(newReaderName);
      if (!newReader) {
        const defaultTag = newReaderName.toLowerCase() === 'chi' ? '.' : (newReaderName.toLowerCase() === 'na' ? '' : `[${newReaderName}]`);
        newReader = ReaderModel.create({
          page_id: tx.page_id,
          reader_name: newReaderName,
          tag_prefix: defaultTag
        });
      }

      // Cập nhật Reader cho đơn (không tính hoa hồng)
      TransactionModel.updateReaderForOrder(orderNumber, newReader.id, 0, 0);

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
• Reader mới: <b>${newReader.reader_name}</b>${sheetStatusText}`;

      bot.sendMessage(chatId, responseText, { parse_mode: 'HTML' });
    } catch (err: any) {
      bot.sendMessage(chatId, `❌ Lỗi khi đổi reader: ${err.message}`);
    }
  });

  // 3. Lệnh /them hoặc /themreader [Tên_Reader] [Tên_Page_Tùy_Chọn]
  bot.onText(/\/(?:themreader|them)(?:_([^\s@]+)|@\w+)?(?:\s+([^\s]+))?(?:\s+([^\s]+))?/i, (msg, match) => {
    const chatId = msg.chat.id;

    const rawName = match ? (match[1] || match[2]) : '';
    const readerName = rawName ? rawName.trim() : '';
    const targetPageName = match && match[3] ? match[3].trim() : '';

    if (!readerName) {
      bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/them [Tên_Reader] [Tên_Page]</code>\n<i>Ví dụ: <code>/them Chi tarotchips03</code> hoặc <code>/them My chips02</code></i>', { parse_mode: 'HTML' });
      return;
    }

    try {
      const allPages = PageModel.getAll();
      if (allPages.length === 0) {
        bot.sendMessage(chatId, '❌ Chưa có Fanpage nào trên hệ thống. Dùng <code>/thempage</code> để thêm Page trước.', { parse_mode: 'HTML' });
        return;
      }

      let selectedPage = allPages[0];
      if (targetPageName) {
        const found = allPages.find(p => p.page_name.toLowerCase() === targetPageName.toLowerCase());
        if (found) {
          selectedPage = found;
        } else {
          bot.sendMessage(chatId, `❌ Không tìm thấy Fanpage "<b>${targetPageName}</b>". Dùng lệnh <code>/listpages</code> để xem tên Page.`, { parse_mode: 'HTML' });
          return;
        }
      }

      // Ký tự mặc định: Chi là dấu '.', NA là không dấu, người khác là [Tên]
      let tagPrefix = readerName.toLowerCase() === 'chi' ? '.' : (readerName.toLowerCase() === 'na' ? '' : `[${readerName}]`);

      let existing = ReaderModel.getByName(readerName);
      if (existing) {
        bot.sendMessage(chatId, `ℹ️ Reader <b>${existing.reader_name}</b> đã có sẵn trên hệ thống (Page: <b>${selectedPage.page_name}</b>, Ký hiệu: <code>${existing.tag_prefix || 'Không dấu'}</code>).`, { parse_mode: 'HTML' });
        return;
      }

      const newReader = ReaderModel.create({
        page_id: selectedPage.id,
        reader_name: readerName,
        tag_prefix: tagPrefix
      });

      bot.sendMessage(chatId, `✅ <b>ĐÃ THÊM READER THÀNH CÔNG!</b>\n• Reader: <b>${newReader.reader_name}</b>\n• Thuộc Page: <b>${selectedPage.page_name}</b>\n• Ký tự nhận diện: <code>${newReader.tag_prefix || 'Không dấu (mặc định)'}</code>`, { parse_mode: 'HTML' });
    } catch (err: any) {
      bot.sendMessage(chatId, `❌ Lỗi thêm reader: ${err.message}`);
    }
  });

  // 4. Lệnh /doikytu [Tên_Reader] [Ký_Tự_Mới]
  bot.onText(/\/(?:doikytu|suakytu)(?:@\w+)?(?:\s+([^\s]+))?(?:\s+([^\s]+))?/i, (msg, match) => {
    const chatId = msg.chat.id;
    const readerName = match && match[1] ? match[1].trim() : '';
    const newTag = match && match[2] ? match[2].trim() : '';

    if (!readerName || !newTag) {
      bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/doikytu [Tên_Reader] [Ký_Tự_Mới]</code>\n<i>Ví dụ:\n• Đặt ký tự có dấu: <code>/doikytu Chi .</code>\n• Bỏ ký tự (thành mặc định không dấu): <code>/doikytu NA none</code></i>', { parse_mode: 'HTML' });
      return;
    }

    try {
      const reader = ReaderModel.getByName(readerName);
      if (!reader) {
        bot.sendMessage(chatId, `❌ Không tìm thấy Reader có tên "<b>${readerName}</b>". Dùng lệnh <code>/listreaders</code> để kiểm tra.`, { parse_mode: 'HTML' });
        return;
      }

      const isRemoveTag = ['none', 'khong', 'xoa', '0', '-'].includes(newTag.toLowerCase());
      const finalTag = isRemoveTag ? '' : newTag;

      const updated = ReaderModel.updateTagPrefix(readerName, finalTag);
      if (updated) {
        if (isRemoveTag) {
          bot.sendMessage(chatId, `✅ <b>ĐÃ ĐẶT LÀM READER MẶC ĐỊNH!</b>\n• Reader: <b>${reader.reader_name}</b>\n• Ký tự: <i>(Không cần ký tự)</i>\n👉 <i>Từ nay tin nhắn rep bình thường (không có ký tự đặc biệt) sẽ tự động gán cho <b>${reader.reader_name}</b>!</i>`, { parse_mode: 'HTML' });
        } else {
          bot.sendMessage(chatId, `✅ <b>ĐÃ ĐỔI KÝ TỰ THÀNH CÔNG!</b>\n• Reader: <b>${reader.reader_name}</b>\n• Ký tự nhận diện: <code>${finalTag}</code>\n👉 <i>Từ nay tin nhắn rep có <code>${finalTag}</code> sẽ tự động gán cho <b>${reader.reader_name}</b>!</i>`, { parse_mode: 'HTML' });
        }
      } else {
        bot.sendMessage(chatId, `❌ Cập nhật thất bại. Vui lòng thử lại.`);
      }
    } catch (err: any) {
      bot.sendMessage(chatId, `❌ Lỗi: ${err.message}`);
    }
  });

  // 5. Lệnh /xoareader [Tên]
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

  // 6. Lệnh /listreaders (Nhóm theo từng Fanpage)
  bot.onText(/\/listreaders/, (msg) => {
    const chatId = msg.chat.id;
    const pages = PageModel.getAll();
    const readers = ReaderModel.getAll();

    if (readers.length === 0) {
      bot.sendMessage(chatId, 'Hiện chưa có Reader nào. Thêm bằng lệnh: <code>/them [Tên_Reader] [Tên_Page]</code>', { parse_mode: 'HTML' });
      return;
    }

    let text = `👥 <b>DANH SÁCH READER THEO FANPAGE:</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const p of pages) {
      const pageReaders = readers.filter(r => r.page_id === p.id);
      text += `📍 <b>Page: ${p.page_name}</b>\n`;
      if (pageReaders.length === 0) {
        text += `   <i>(Chưa có reader nào)</i>\n`;
      } else {
        for (const r of pageReaders) {
          const hasTag = r.tag_prefix && r.tag_prefix.trim() !== '' && r.tag_prefix.toLowerCase() !== 'none' && r.tag_prefix.toLowerCase() !== 'khong';
          const tagDisplay = hasTag ? `Ký hiệu: <code>${r.tag_prefix}</code>` : 'Mặc định (Không cần ký tự)';
          text += `   • <b>${r.reader_name}</b> (${tagDisplay})\n`;
        }
      }
      text += `\n`;
    }

    bot.sendMessage(chatId, text.trim(), { parse_mode: 'HTML' });
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

  // 10. Lệnh /ping hoặc /status để kiểm tra ngay lập tức bot có đang online không
  bot.onText(/\/(?:ping|status)/, (msg) => {
    const chatId = msg.chat.id;
    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;
    const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;
    const nowTime = new Date().toLocaleTimeString('vi-VN');

    const statusMsg = 
`🟢 <b>HỆ THỐNG ĐANG TRỰC TUYẾN 24/7!</b>
━━━━━━━━━━━━━━━━━━━━━
⏰ <b>Thời gian hiện tại:</b> ${nowTime}
⏱️ <b>Thời gian máy chủ chạy:</b> ${uptimeFormatted}
🔋 <b>Máy chủ:</b> Render (Đang chạy ổn định)
📡 <b>Trạng thái:</b> Sẵn sàng nhận đơn & đọc bill 100%`;

    bot.sendMessage(chatId, statusMsg, { parse_mode: 'HTML' });
  });

  // 11. Lệnh /rasoat: Rà soát toàn bộ tin nhắn bill trên Meta trong ngày & tự động bù vào Google Sheet
  bot.onText(/\/rasoat/, async (msg) => {
    const chatId = msg.chat.id;
    let waitMsg: any = null;
    try {
      waitMsg = await bot.sendMessage(chatId, '⏳ <b>Đang quét tin nhắn Meta và đối chiếu số liệu với Google Sheet...</b>\n<i>Vui lòng đợi 5-10 giây...</i>', { parse_mode: 'HTML' });
    } catch {}

    try {
      await ReconciliationService.runReconciliation(true);
      if (waitMsg && waitMsg.message_id) {
        bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
      }
    } catch (err: any) {
      bot.sendMessage(chatId, `❌ Lỗi khi rà soát bill: ${err.message}`);
    }
  });

  // 12. Phản hồi khi người dùng nhắn tin thông thường (không gõ dấu /)
  bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    if (msg.chat.type === 'private') {
      bot.sendMessage(
        msg.chat.id,
        '🔮 Chào bạn! Hãy gõ dấu <code>/</code> để mở menu danh sách lệnh (như <code>/baocao</code>, <code>/listreaders</code>, <code>/doi</code>, <code>/ping</code>...) nhé!',
        { parse_mode: 'HTML' }
      );
    }
  });

  logger.info('[TelegramBot] Đã đăng ký tất cả các lệnh tương tác Telegram siêu ngắn!');
}
