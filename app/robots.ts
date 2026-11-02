import type { MetadataRoute } from 'next';

// 静态导出要求：元数据路由必须显式 force-static（Next 在 export 模式下不默认假定）
export const dynamic = 'force-static';
import { SITE_URL } from '@/lib/site';

const BASE_URL = SITE_URL;

export default function robots(): MetadataRoute.Robots {
  return {
    // 站点仅小程序 web-view 内使用（前端 UA 门禁），不对公众搜索引擎开放
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      },
    ],
  };
}
