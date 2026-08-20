'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

const platforms = ['linkedin', 'instagram', 'facebook', 'threads', 'x'] as const;
type Platform = (typeof platforms)[number];
type JobStatus = 'waiting' | 'processing' | 'published' | 'failed' | 'retrying' | 'cancelled';

interface Integration { id: string; platform: Platform; accountName: string | null; status: 'active' | 'expired' | 'revoked' | 'disabled'; }
interface Campaign { id: string; name: string; }
interface PublishJob { id: string; platform: Platform; status: JobStatus; errorMessage: string | null; nextRetryAt: string | null; remotePostUrl: string | null; }
interface PostResult { postId: string; status: string; jobs: PublishJob[]; }
interface ApiResponse<T> { data: T; error: { code?: string; message?: string } | null; }

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) },
    ...options,
  });
  const payload = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? `요청에 실패했습니다. (${response.status})`);
  if (!payload?.data) throw new Error('서버 응답 형식이 올바르지 않습니다.');
  return payload.data;
}

function toLocalDateTime(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function platformLabel(platform: Platform): string {
  return { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads', x: 'X' }[platform];
}

function statusPresentation(job: PublishJob): { symbol: string; label: string; className: string } {
  if (job.status === 'published') return { symbol: '✓', label: '성공', className: 'success' };
  if (job.status === 'retrying') return { symbol: '⚠', label: '재시도 중', className: 'warning' };
  if (job.status === 'failed') return { symbol: '!', label: '실패', className: 'failure' };
  if (job.status === 'processing') return { symbol: '…', label: '발행 중', className: 'processing' };
  if (job.status === 'cancelled') return { symbol: '—', label: '취소됨', className: 'muted' };
  return { symbol: '○', label: '예약 대기', className: 'muted' };
}

export default function AdminPage() {
  const [campaignName, setCampaignName] = useState('');
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);
  const [mode, setMode] = useState<'now' | 'schedule'>('schedule');
  const [scheduledAt, setScheduledAt] = useState(() => toLocalDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [result, setResult] = useState<PostResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeAccounts = useMemo(() => new Map(platforms.map((platform) => [platform, integrations.find((account) => account.platform === platform && account.status === 'active')])), [integrations]);

  useEffect(() => {
    void api<Integration[]>('/integrations')
      .then((accounts) => setIntegrations(accounts))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'SNS 연결 정보를 불러오지 못했습니다.'));
  }, []);

  useEffect(() => {
    if (!result || !result.jobs.some((job) => job.status === 'waiting' || job.status === 'processing' || job.status === 'retrying')) return;
    const timer = window.setInterval(() => {
      void api<{ postId: string; status: string; jobs: PublishJob[] }>(`/posts/${result.postId}/results`)
        .then((next) => setResult(next))
        .catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [result]);

  function togglePlatform(platform: Platform): void {
    if (!activeAccounts.get(platform)) return;
    setSelectedPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setNotice('로컬 파일은 미리보기만 됩니다. 게시하려면 서버 스토리지에 업로드된 HTTPS 이미지 URL을 입력하세요.');
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!campaignName.trim() || !message.trim()) { setError('캠페인 이름과 홍보 문구를 입력하세요.'); return; }
    if (selectedPlatforms.length === 0) { setError('연결된 SNS를 하나 이상 선택하세요.'); return; }
    if (imageUrl && !imageUrl.startsWith('https://')) { setError('이미지 URL은 HTTPS여야 합니다.'); return; }
    if (mode === 'schedule' && new Date(scheduledAt).getTime() <= Date.now()) { setError('예약 시각은 현재보다 이후여야 합니다.'); return; }

    setSaving(true);
    try {
      const campaign = await api<Campaign>('/campaigns', { method: 'POST', body: JSON.stringify({ name: campaignName.trim() }) });
      const post = await api<{ post: { id: string }; jobs: PublishJob[] }>('/posts', {
        method: 'POST',
        body: JSON.stringify({
          campaignId: campaign.id,
          content: { title: campaignName.trim(), body: message.trim(), url: null, media: imageUrl ? [{ type: 'image', url: imageUrl }] : [] },
          targets: selectedPlatforms.map((platform) => ({ platform, accountId: activeAccounts.get(platform)?.id })),
          scheduledAt: mode === 'schedule' ? new Date(scheduledAt).toISOString() : new Date(Date.now() + 1_000).toISOString(),
        }),
      });
      if (mode === 'now') await api(`/posts/${post.post.id}/publish`, { method: 'POST', body: '{}' });
      else await api(`/posts/${post.post.id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt: new Date(scheduledAt).toISOString() }) });
      const nextResult = await api<PostResult>(`/posts/${post.post.id}/results`);
      setResult(nextResult);
      setNotice(mode === 'now' ? '발행 작업을 큐에 요청했습니다.' : '게시 예약을 저장했습니다.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '게시 요청에 실패했습니다.');
    } finally { setSaving(false); }
  }

  return (
    <main className="shell">
      <section className="intro"><span>CAMPAIGN OPERATIONS</span><h1>새 홍보 캠페인</h1><p>한 번 작성하고, 연결된 SNS별로 독립 예약·발행·재시도 상태를 관리합니다.</p></section>
      <div className="layout">
        <form className="card composer" onSubmit={submit}>
          <div className="card-heading"><div><p className="eyebrow">NEW CAMPAIGN</p><h2>새 홍보 캠페인</h2></div><span className="secure">서버 API 연결</span></div>
          <label>캠페인 이름<input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="예: 2026 여름 긴급 지원" maxLength={160} /></label>
          <label>홍보 문구<textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Help us support children affected by flooding…" rows={6} maxLength={10_000} /></label>
          <div className="field-group"><div><label>이미지 URL <span>선택</span><input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://cdn.example.com/campaign.jpg" inputMode="url" /></label><small>게시 가능한 HTTPS URL만 Backend에 전달됩니다.</small></div><label className="upload-button">Upload Image<input type="file" accept="image/*" onChange={chooseImage} /></label></div>
          {previewUrl && <Image className="preview" src={previewUrl} alt="선택한 이미지 미리보기" width={1200} height={500} unoptimized />}
          <fieldset><legend>대상 SNS</legend><div className="platform-grid">{platforms.map((platform) => { const account = activeAccounts.get(platform); const checked = selectedPlatforms.includes(platform); return <button key={platform} type="button" className={`platform ${checked ? 'selected' : ''} ${!account ? 'disabled' : ''}`} onClick={() => togglePlatform(platform)} aria-pressed={checked} disabled={!account}><span className="check">{checked ? '✓' : ''}</span><span><strong>{platformLabel(platform)}</strong><small>{account ? account.accountName ?? '연결됨' : '연결 필요'}</small></span></button>; })}</div></fieldset>
          <fieldset><legend>게시 방식</legend><div className="mode-row"><label className={mode === 'now' ? 'mode active' : 'mode'}><input type="radio" checked={mode === 'now'} onChange={() => setMode('now')} />즉시 게시</label><label className={mode === 'schedule' ? 'mode active' : 'mode'}><input type="radio" checked={mode === 'schedule'} onChange={() => setMode('schedule')} />예약 게시</label></div>{mode === 'schedule' && <input className="datetime" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />}</fieldset>
          {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message notice">{notice}</p>}
          <button className="submit" disabled={saving}>{saving ? '저장 중…' : mode === 'schedule' ? '게시 예약' : '지금 게시'}</button>
        </form>
        <aside className="side"><section className="card results"><div className="card-heading"><div><p className="eyebrow">PUBLISHING</p><h2>게시 결과</h2></div>{result && <span className="aggregate">{result.status}</span>}</div>{result ? <ul>{platforms.map((platform) => { const job = result.jobs.find((item) => item.platform === platform); const presentation = job ? statusPresentation(job) : { symbol: '—', label: '선택 안 함', className: 'muted' }; return <li key={platform}><strong>{platformLabel(platform)}</strong><span className={presentation.className}>{presentation.symbol} {presentation.label}</span>{job?.nextRetryAt && <small>{new Date(job.nextRetryAt).toLocaleString('ko-KR')} 재시도</small>}{job?.errorMessage && <small className="job-error">{job.errorMessage}</small>}</li>; })}</ul> : <div className="empty"><span>◎</span><p>게시 요청 후 SNS별 결과가 이곳에 표시됩니다.</p></div>}</section><section className="hint"><strong>안전한 연결</strong><p>브라우저에는 SNS Access Token을 저장하거나 전송하지 않습니다.</p></section></aside>
      </div>
    </main>
  );
}
