"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.logger = {
    info: (msg, ...meta) => {
        const timestamp = new Date().toISOString();
        console.log(`[INFO]  [${timestamp}] ${msg}`, ...meta);
    },
    warn: (msg, ...meta) => {
        const timestamp = new Date().toISOString();
        console.warn(`[WARN]  [${timestamp}] ${msg}`, ...meta);
    },
    error: (msg, ...meta) => {
        const timestamp = new Date().toISOString();
        console.error(`[ERROR] [${timestamp}] ${msg}`, ...meta);
    },
    debug: (msg, ...meta) => {
        if (process.env.NODE_ENV !== 'production') {
            const timestamp = new Date().toISOString();
            console.log(`[DEBUG] [${timestamp}] ${msg}`, ...meta);
        }
    }
};
