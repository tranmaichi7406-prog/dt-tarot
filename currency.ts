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
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  return `${hours}:${minutes} - ${day}/${month}/${year}`;
}

/**
 * Định dạng ngày sang "DD/MM/YYYY"
 */
export function formatDateVN(dateInput: Date | string = new Date()): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * Định dạng giờ: "HH:mm"
 */
export function formatTimeVN(dateInput: Date | string = new Date()): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
