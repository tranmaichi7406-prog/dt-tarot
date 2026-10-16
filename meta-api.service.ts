import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

export class MetaApiService {
  /**
   * Lấy thông tin Tên Facebook của khách hàng thông qua Graph API v19.0 (Facebook Page Messaging)
   * Endpoint: GET https://graph.facebook.com/v19.0/{psid}?fields=first_name,last_name,name&access_token={page_token}
   */
  static async getCustomerProfile(
    psid: string,
    pageAccessToken: string
  ): Promise<{ name: string }> {
    try {
      if (!pageAccessToken || pageAccessToken.startsWith('mock_')) {
        return {
          name: `Khách Facebook (${psid.slice(-4)})`
        };
      }

      const url = `${config.meta.graphApiBaseUrl}/${psid}`;
      const response = await axios.get(url, {
        params: {
          fields: 'first_name,last_name,name',
          access_token: pageAccessToken
        },
        timeout: 8000
      });

      return {
        name: response.data.name || `${response.data.last_name || ''} ${response.data.first_name || ''}`.trim() || `Khách hàng (${psid.slice(-4)})`
      };
    } catch (error: any) {
      logger.warn(`[MetaAPI] Không lấy được tên Facebook của PSID ${psid}: ${error.response?.data?.error?.message || error.message}`);
      return {
        name: `Khách hàng (${psid.slice(-4)})`
      };
    }
  }
}
