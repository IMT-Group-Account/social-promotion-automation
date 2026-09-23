'use client';

import { useEffect, useState } from 'react';

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string };
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<InstallChoice>;
}

export function PwaInstall(): React.ReactNode {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = window.sessionStorage.getItem('pwa-install-dismissed') === 'true';

    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      }).catch(() => undefined);
    }

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      if (!dismissed && !standalone) setHidden(false);
    };
    const installed = () => {
      setInstallPrompt(null);
      setHidden(true);
    };

    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  async function install(): Promise<void> {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === 'accepted') setHidden(true);
  }

  function dismiss(): void {
    window.sessionStorage.setItem('pwa-install-dismissed', 'true');
    setHidden(true);
  }

  if (hidden || !installPrompt) return null;
  return (
    <aside className="pwa-install" aria-label="데스크톱 앱 설치 안내">
      <div>
        <strong>SNS 홍보 관리자를 앱으로 설치</strong>
        <p>시작 메뉴와 작업 표시줄에서 별도 창으로 실행할 수 있습니다.</p>
      </div>
      <button className="primary" type="button" onClick={() => void install()}>설치</button>
      <button type="button" onClick={dismiss} aria-label="설치 안내 닫기">나중에</button>
    </aside>
  );
}
