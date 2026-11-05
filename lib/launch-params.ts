// launch-params.ts 裂变参数通道（H5 侧薄层）：小程序容器页把启动参数（转发卡 query /
// 小程序码 scene）透传到本站 URL query 上（见 mistsee 容器页 withLaunchParams），这里
// 负责读——只认白名单键（invite 邀请码 / ch 渠道），读一次即存 sessionStorage：
// 站内 router.push 翻页会把 query 丢掉，会话期内后续页面仍可取（与 #t= JWT 同模式）。

/** 与容器页 PASS_THROUGH_KEYS 对齐的白名单：多读无益，漏读断链 */
const LAUNCH_KEYS = ['invite', 'ch'] as const;

export interface LaunchParams {
  invite?: string;
  ch?: string;
}

const STORE_KEY = 'ziwei_launch_params';

/** 读启动参数：URL query 优先（首次落地），无则读 sessionStorage 缓存（内页/刷新后）。
 *  返回值可能是空对象——非裂变入口进来（自然流量）没有参数是常态。 */
export function readLaunchParams(): LaunchParams {
  // 先看缓存：URL 上还有参数时以 URL 为准（新邀请覆盖旧缓存）
  let cached: LaunchParams = {};
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) cached = JSON.parse(raw) as LaunchParams;
  } catch { /* 缓存损坏按无缓存处理 */ }

  const fresh: LaunchParams = {};
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    for (const k of LAUNCH_KEYS) {
      const v = q.get(k);
      if (v) fresh[k] = v;
    }
  }
  const merged = { ...cached, ...fresh };
  if (Object.keys(fresh).length > 0) {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(merged)) } catch { /* 存不进就算了 */ }
  }
  return merged;
}
