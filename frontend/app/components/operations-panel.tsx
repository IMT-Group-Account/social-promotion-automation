'use client';
import { useState } from 'react';
type Audit={id:string;action:string;entityType:string;entityId:string|null;metadata:Record<string,unknown>;createdAt:string};
type Failure={id:string;jobId:string;postId:string;platform:string;errorCode:string;errorMessage:string;retryCount:number;status:string;deliveryAttempts:number;nextDeliveryAt:string;createdAt:string;deliveredAt:string|null};
async function read<T>(path:string):Promise<T>{const response=await fetch(`/api/backend/operations/${path}`,{cache:'no-store'}),payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error?.message??payload?.message??'운영 기록을 불러오지 못했습니다.');return payload.data as T;}
export function OperationsPanel({connected}:{connected:boolean}){
  const [audit,setAudit]=useState<Audit[]>([]),[failures,setFailures]=useState<Failure[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function refresh(){setBusy(true);setError('');try{const [nextAudit,nextFailures]=await Promise.all([read<Audit[]>('audit'),read<Failure[]>('failure-alerts')]);setAudit(nextAudit);setFailures(nextFailures);}catch(reason){setError(reason instanceof Error?reason.message:'운영 기록 조회에 실패했습니다.');}finally{setBusy(false);}}
  return <section className="card panel operations-panel"><div className="card-heading"><div><h2>운영 기록</h2><p className="muted">내 계정의 최근 감사 기록과 최종 게시 실패 알림을 각각 100건까지 표시합니다.</p></div><button disabled={!connected||busy} onClick={()=>void refresh()}>{busy?'불러오는 중…':'기록 불러오기'}</button></div>{error&&<div className="message error" role="alert">{error}</div>}
    <h3>최종 실패 알림</h3>{!failures.length&&<p className="empty">불러온 실패 알림이 없습니다.</p>}<div className="operation-list">{failures.map(item=><article key={item.id}><div><strong>{item.platform.toUpperCase()} · {item.errorCode}</strong><span className={`badge ${item.status}`}>{item.status}</span></div><p>{item.errorMessage}</p><small>{new Date(item.createdAt).toLocaleString('ko-KR')} · 게시 재시도 {item.retryCount}회 · 알림 전송 {item.deliveryAttempts}회</small></article>)}</div>
    <h3>감사 기록</h3>{!audit.length&&<p className="empty">불러온 감사 기록이 없습니다.</p>}<div className="operation-list">{audit.map(item=><article key={item.id}><div><strong>{item.action}</strong><span>{item.entityType}</span></div><small>{new Date(item.createdAt).toLocaleString('ko-KR')}{item.entityId?` · ${item.entityId.slice(0,8)}`:''}</small></article>)}</div>
  </section>;
}
