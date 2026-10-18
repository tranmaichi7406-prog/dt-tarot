"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const logger_1 = require("../utils/logger");
function errorHandler(err, req, res, next) {
    logger_1.logger.error(`[UnhandledError] ${req.method} ${req.url}:`, err.stack || err.message);
    if (res.headersSent) {
        return next(err);
    }
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Lỗi máy chủ nội bộ'
    });
}
