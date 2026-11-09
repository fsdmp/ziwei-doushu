'use client';

// ShareButton.tsx 全站通用分享入口：一个按钮收口全部分享行为，页面侧不再各自
// 拼素材——
// · 小程序 web-view：点击即把转发卡素材（标题 + 裂变参数 invite/ch）postMessage 给
//   容器页（原生「✦ 分享」按钮与右上角「···」转发时消费），随后打开 ShareModal
//   （内含转发引导块）；真正弹出转发面板的永远是原生层的用户动作
// · 浏览器 / 微信内置浏览器：pushShareCard 静默降级，直接开 ShareModal
//   （下载分享图 / 复制链接）
// 接入方只需给素材（title/highlight/chart/birth），裂变参数（invite）等玩法上线后
// 从 props 传入即可，本组件与 ShareModal 都不用再动。

import { useState } from 'react';
import type { ZiweiChart } from '@/lib/ziwei/types';
import type { BirthFormState } from '@/components/BirthForm';
import { pushShareCard } from '@/lib/mini-bridge';
import { SITE_URL } from '@/lib/site';
import ShareModal, { type ShareBirth } from './ShareModal';

/** BirthFormState（表单原始态，经 BirthForm 的 onFormSave 存下）→ 分享卡出生信息。
 *  注意不能从排盘用的 BirthInfo 转：其 hour 是时辰索引（0-11）不是钟点，
 *  分享卡上要展示的是用户填的钟点（clockHour/clockMinute）。
 *  时辰不详时盘按子时排，钟点字段是禁用未清的残留值——置空（ShareCardCanvas
 *  对空值渲染「时辰不详」），否则卡面时间与盘面主星口径对不上。 */
export function birthForShare(form: BirthFormState): ShareBirth {
  return {
    year: form.year, month: form.month, day: form.day,
    hour: form.unknownTime ? '' : form.clockHour,
    minute: form.unknownTime ? '' : form.clockMinute,
    gender: form.gender === 'female' ? 'female' : 'male',
    city: form.city,
  };
}

interface ShareButtonProps {
  /** 转发卡兜底标题（无 highlight 时用它） */
  title: string;
  /** 盘面亮点一句：优先做转发卡标题（比站点默认文案更钩人） */
  highlight?: string;
  /** 有 chart 时 ShareModal 内渲染分享卡预览与下载 */
  chart?: ZiweiChart | null;
  /** 合盘卡：双方命盘在手时渲染 HemingShareCard（与 chart 互斥，合盘入口用） */
  heming?: { chartA: ZiweiChart; chartB: ZiweiChart } | null;
  birth?: ShareBirth;
  /** 裂变邀请码 / 渠道标记：容器页拼进转发卡落地 query（裂变玩法上线后传入） */
  invite?: string;
  ch?: string;
  /** 复制链接用，默认站点首页（对方点开看自己的盘起点） */
  shareUrl?: string;
  /** 按钮文案，默认「✦ 分享」 */
  label?: string;
  className?: string;
}

export default function ShareButton({
  title, highlight, chart = null, heming = null, birth, invite, ch,
  shareUrl = SITE_URL, label = '✦ 分享', className = '',
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);

  // 出生信息是分享卡绘制素材：缺了只影响卡图预览（ShareModal 对 chart/birth 缺省
  // 已有降级），转发链路不受影响
  const safeBirth: ShareBirth = birth ?? {
    year: '', month: '', day: '', hour: '', minute: '', gender: 'male',
  };

  const onShare = () => {
    // 浏览器环境此调用静默降级（isMiniProgram=false），无副作用
    pushShareCard({ title: highlight || title, invite, ch });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onShare}
        className={`share-btn ${className}`}
        style={{
          padding: '6px 14px', cursor: 'pointer', fontSize: 13,
          border: '1px solid rgba(212,168,67,0.4)', borderRadius: 8,
          background: 'transparent', color: 'var(--t-gold, #d4a843)',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </button>
      <ShareModal
        open={open}
        onClose={() => setOpen(false)}
        shareUrl={shareUrl}
        chart={chart}
        heming={heming}
        birth={safeBirth}
        highlight={highlight}
        title={title}
        invite={invite}
        ch={ch}
      />
    </>
  );
}
