'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { isMiniProgram, pushShareCard, openSharePanel } from '@/lib/mini-bridge';
import { sharePanelEnabled } from '@/lib/unlock';
import ShareCardCanvas, { captureShareCard, downloadDataURL } from './ShareCardCanvas';

/** 出生信息（分享卡绘制用，字符串形态来自 BirthFormState；数字 BirthInfo 由
 *  ShareButton 负责转换）。hour/minute 为空串 = 时辰不详（卡面渲染「时辰不详」，
 *  不显示排盘未采用的残留钟点） */
export interface ShareBirth {
  year: string; month: string; day: string; hour: string; minute: string;
  gender: 'male' | 'female'; city?: string;
}

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  shareUrl: string;
  chart: ZiweiChart | null;
  birth: ShareBirth;
  highlight?: string;
  /** 转发卡兜底标题（无 highlight 时用它）——由 ShareButton 透传，与按钮点击时
   *  pushShareCard 推的素材同源：弹窗内二次推送若用各自的硬编码串，会覆盖掉
   *  外层已推的正确文案（容器页取最后一条 postMessage 为准） */
  title?: string;
  /** 裂变参数（容器页拼进转发卡 path 的 query，素材契约见 lib/mini-bridge.ts） */
  invite?: string;
  ch?: string;
  /** 隐藏「复制链接」行（邀请场景传 true）：复制出的 H5 直链在非 web-view 环境会被
   *  门禁拦到 /open-in-mini.html 且 query（邀请码）丢失——承诺一条走不通的通道比不给
   *  更伤。默认 false，普通分享（卡图/命盘链接）行为不变。 */
  hideCopyLink?: boolean;
}

export default function ShareModal({ open, onClose, shareUrl, chart, birth, highlight, title, invite, ch, hideCopyLink }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [inMini, setInMini] = useState(false);
  const [miniHint, setMiniHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 分享图（2026-11-06 真机反馈两处修复）：卡片离屏按原尺寸渲染再截成图，预览
  // 直接显示这张图——所见即所存，手机窄屏也不会被 flex 压坏排版；微信（含小程序
  // web-view）忽略 <a download>，改为大图长按保存（微信 H5 海报的标准形态）
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [genFailed, setGenFailed] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [inWeChat, setInWeChat] = useState(false);

  useEffect(() => { setInMini(isMiniProgram()) }, []);
  useEffect(() => { setInWeChat(/MicroMessenger/i.test(navigator.userAgent)) }, []);

  // 卡面内容指纹：birth 由父组件每次渲染新建对象，直接进依赖会反复重截
  const cardKey = chart ? `${chart.sessionId ?? ''}|${JSON.stringify(birth)}|${highlight ?? ''}` : '';
  useEffect(() => {
    if (!open || !chart) { setPreviewURL(null); setGenFailed(false); return; }
    let cancelled = false;
    // 等离屏卡片挂载排版完再截（同一次提交里挂上，留一帧余量给字体）
    const t = setTimeout(async () => {
      const url = await captureShareCard();
      if (cancelled) return;
      if (url) setPreviewURL(url);
      else setGenFailed(true);
    }, 60);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, cardKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 转发给微信好友（小程序 web-view 专用）：转发面板无法编程拉起——先把本盘亮点文案
  // 与裂变参数 postMessage 给容器页（点转发动作发生时必已送达，容器页用它定制转发卡
  // 标题与落地 query），再引导用户点右上角「···」→ 转发。提示常驻 4 秒，覆盖
  // 「收起弹窗 → 找右上角」的操作时差
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current) }, []);

  /** 关弹窗统一收口：清残留提示与定时器——4 秒内关再开时 miniHint 不该带着旧状态 */
  const close = () => {
    setMiniHint(false);
    setViewer(false);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    onClose();
  };

  const shareToFriend = () => {
    const cardTitle = highlight || title || '紫微斗数 · 起一张你的命盘';
    // 兜底链与 ShareButton.onShare 同源：容器页消费最后一条（右上角「···」转发
    // 也用它），bridge 分享中转页用 URL 参数拿同一份
    pushShareCard({ title: cardTitle, invite, ch });
    // 2026-11-06：新版 bridge 有分享中转页（真面板）——server 配置 share_panel
    // 开了才跳；旧版线上保持「右上角 ···」hint 引导（配置切换，H5 不再动）
    if (sharePanelEnabled()) openSharePanel({ title: cardTitle, invite, ch });
    setMiniHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setMiniHint(false), 4000);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement('input');
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const downloadImage = async () => {
    setDownloading(true);
    try {
      const dataURL = previewURL ?? await captureShareCard();
      if (!dataURL) {
        alert('图片生成失败，请截图保存或刷新重试');
        return;
      }
      if (!previewURL) setPreviewURL(dataURL);
      // 微信（含小程序 web-view）忽略 <a download>：点了毫无反应——改开大图，
      // 长按图片走微信原生「保存图片」菜单
      if (inWeChat) { setViewer(true); return; }
      downloadDataURL(dataURL, `紫微命盘_${Date.now()}.png`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
    {/* 离屏截图源：原尺寸 680×420 渲染在视口外（不受弹窗宽度约束、不进 flex），
        html2canvas 按 DOM 绘制不依赖可见性；不能用 opacity:0（会截成透明图） */}
    {open && chart && (
      <div aria-hidden style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }}>
        <ShareCardCanvas chart={chart} birth={birth} highlight={highlight} />
      </div>
    )}
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            onClick={e => e.stopPropagation()}
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'white',
              maxWidth: '680px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
            }}
          >
            {/* 顶部标题 */}
            <div style={{
              padding: '14px 18px',
              borderBottom: '1px solid rgba(184,146,42,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#3d2f10', letterSpacing: '0.12em' }}>
                ✦ 分享命盘
              </div>
              <button onClick={close}
                style={{
                  width: '28px', height: '28px', borderRadius: '50%', border: 'none',
                  background: 'rgba(0,0,0,0.05)', color: '#666', fontSize: '16px',
                  cursor: 'pointer', lineHeight: 1,
                }}
              >×</button>
            </div>

            {/* 卡片图预览（实际渲染）；无盘面素材（合盘等标题型分享）时整块不出，
                下载按钮同理隐藏——没有卡可下 */}
            {chart ? (
              <>
                <div style={{ padding: '16px', background: '#fbf6e8' }}>
                  {previewURL ? (
                    // 截图预览：宽度自适应弹窗，排版恒为 680×420 设计稿；微信里
                    // 这张图本身即可长按保存
                    <img
                      src={previewURL}
                      alt="命盘分享图"
                      onClick={() => { if (inWeChat) setViewer(true); }}
                      style={{
                        display: 'block', width: '100%', borderRadius: '10px',
                        boxShadow: '0 4px 14px rgba(184,146,42,0.18)',
                      }}
                    />
                  ) : (
                    // 占位按卡片比例（420/680）撑高：padding-top 写法兼容老 WebView
                    <div style={{ position: 'relative', width: '100%', paddingTop: '61.76%', borderRadius: '10px', background: 'rgba(184,146,42,0.08)' }}>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#a89b7c', letterSpacing: '0.1em' }}>
                        {genFailed ? '分享图生成失败，可截图保存' : '分享图生成中…'}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ padding: '0 20px 12px', textAlign: 'center', fontSize: '11px', color: '#a89b7c', letterSpacing: '0.05em' }}>
                  {inWeChat ? '↑ 长按图片即可保存 · 朋友圈 / 抖音 / 小红书都能用' : '↑ 朋友圈 / 微信 / 抖音 / 小红书 都能用'}
                </div>
              </>
            ) : null}

            {/* 操作区 */}
            <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {inMini && (
                <>
                  <button onClick={shareToFriend}
                    style={{
                      padding: '14px', borderRadius: '10px', border: 'none',
                      background: 'var(--vip-grad)',
                      color: 'white', fontSize: '14px', fontWeight: 600, letterSpacing: '0.15em',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px var(--vip-glow)',
                    }}
                  >
                    转发给微信好友
                  </button>
                  {miniHint && (
                    <div style={{
                      // 面板固定白底（不随主题）：紫字用 --vip-ink，不用随暗色提亮的 --vip
                      fontSize: '12px', color: 'var(--vip-ink)', lineHeight: 1.7, textAlign: 'center',
                      padding: '10px 12px', background: 'var(--vip-bg)', borderRadius: '8px',
                    }}>
                      分享内容已备好——点右上角 <b>「···」转发</b>，或点页面右缘的 <b>「✦ 分享」</b> 按钮，即可发给好友
                    </div>
                  )}
                </>
              )}
              {chart && (
                <button onClick={downloadImage} disabled={downloading}
                  style={{
                    padding: '14px', borderRadius: '10px', border: 'none',
                    background: 'linear-gradient(135deg, #d4a948 0%, #b8922a 100%)',
                    color: 'white', fontSize: '14px', fontWeight: 600, letterSpacing: '0.15em',
                    cursor: downloading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(184,146,42,0.3)',
                    opacity: downloading ? 0.7 : 1,
                  }}
                >
                  {downloading ? '生成中…' : inWeChat ? '⬇ 保存分享图' : '⬇ 下载分享图'}
                </button>
              )}

              {!hideCopyLink && (
                <button onClick={copyLink}
                  style={{
                    padding: '14px', borderRadius: '10px',
                    border: '1px solid rgba(184,146,42,0.4)', background: 'white',
                    color: '#b8922a', fontSize: '14px', fontWeight: 500, letterSpacing: '0.12em',
                    cursor: 'pointer',
                  }}
                >
                  {copied ? '✓ 已复制链接' : '🔗 复制命盘链接'}
                </button>
              )}

              <div style={{
                fontSize: '11px', color: '#a89b7c', lineHeight: 1.7,
                padding: '10px 12px', background: 'rgba(184,146,42,0.05)',
                borderRadius: '8px', marginTop: '4px',
              }}>
                <div style={{ marginBottom: '4px', fontWeight: 600, color: '#8b6a14' }}>使用提示：</div>
                {inMini ? (
                  <>· 点「转发给微信好友」备好文案，再点右上角「···」转发<br /></>
                ) : !hideCopyLink ? (
                  <>· 复制链接发给微信好友，对方点开看自己的盘起点<br /></>
                ) : null}
                {/* 有卡图才有下载入口（chart=null 的标题型分享没这条能力，提示不提） */}
                {chart && (inWeChat
                  ? <>· 长按分享图保存到手机，可发朋友圈 / 抖音 / 小红书</>
                  : <>· 下载图片可发朋友圈 / 抖音 / 小红书</>)}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    {/* 大图长按层（微信专用）：点空白处返回；图片本身不响应点击，留给长按菜单 */}
    <AnimatePresence>
      {viewer && previewURL && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[120] flex flex-col items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setViewer(false)}
        >
          <img
            src={previewURL}
            alt="命盘分享图"
            onClick={e => e.stopPropagation()}
            style={{ display: 'block', width: '100%', maxWidth: '680px', borderRadius: '10px' }}
          />
          <div style={{ marginTop: '18px', fontSize: '14px', color: '#e8dcc0', letterSpacing: '0.12em' }}>
            长按图片 · 保存到手机
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'rgba(232,220,192,0.5)' }}>
            点空白处返回
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
