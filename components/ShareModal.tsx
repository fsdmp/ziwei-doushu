'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { isMiniProgram, pushShareCard } from '@/lib/mini-bridge';
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
}

export default function ShareModal({ open, onClose, shareUrl, chart, birth, highlight, title, invite, ch }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [inMini, setInMini] = useState(false);
  const [miniHint, setMiniHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setInMini(isMiniProgram()) }, []);

  // 转发给微信好友（小程序 web-view 专用）：转发面板无法编程拉起——先把本盘亮点文案
  // 与裂变参数 postMessage 给容器页（点转发动作发生时必已送达，容器页用它定制转发卡
  // 标题与落地 query），再引导用户点右上角「···」→ 转发。提示常驻 4 秒，覆盖
  // 「收起弹窗 → 找右上角」的操作时差
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current) }, []);

  /** 关弹窗统一收口：清残留提示与定时器——4 秒内关再开时 miniHint 不该带着旧状态 */
  const close = () => {
    setMiniHint(false);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    onClose();
  };

  const shareToFriend = () => {
    // 兜底链与 ShareButton.onShare 同源（highlight || title）：硬编码串只作最末位
    // 兜底，避免二次推送覆盖外层已推的正确素材（容器页消费最后一条）
    pushShareCard({ title: highlight || title || '紫微斗数 · 起一张你的命盘', invite, ch });
    // 连点以最后一次提示为准：旧定时器作废，不出现提示提前消失（与 MiniBridgeFab 同款）
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
      const dataURL = await captureShareCard();
      if (!dataURL) {
        alert('图片生成失败，请截图保存或刷新重试');
        return;
      }
      downloadDataURL(dataURL, `紫微命盘_${Date.now()}.png`);
    } finally {
      setDownloading(false);
    }
  };

  return (
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
                <div style={{ padding: '20px', background: '#fbf6e8', display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
                  <ShareCardCanvas chart={chart} birth={birth} highlight={highlight} />
                </div>
                <div style={{ padding: '0 20px 12px', textAlign: 'center', fontSize: '11px', color: '#a89b7c', letterSpacing: '0.05em' }}>
                  ↑ 朋友圈 / 微信 / 抖音 / 小红书 都能用
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
                      background: 'linear-gradient(135deg, #7a5cbe 0%, #5b3fa0 100%)',
                      color: 'white', fontSize: '14px', fontWeight: 600, letterSpacing: '0.15em',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(91,63,160,0.3)',
                    }}
                  >
                    转发给微信好友
                  </button>
                  {miniHint && (
                    <div style={{
                      fontSize: '12px', color: '#5b3fa0', lineHeight: 1.7, textAlign: 'center',
                      padding: '10px 12px', background: 'rgba(91,63,160,0.06)', borderRadius: '8px',
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
                  {downloading ? '生成中…' : '⬇ 下载分享图'}
                </button>
              )}

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

              <div style={{
                fontSize: '11px', color: '#a89b7c', lineHeight: 1.7,
                padding: '10px 12px', background: 'rgba(184,146,42,0.05)',
                borderRadius: '8px', marginTop: '4px',
              }}>
                <div style={{ marginBottom: '4px', fontWeight: 600, color: '#8b6a14' }}>使用提示：</div>
                {inMini ? (
                  <>· 点「转发给微信好友」备好文案，再点右上角「···」转发<br /></>
                ) : (
                  <>· 复制链接发给微信好友，对方点开看自己的盘起点<br /></>
                )}
                {/* 有卡图才有下载入口（chart=null 的标题型分享没这条能力，提示不提） */}
                {chart && <>· 下载图片可发朋友圈 / 抖音 / 小红书</>}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
