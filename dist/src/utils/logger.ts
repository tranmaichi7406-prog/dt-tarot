export const logger = {
  info: (msg: string, ...meta: any[]) => {
    const timestamp = new Date().toISOString();
    console.log(`[INFO]  [${timestamp}] ${msg}`, ...meta);
  },
  warn: (msg: string, ...meta: any[]) => {
    const timestamp = new Date().toISOString();
    console.warn(`[WARN]  [${timestamp}] ${msg}`, ...meta);
  },
  error: (msg: string, ...meta: any[]) => {
    const timestamp = new Date().toISOString();
    console.error(`[ERROR] [${timestamp}] ${msg}`, ...meta);
  },
  debug: (msg: string, ...meta: any[]) => {
    if (process.env.NODE_ENV !== 'production') {
      const timestamp = new Date().toISOString();
      console.log(`[DEBUG] [${timestamp}] ${msg}`, ...meta);
    }
  }
};
