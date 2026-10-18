"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCurrencyVND = formatCurrencyVND;
exports.formatDateTimeVN = formatDateTimeVN;
exports.formatDateVN = formatDateVN;
exports.formatTimeVN = formatTimeVN;
/**
 * Định dạng số tiền thành chuỗi tiền tệ Việt Nam (Ví dụ: 100000 -> 100.000)
 */
function formatCurrencyVND(amount) {
    if (isNaN(amount))
        return '0';
    return new Intl.NumberFormat('vi-VN').format(amount);
}
/**
 * Định dạng Date object sang định dạng: "HH:mm - DD/MM/YYYY"
 */
function formatDateTimeVN(dateInput = new Date()) {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour12: false
    }).formatToParts(d);
    const getPart = (type) => parts.find(p => p.type === type)?.value || '00';
    return `${getPart('hour')}:${getPart('minute')} - ${getPart('day')}/${getPart('month')}/${getPart('year')}`;
}
/**
 * Định dạng ngày sang "DD/MM/YYYY"
 */
function formatDateVN(dateInput = new Date()) {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(d);
}
/**
 * Định dạng giờ: "HH:mm"
 */
function formatTimeVN(dateInput = new Date()) {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(d);
}
