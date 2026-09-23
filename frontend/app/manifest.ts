import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'SNS 홍보 자동화 관리자',
    short_name: 'SNS 홍보',
    description: '캠페인 작성, SNS 게시 승인, 예약, 분석과 운영 상태를 관리합니다.',
    lang: 'ko',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f3f6f5',
    theme_color: '#18654f',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/pwa-icon/192',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-icon/512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
