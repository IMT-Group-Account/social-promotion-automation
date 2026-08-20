import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '홍보 자동화 관리자',
  description: '캠페인 작성과 SNS 발행 상태 관리',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
