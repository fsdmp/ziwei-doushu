/**
 * /library/search?q=xxx — 搜索结果页
 * 静态导出：server 壳只留 metadata，渲染交给 SearchClient（useSearchParams 客户端读取）
 */

import SearchClient from './SearchClient';

export const metadata = {
  title: '搜索 · 古籍原典库',
};

export default function SearchPage() {
  return <SearchClient />;
}
