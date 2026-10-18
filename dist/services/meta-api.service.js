"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaApiService = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
class MetaApiService {
    /**
     * Lấy danh sách hội thoại hợp nhất cả 2 kênh (Facebook Messenger & Instagram Direct)
     * trên cùng hạ tầng Meta Page API.
     */
    static async getUnifiedConversations(pageFbId, accessToken, igBusinessId = '17841436212431682') {
        const conversations = [];
        const errors = [];
        const seenIds = new Set();
        const endpoints = [
            // 1. Kênh Facebook Messenger trên Page
            {
                name: 'Facebook',
                url: `${config_1.config.meta.graphApiBaseUrl}/${pageFbId}/conversations`,
                params: {
                    fields: 'id,updated_time,participants,snippet',
                    limit: 50,
                    access_token: accessToken
                }
            },
            // 2. Kênh Instagram Direct liên kết qua Page API (platform=instagram)
            {
                name: 'Instagram',
                url: `${config_1.config.meta.graphApiBaseUrl}/${pageFbId}/conversations`,
                params: {
                    platform: 'instagram',
                    fields: 'id,updated_time,participants,snippet',
                    limit: 50,
                    access_token: accessToken
                }
            },
            // 3. Kênh Instagram Business Account ID
            {
                name: 'Instagram',
                url: `${config_1.config.meta.graphApiBaseUrl}/${igBusinessId}/conversations`,
                params: {
                    fields: 'id,updated_time,participants,snippet',
                    limit: 50,
                    access_token: accessToken
                }
            }
        ];
        for (const ep of endpoints) {
            try {
                const res = await axios_1.default.get(ep.url, {
                    params: ep.params,
                    timeout: 30000
                });
                const data = res.data?.data || [];
                for (const item of data) {
                    if (!seenIds.has(item.id)) {
                        seenIds.add(item.id);
                        conversations.push({
                            id: item.id,
                            updated_time: item.updated_time,
                            platform: ep.name,
                            snippet: item.snippet,
                            participants: item.participants?.data || []
                        });
                    }
                }
            }
            catch (err) {
                const fbErr = err.response?.data?.error;
                const errObj = {
                    channel: ep.name,
                    url: ep.url,
                    code: fbErr?.code || 'NETWORK_ERROR',
                    subcode: fbErr?.error_subcode,
                    message: fbErr?.message || err.message
                };
                errors.push(errObj);
                logger_1.logger.warn(`[MetaAPI] Lỗi quét kênh ${ep.name} (${ep.url}): ${errObj.message}`);
            }
        }
        return { conversations, errors };
    }
    /**
     * Lấy chi tiết toàn bộ tin nhắn & file đính kèm của một cuộc hội thoại
     */
    static async getConversationMessages(conversationId, accessToken, platform = 'Facebook') {
        try {
            const url = `${config_1.config.meta.graphApiBaseUrl}/${conversationId}/messages`;
            const res = await axios_1.default.get(url, {
                params: {
                    fields: 'id,message,attachments{id,mime_type,image_data,file_url},created_time,from',
                    limit: 50,
                    access_token: accessToken
                },
                timeout: 30000
            });
            const data = res.data?.data || [];
            return data.map((m) => ({
                ...m,
                platform
            }));
        }
        catch (err) {
            logger_1.logger.warn(`[MetaAPI] Lỗi đọc tin nhắn hội thoại ${conversationId}: ${err.message}`);
            return [];
        }
    }
    /**
     * Lấy thông tin Tên/Nickname của khách hàng thông qua Graph API v19.0+
     */
    static async getCustomerProfile(userId, pageAccessToken) {
        try {
            if (!pageAccessToken || pageAccessToken.startsWith('mock_')) {
                return {
                    name: `Khách (${userId.slice(-4)})`,
                    isReal: false
                };
            }
            const url = `${config_1.config.meta.graphApiBaseUrl}/${userId}`;
            // 1. Thử truy vấn chuẩn Instagram (name, username)
            try {
                const igRes = await axios_1.default.get(url, {
                    params: {
                        fields: 'name,username',
                        access_token: pageAccessToken
                    },
                    timeout: 6000
                });
                const data = igRes.data;
                const realName = data.username || data.name;
                if (realName) {
                    return {
                        name: realName,
                        isReal: true
                    };
                }
            }
            catch (igErr) { }
            // 2. Thử truy vấn chuẩn Facebook (name, first_name, last_name)
            try {
                const fbRes = await axios_1.default.get(url, {
                    params: {
                        fields: 'name,first_name,last_name',
                        access_token: pageAccessToken
                    },
                    timeout: 6000
                });
                const data = fbRes.data;
                const realName = data.name || `${data.last_name || ''} ${data.first_name || ''}`.trim();
                if (realName) {
                    return {
                        name: realName,
                        isReal: true
                    };
                }
            }
            catch (fbErr) { }
            return {
                name: `Khách (${userId.slice(-4)})`,
                isReal: false
            };
        }
        catch (error) {
            return {
                name: `Khách (${userId.slice(-4)})`,
                isReal: false
            };
        }
    }
}
exports.MetaApiService = MetaApiService;
