/**
 * AI 后端接入（命盘解读 / 合盘分析），三处调用点（ChatPanel、InsightPanel、heming）共用。
 *
 * - 后端地址：默认直连线上后端 https://mistsee.offiai.cn（开源仓库本身不含后端）；
 *   自建后端时在 .env.local 配 NEXT_PUBLIC_AI_API_BASE 覆盖为你的地址。
 * - 鉴权：微信小程序 web-view 场景下，容器页会把登录态 JWT 拼在地址 #t=… 上
 *   （hash 不进服务端日志与 Referer）。捕获存 sessionStorage 并从地址栏清除：
 *   layout 首帧内联脚本已提前取走（站内 router.push 翻页会丢 hash，等首次请求
 *   才取就晚了），这里保留同款兜底（直开无脚本的极端场景），同键幂等。
 *   后端 fail-closed：无 token / token 过期返回 401（内容送检需要真实 openid），
 *   前端提示回小程序重新打开；排盘本身不受影响。
 * - 宿主版本：服务端在 /ziwei/web 下发的 URL query 里拼 mp_env/mp_ver（宿主
 *   小程序版本，web-view 隔离 JS 环境，URL 是唯一通道），layout 首帧脚本存
 *   sessionStorage。所有请求回发 X-App-Env/X-App-Version——与小程序原生请求
 *   （mistsee app request.ts）同头名，服务端日志/灰度对两路流量同口径；未存
 *   （旧版小程序 URL 无参、直开浏览器）不带头，与服务端字段缺席语义一致。
 * - SSE 协议：data: {"delta":{"text":"…"}}，流尾 data: [DONE]。
 */

export const AI_API_BASE = (process.env.NEXT_PUBLIC_AI_API_BASE || 'https://mistsee.offiai.cn').replace(/\/+$/, '');

const TOKEN_KEY = 'ziwei_ai_token';

/** 模块级只执行一次：hash 清理不可重复（第二次已无 t 参数）。 */
let tokenCaptured = false;

function captureToken(): void {
  if (tokenCaptured || typeof window === 'undefined') return;
  tokenCaptured = true;
  const hash = window.location.hash;
  if (!hash) return;
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('t');
  if (!token) return;
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* 隐私模式等场景静默降级匿名 */ }
  // 从地址栏精确移除 t 参数（保留站内可能存在的其他 hash 内容），避免分享/截图泄露
  params.delete('t');
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + window.location.search + (rest ? '#' + rest : ''));
}

function authHeaders(): Record<string, string> {
  captureToken();
  if (typeof window === 'undefined') return {};
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

/** 宿主小程序版本回发头：只读 layout 首帧脚本存的 sessionStorage（版本非敏感、
 *  query 不清除也不必二次捕获——站内导航后 query 已丢，捕获兜底永远捕不到新值）。
 *  SSR / 未存（旧版小程序、直开浏览器）返回空对象，不带头。 */
function hostVersionHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const env = sessionStorage.getItem('ziwei_mp_env');
    const ver = sessionStorage.getItem('ziwei_mp_ver');
    if (!env && !ver) return {};
    return { ...(env ? { 'X-App-Env': env } : {}), ...(ver ? { 'X-App-Version': ver } : {}) };
  } catch { return {}; }
}

export interface AIError extends Error {
  /**
   * 'auth-expired'：登录态缺失/过期（后端 fail-closed，需回小程序重新打开）；
   * 'api-missing'：后端未实现该接口（404）；'rate-limited'：触发限流；
   * 'network' / 'failed'：网络/服务异常；'biz'：后端业务错（code!=0，msg 带中文文案）
   */
  code?: string;
  /** code='biz' 时的后端业务码与文案（如「这份邀请已被使用」） */
  bizCode?: number;
  bizMsg?: string;
}

/**
 * 非流式 JSON 请求（裂变邀请等普通接口共用 streamAI 的鉴权与错误语义）：
 * 解 {code,msg,data} 包络，code!=0 抛 code='biz' 的 AIError（携带原文案）。
 */
export async function requestJSON<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
  /** keepalive：页面卸载中也要把请求发出去（events 关页冲尾批用，sendBeacon 带不了鉴权头） */
  opts?: { keepalive?: boolean },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${AI_API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...hostVersionHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: opts?.keepalive === true,
    });
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' });
  }
  if (res.status === 401) throw Object.assign(new Error('auth-expired'), { code: 'auth-expired' });
  if (res.status === 404) throw Object.assign(new Error('api-missing'), { code: 'api-missing' });
  if (res.status === 429) throw Object.assign(new Error('rate-limited'), { code: 'rate-limited' });
  if (!res.ok) throw Object.assign(new Error('failed'), { code: 'failed' });
  const env = await res.json().catch(() => null) as { code?: number; msg?: string; data?: T } | null;
  if (!env) throw Object.assign(new Error('failed'), { code: 'failed' });
  if (env.code !== 0) {
    throw Object.assign(new Error(env.msg || 'failed'), { code: 'biz', bizCode: env.code, bizMsg: env.msg });
  }
  return env.data as T;
}

/**
 * 调 AI 后端，SSE 增量通过 onDelta(text, full) 回调（full 为累积全文），
 * 返回拼接全文。跨 chunk 的半截 JSON 行会缓冲到下一 chunk 再解析。
 */
export async function streamAI(
  path: string,
  body: unknown,
  onDelta?: (text: string, full: string) => void,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${AI_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...hostVersionHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' });
  }
  if (res.status === 401) throw Object.assign(new Error('auth-expired'), { code: 'auth-expired' });
  if (res.status === 404) throw Object.assign(new Error('api-missing'), { code: 'api-missing' });
  if (res.status === 429) throw Object.assign(new Error('rate-limited'), { code: 'rate-limited' });
  if (!res.ok || !res.body) throw Object.assign(new Error('failed'), { code: 'failed' });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buf = '';

  // 返回 true 表示收到 [DONE]
  const handleLine = (line: string): boolean => {
    if (!line.startsWith('data: ')) return false;
    const data = line.slice(6);
    if (data === '[DONE]') return true;
    try {
      const delta = (JSON.parse(data) as { delta?: { text?: string } }).delta?.text ?? '';
      if (delta) {
        full += delta;
        onDelta?.(delta, full);
      }
    } catch { /* 解析不了的行跳过（如注释行） */ }
    return false;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? ''; // 末行可能被 chunk 边界截断，留待下一 chunk
    for (const line of lines) {
      if (handleLine(line)) return full;
    }
  }
  if (buf && handleLine(buf)) return full; // 流末无换行的收尾行（一般无，稳妥起见）
  return full;
}
