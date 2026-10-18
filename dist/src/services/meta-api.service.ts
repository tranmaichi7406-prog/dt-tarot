import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface UnifiedConversation {
  id: string;
  updated_time: string;
  platform: 'Facebook' | 'Instagram';
  snippet?: string;
  participants?: any[];
}

export interface UnifiedMessage {
  id: string;
  created_time: string;
  message?: string;
  attachments?: any;
  from?: {
    id: string;
    name?: string;
    username?: string;
  };
  platform: 'Facebook' | 'Instagram';
}

export class MetaApiService {
  /**
   * Lấy danh sách hội thoại hợp nhất cả 2 kênh (Facebook Messenger & Instagram Direct)
   * trên cùng hạ tầng Meta Page API.
   */
  static async getUnifiedConversations(
    pageFbId: string,
    accessToken: string,
    igBusinessId: string = '17841436212431682'
  ): Promise<{ conversations: UnifiedConversation[]; errors: any[] }> {
    const conversations: UnifiedConversation[] = [];
    const errors: any[] = [];
    const seenIds = new Set<string>();

    const endpoints: Array<{ name: 'Facebook' | 'Instagram'; url: string; params: any }> = [
      // 1. Kênh Facebook Messenger trên Page
      {
        name: 'Facebook',
        url: `${config.meta.graphApiBaseUrl}/${pageFbId}/conversations`,
        params: {
          fields: 'id,updated_time,participants,snippet',
          limit: 50,
          access_token: accessToken
        }
      },
      // 2. Kênh Instagram Direct liên kết qua Page API (platform=instagram)
      {
        name: 'Instagram',
        url: `${config.meta.graphApiBaseUrl}/${pageFbId}/conversations`,
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
        url: `${config.meta.graphApiBaseUrl}/${igBusinessId}/conversations`,
        params: {
          fields: 'id,updated_time,participants,snippet',
          limit: 50,
          access_token: accessToken
        }
      }
    ];

    for (const ep of endpoints) {
      try {
        const res = await axios.get(ep.url, {
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
      } catch (err: any) {
        const fbErr = err.response?.data?.error;
        const errObj = {
          channel: ep.name,
          url: ep.url,
          code: fbErr?.code || 'NETWORK_ERROR',
          subcode: fbErr?.error_subcode,
          message: fbErr?.message || err.message
        };
        errors.push(errObj);
        logger.warn(`[MetaAPI] Lỗi quét kênh ${ep.name} (${ep.url}): ${errObj.message}`);
      }
    }

    return { conversations, errors };
  }

  /**
   * Lấy chi tiết toàn bộ tin nhắn & file đính kèm của một cuộc hội thoại
   */
  static async getConversationMessages(
    conversationId: string,
    accessToken: string,
    platform: 'Facebook' | 'Instagram' = 'Facebook'
  ): Promise<UnifiedMessage[]> {
    try {
      const url = `${config.meta.graphApiBaseUrl}/${conversationId}/messages`;
      const res = await axios.get(url, {
        params: {
          fields: 'id,message,attachments{id,mime_type,image_data,file_url},created_time,from',
          limit: 50,
          access_token: accessToken
        },
        timeout: 30000
      });

      const data = res.data?.data || [];
      return data.map((m: any) => ({
        ...m,
        platform
      }));
    } catch (err: any) {
      logger.warn(`[MetaAPI] Lỗi đọc tin nhắn hội thoại ${conversationId}: ${err.message}`);
      return [];
    }
  }

  /**
   * Lấy thông tin Tên/Nickname của khách hàng thông qua Graph API v19.0+
   */
  static async getCustomerProfile(
    userId: string,
    pageAccessToken: string
  ): Promise<{ name: string; isReal: boolean }> {
    try {
      if (!pageAccessToken || pageAccessToken.startsWith('mock_')) {
        return {
          name: `Khách (${userId.slice(-4)})`,
          isReal: false
        };
      }

      const url = `${config.meta.graphApiBaseUrl}/${userId}`;

      // 1. Thử truy vấn chuẩn Instagram (name, username)
      try {
        const igRes = await axios.get(url, {
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
      } catch (igErr: any) {}

      // 2. Thử truy vấn chuẩn Facebook (name, first_name, last_name)
      try {
        const fbRes = await axios.get(url, {
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
      } catch (fbErr: any) {}

      return {
        name: `Khách (${userId.slice(-4)})`,
        isReal: false
      };
    } catch (error: any) {
      return {
        name: `Khách (${userId.slice(-4)})`,
        isReal: false
      };
    }
  }
}
