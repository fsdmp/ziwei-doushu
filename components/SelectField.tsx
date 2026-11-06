'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/components/ThemeProvider';

/**
 * 自定义下拉选择器（底部弹层式）。
 *
 * 为什么不用原生 <select>：微信小程序 web-view（iOS WKWebView / 部分安卓内核）
 * 会吞掉原生 select 的系统弹层——点开闪一下立即收起，用户根本选不了。这是
 * web-view 的老毛病且无法从 H5 侧修复，唯一稳定方案就是自定义下拉。全站
 * 表单下拉统一走本组件，Portal 到 body 避免受嵌套 framer-motion transform
 * 影响 fixed 定位。
 */

export interface SelectOption {
  value: string;
  label: string;
}

export default function SelectField({
  value,
  options,
  placeholder = '请选择',
  title,
  disabled = false,
  error = false,
  onChange,
  style,
}: {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  /** 弹层标题，缺省用 placeholder */
  title?: string;
  disabled?: boolean;
  /** 表单校验不过时描红（底样式由 style 传入，这里只补边框色） */
  error?: boolean;
  onChange: (v: string) => void;
  /** 与表单 input 同款的底样式对象（BirthForm 的 inputStyle） */
  style?: React.CSSProperties;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // SSR 阶段没有 document，Portal 挂载押后到客户端
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // 弹层打开期间锁 body 滚动，避免弹层底下表单跟着滚
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // 打开时把当前选中项滚到可视区中央（年份 127 项不从头翻）
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      (listRef.current?.querySelector('[data-sel="1"]') as HTMLElement | null)
        ?.scrollIntoView({ block: 'center' });
    }, 40);
    return () => clearTimeout(t);
  }, [open]);

  const selected = options.find(o => o.value === value);

  // ─── 配色（与 BirthForm 同一套暗/亮双主题变量） ───────────
  const phClr = isDark ? 'rgba(160,175,200,0.5)' : 'rgba(100,80,40,0.4)';
  const chevClr = isDark ? 'rgba(160,180,210,0.6)' : 'rgba(140,100,20,0.45)';
  const errClr = isDark ? '#f87171' : '#dc2626';
  const maskBg = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(30,20,0,0.45)';
  const sheetBg = isDark ? '#111c33' : '#fffdf4';
  const sheetBd = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(200,160,60,0.3)';
  const itemClr = isDark ? '#dde7f5' : '#2a1a00';
  const gold = isDark ? '#d4a843' : '#a06f14';
  const titleClr = isDark ? 'rgba(200,215,235,0.9)' : 'rgba(110,75,15,0.75)';

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <>
      {/* 触发器：外观与同排 input 一致（style 由调用方传入），右侧小箭头示意可点 */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          appearance: 'none',
          WebkitAppearance: 'none',
          touchAction: 'manipulation',
          ...(error ? { borderColor: errClr } : null),
        }}
      >
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: selected ? undefined : phClr,
          }}
        >
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ fontSize: '10px', color: chevClr, flexShrink: 0 }}>▾</span>
      </button>

      {/* 弹层本体：Portal 到 body，绕开祖先 transform 对 fixed 的破坏 */}
      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9990, pointerEvents: 'none' }}>
              {/* 遮罩：点外部关闭 */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setOpen(false)}
                style={{ position: 'absolute', inset: 0, background: maskBg, pointerEvents: 'auto' }}
              />
              {/* 选单面板：底部滑入，宽屏时居中收窄 */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  justifyContent: 'center',
                  pointerEvents: 'auto',
                }}
              >
                <motion.div
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
                  style={{
                    width: '100%',
                    maxWidth: '520px',
                    background: sheetBg,
                    borderTopLeftRadius: '20px',
                    borderTopRightRadius: '20px',
                    borderTop: `1px solid ${sheetBd}`,
                    boxShadow: '0 -8px 40px rgba(0,0,0,0.25)',
                    overflow: 'hidden',
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  {/* 头部：标题 + 关闭 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 20px 8px',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 600, color: gold, letterSpacing: '0.05em' }}>
                      {title || placeholder}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: titleClr,
                        fontSize: '18px',
                        lineHeight: 1,
                        cursor: 'pointer',
                        padding: '2px 4px',
                      }}
                      aria-label="关闭"
                    >
                      ✕
                    </button>
                  </div>
                  {/* 选项列表：自身滚动，橡皮筋不外溢到页面 */}
                  <div
                    ref={listRef}
                    style={{
                      maxHeight: '56vh',
                      overflowY: 'auto',
                      overscrollBehavior: 'contain',
                      WebkitOverflowScrolling: 'touch',
                      paddingBottom: 'calc(14px + env(safe-area-inset-bottom))',
                    }}
                  >
                    {options.map(o => {
                      const on = o.value === value;
                      return (
                        <button
                          key={o.value || '__empty__'}
                          type="button"
                          data-sel={on ? '1' : '0'}
                          onClick={() => pick(o.value)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            width: '100%',
                            padding: '13px 20px',
                            border: 'none',
                            background: on ? (isDark ? 'rgba(212,168,67,0.1)' : 'rgba(180,120,20,0.08)') : 'transparent',
                            color: on ? gold : itemClr,
                            fontSize: '13px',
                            fontWeight: on ? 600 : 400,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <span>{o.label}</span>
                          {on && <span style={{ fontSize: '12px' }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              </div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
