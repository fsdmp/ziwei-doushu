import type { Metadata } from 'next';
import { Suspense } from 'react';
import InviteClient from './InviteClient';

// 静态导出：server 壳只留 metadata，渲染交给 InviteClient（useSearchParams 客户端读取，
// 与 library/search 同模式）。合盘邀请落地页是裂变链路的 B 侧门面，标题不透露双方信息。
export const metadata: Metadata = {
  title: '合盘邀请 · 紫微斗数',
  description: '有人想和你合一张紫微命盘——填上你的出生信息，看看你们的关系',
  robots: { index: false }, // 裂变落地页不进索引：卡面昵称/邀请时效都不适合被搜索缓存
};

export default function InvitePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg-0)' }} />}>
      <InviteClient />
    </Suspense>
  );
}
