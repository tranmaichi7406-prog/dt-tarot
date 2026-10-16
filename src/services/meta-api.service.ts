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
      } catch (igErr: any) {
        // Khách Facebook sẽ không có trường username, tiếp tục thử trường của Facebook
      }

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
      } catch (fbErr: any) {
        // 3. Fallback thử duy nhất trường name
        try {
          const basicRes = await axios.get(url, {
            params: {
              fields: 'name',
              access_token: pageAccessToken
            },
            timeout: 5000
          });
          if (basicRes.data?.name) {
            return {
              name: basicRes.data.name,
              isReal: true
            };
          }
        } catch {}
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
