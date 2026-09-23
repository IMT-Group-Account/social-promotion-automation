'use client';

import { useState } from 'react';

const platformLabels:Record<string,string>={instagram:'Instagram',facebook:'Facebook',threads:'Threads',linkedin:'LinkedIn',x:'X'};
const metricLabels={impressions:'노출',reach:'도달',views:'조회',likes:'좋아요',comments:'댓글',shares:'공유',reposts:'재게시',clicks:'클릭'} as const;
type Metric=keyof typeof metricLabels;
type Campaign={id:string;name:string};
type PlatformAnalytics={platform:string;capturedAt:string|null}&Partial<Record<Metric,number>>;
type Dashboard={campaignId:string;platforms:PlatformAnalytics[]};

async function loadDashboard(campaignId:string):Promise<Dashboard>{
  const response=await fetch(`/api/backend/analytics/campaigns/${campaignId}/dashboard`,{cache:'no-store'});
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(payload?.error?.message??payload?.message??'성과 데이터를 불러오지 못했습니다.');
  if(!payload?.data?.platforms)throw new Error('성과 API 응답 형식을 확인하세요.');
  return payload.data as Dashboard;
}

export function AnalyticsPanel({campaigns,connected}:{campaigns:Campaign[];connected:boolean}){
  const [campaignId,setCampaignId]=useState('');
  const [dashboard,setDashboard]=useState<Dashboard|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const selectedCampaignId=campaignId||campaigns[0]?.id||'';
  async function refresh(id=selectedCampaignId){
    if(!id)return;
    setBusy(true);setError('');
    try{setDashboard(await loadDashboard(id));}catch(reason){setDashboard(null);setError(reason instanceof Error?reason.message:'성과 조회에 실패했습니다.');}finally{setBusy(false);}
  }
  return <section className="card panel analytics-panel">
    <div className="card-heading"><div><h2>캠페인 성과</h2><p className="muted">SNS가 제공한 지표만 표시하며, 없는 지표를 0으로 추정하지 않습니다.</p></div><button onClick={()=>void refresh()} disabled={busy||!selectedCampaignId}>{busy?'갱신 중…':'성과 불러오기'}</button></div>
    <label>캠페인<select value={selectedCampaignId} disabled={!connected||busy} onChange={event=>{const id=event.target.value;setCampaignId(id);void refresh(id);}}>{campaigns.map(campaign=><option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
    {!connected&&<p className="empty">로그인 후 성과를 확인할 수 있습니다.</p>}
    {connected&&!campaigns.length&&<p className="empty">먼저 캠페인을 만들어 게시하세요.</p>}
    {error&&<div className="message error" role="alert">{error}</div>}
    {dashboard&&<div className="analytics-grid">{dashboard.platforms.map(item=><article key={item.platform}>
      <div className="metric-heading"><h3>{platformLabels[item.platform]??item.platform}</h3><small>{item.capturedAt?`${new Date(item.capturedAt).toLocaleString('ko-KR')} 기준`:'수집된 지표 없음'}</small></div>
      <dl>{(Object.keys(metricLabels) as Metric[]).filter(metric=>item[metric]!==undefined).map(metric=><div key={metric}><dt>{metricLabels[metric]}</dt><dd>{item[metric]!.toLocaleString('ko-KR')}</dd></div>)}</dl>
      {!Object.keys(metricLabels).some(metric=>item[metric as Metric]!==undefined)&&<p className="muted">아직 표시할 성과가 없습니다.</p>}
    </article>)}</div>}
  </section>;
}
