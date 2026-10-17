/**
 * Định dạng số tiền thành chuỗi tiền tệ Việt Nam (Ví dụ: 100000 -> 100.000)
 */
export function formatCurrencyVND(amount: number): string {
  if (isNaN(amount)) return '0';
  return new Intl.NumberFormat('vi-VN').format(amount);
}

/**
 * Định dạng Date object sang định dạng: "HH:mm - DD/MM/YYYY"
 */
export function formatDateTimeVN(dateInput: Date | string = new Date()): string {
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

  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '00';
  return `${getPart('hour')}:${getPart('minute')} - ${getPart('day')}/${getPart('month')}/${getPart('year')}`;
}

/**
 * Định dạng ngày sang "DD/MM/YYYY"
 */
export function formatDateVN(dateInput: Date | string = new Date()): string {
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
export function formatTimeVN(dateInput: Date | string = new Date()): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
}
