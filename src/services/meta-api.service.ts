import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

export class MetaApiService {
  /**
   * Lấy thông tin Tên/Nickname của khách hàng thông qua Graph API v19.0+
   * Instagram: fields=name,username (vd: win aeuriel, Cam Ly)
   * Facebook: fields=first_name,last_name,name (vd: Hồng Thủy)
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
      const response = await axios.get(url, {
        params: {
          fields: 'name,username,first_name,last_name',
          access_token: pageAccessToken
        },
        timeout: 8000
      });

      const data = response.data;
      // Instagram trả về username (nickname) hoặc name; Facebook trả về name hoặc last_name + first_name
      const realName = data.username || data.name || `${data.last_name || ''} ${data.first_name || ''}`.trim();

      if (realName) {
        return {
          name: realName,
          isReal: true
        };
      }

      return {
        name: `Khách (${userId.slice(-4)})`,
        isReal: false
      };
    } catch (error: any) {
      logger.warn(`[MetaAPI] Không lấy được profile của ID ${userId}: ${error.response?.data?.error?.message || error.message}`);
      return {
        name: `Khách (${userId.slice(-4)})`,
        isReal: false
      };
    }
  }
}
