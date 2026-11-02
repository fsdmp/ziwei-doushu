/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['lunar-javascript'],
  // 静态导出：无 API 路由/无动态服务端特性，产物 out/ 直接扔 nginx 静态目录
  output: 'export',
};

module.exports = nextConfig;
