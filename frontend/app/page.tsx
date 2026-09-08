'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';

const platforms = ['instagram', 'facebook', 'threads', 'linkedin', 'x'] as const;
type Platform = typeof platforms[number];
type Media = {type:'image'|'video';url:string};
type Content = {title:string;body:string;url:string|null;media:Media[];platformBodies?:Partial<Record<Platform,string>>};
type Account = {id:string;platform:Platform;accountName:string|null;status:string;expiresAt:string|null;scope:string[];missingScopes?:string[]};
type Job = {id:string;accountId:string;platform:Platform;status:string;errorCode:string|null;errorMessage:string|null;remotePostUrl:string|null;remoteRequestKey:string|null;nextRetryAt:string|null};
type RecordData = {post:{id:string;campaignId:string;content:Content;scheduledAt:string;status:string;revision:number};jobs:Job[]};
type Preview = {revision:number;items:{accountId:string;platform:Platform;body:string;destinationUrl:string|null;media:Media[]}[];issues:string[]};
type Campaign = {id:string;name:string};
type Selection = {selectionId:string;pages:{pageId:string;pageName:string}[];platform:'facebook'|'instagram'};
const labels:Record<Platform,string> = {instagram:'Instagram',facebook:'Facebook',threads:'Threads',linkedin:'LinkedIn',x:'X'};
const statuses:Record<string,string> = {draft:'초안',waiting:'예약 대기',scheduled:'예약됨',claimed:'발행 준비',remote_requesting:'게시 확인 중',remote_confirmed:'게시 확인됨',published:'게시 완료',completed:'완료',publishing:'발행 중',failed:'실패',partially_failed:'일부 실패',retrying:'재시도 중',cancelled:'취소됨',active:'연결됨',expired:'기간 만료',revoked:'연결 해제',disabled:'사용 중지'};
const blank = ():Content => ({title:'',body:'',url:null,media:[],platformBodies:{}});
function localDate(date:Date):string {return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function tomorrow():string{return new Date(Date.now()+86400000).toISOString();}
function errorText(error:unknown):string {return error instanceof Error?error.message:'요청을 처리하지 못했습니다.';}
async function api<T>(path:string,method='GET',body?:unknown):Promise<T> {
  const response=await fetch(`/api/backend${path}`,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const data=await response.json().catch(()=>null);
  if(!response.ok){const message=data?.error?.message??data?.message;throw new Error(Array.isArray(message)?message.join(' '):message??`요청 실패 (${response.status})`);}
  return data.data as T;
}
function advice(job:Job):string {
  if(job.remoteRequestKey&&job.status==='failed')return '게시 여부를 확인할 수 없습니다. SNS에서 확인한 뒤 운영 담당자가 처리해야 합니다. 중복 게시 방지를 위해 재시도를 잠갔습니다.';
  if(/TOKEN|AUTH|SCOPE|PERMISSION|FORBIDDEN/i.test(job.errorCode??''))return '계정 관리에서 권한과 연결 상태를 확인하고 다시 연결하세요.';
  if(/RATE|LIMIT|QUOTA|BUDGET/i.test(job.errorCode??''))return '사용 한도 또는 예산을 확인한 뒤 다시 시도하세요.';
  if(/MEDIA|FORMAT|VALIDATION/i.test(job.errorCode??''))return '파일과 문구를 확인하세요. 수정이 필요하면 새 초안으로 복제하세요.';
  return '오류 원인을 확인한 뒤 실패한 SNS만 다시 시도할 수 있습니다.';
}

export default function AdminPage(){
  const [tab,setTab]=useState<'compose'|'calendar'|'accounts'>('compose');
  const [accounts,setAccounts]=useState<Account[]>([]),[campaigns,setCampaigns]=useState<Campaign[]>([]),[records,setRecords]=useState<RecordData[]>([]);
  const [campaignId,setCampaignId]=useState(''),[campaignName,setCampaignName]=useState('');
  const [content,setContent]=useState<Content>(blank),[selected,setSelected]=useState<string[]>([]);
  const [current,setCurrent]=useState<RecordData|null>(null),[preview,setPreview]=useState<Preview|null>(null),[reviewed,setReviewed]=useState(false),[dirty,setDirty]=useState(false);
  const [scheduledAt,setScheduledAt]=useState(()=>localDate(new Date(Date.now()+86400000))),[mode,setMode]=useState<'schedule'|'now'>('schedule');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[connected,setConnected]=useState(false);
  const [uploadProgress,setUploadProgress]=useState<number|null>(null),[selection,setSelection]=useState<Selection|null>(null);
  const [month,setMonth]=useState(()=>localDate(new Date()).slice(0,7)),[day,setDay]=useState(''),[offset,setOffset]=useState(0);
  const dialog=useRef<HTMLDialogElement|null>(null);
  const popup=useRef<Window|null>(null),connectingPlatform=useRef<Platform|null>(null);
  const busyRef=useRef(false);
  const immutable=!!current&&current.post.status!=='draft';
  const refresh=useCallback(async()=>{
    const [a,c,r]=await Promise.all([api<Account[]>('/integrations'),api<Campaign[]>('/campaigns'),api<RecordData[]>(`/posts?offset=${offset}`)]);
    setAccounts(a);setCampaigns(c);setRecords(r);setConnected(true);
  },[offset]);
  useEffect(()=>{
    let active=true;
    void Promise.all([api<Account[]>('/integrations'),api<Campaign[]>('/campaigns'),api<RecordData[]>(`/posts?offset=${offset}`)])
      .then(([a,c,r])=>{if(active){setAccounts(a);setCampaigns(c);setRecords(r);setConnected(true);}})
      .catch(e=>{if(active)setError(errorText(e));});
    return()=>{active=false;};
  },[offset]);
  useEffect(()=>{
    if(!connected)return;
    const timer=setInterval(()=>{void api<RecordData[]>(`/posts?offset=${offset}`).then(setRecords).catch(e=>setError(`상태 갱신 실패: ${errorText(e)}`));},15000);
    return()=>clearInterval(timer);
  },[offset,connected]);
  useEffect(()=>{
    const listener=(event:MessageEvent)=>{
      if(event.source!==popup.current||event.origin!==process.env.NEXT_PUBLIC_OAUTH_CALLBACK_ORIGIN||event.data?.type!=='promotion-oauth')return;
      if(event.data.error){setError(event.data.error);return;}
      if(event.data.data?.selectionId){setSelection({...event.data.data,platform:connectingPlatform.current==='instagram'?'instagram':'facebook'});setTab('accounts');}
      else {void refresh().catch(e=>setError(errorText(e)));setNotice('SNS 계정을 연결했습니다.');}
    };
    window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
  },[refresh]);
  useEffect(()=>{
    const handler=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();}};
    window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);
  },[dirty]);
  useEffect(()=>{const node=dialog.current;if(preview&&node&&!node.open)node.showModal();return()=>node?.close();},[preview]);
  async function run(work:()=>Promise<void>){
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setNotice('');
    try{await work();}catch(e){setError(errorText(e));}finally{setBusy(false);busyRef.current=false;}
  }
  function change(next:Content){setContent(next);setDirty(true);setPreview(null);setReviewed(false);}
  function load(record:RecordData){
    setCurrent(record);setContent(record.post.content);setCampaignId(record.post.campaignId);setSelected(record.jobs.map(j=>j.accountId));
    setScheduledAt(localDate(new Date(record.post.scheduledAt)));setPreview(null);setReviewed(false);setDirty(false);setTab('compose');
  }
  function canLeave(){return !dirty||window.confirm('저장하지 않은 변경을 버리고 이동할까요?');}
  function reset(){if(!canLeave())return;setCurrent(null);setContent(blank());setSelected([]);setCampaignId('');setCampaignName('');setPreview(null);setReviewed(false);setDirty(false);setTab('compose');setScheduledAt(localDate(new Date(Date.now()+86400000)));}
  async function save():Promise<RecordData>{
    if(immutable&&current)return current;
    if(!content.body.trim())throw new Error('홍보 문구를 입력하세요.');
    if(!selected.length)throw new Error('게시할 계정을 하나 이상 선택하세요.');
    if(content.url&&!/^https:\/\//.test(content.url))throw new Error('홍보 링크는 HTTPS URL을 입력하세요.');
    let id=campaignId;
    if(!id){
      if(!campaignName.trim())throw new Error('캠페인을 선택하거나 새 캠페인 이름을 입력하세요.');
      const campaign=await api<Campaign>('/campaigns','POST',{name:campaignName.trim()});id=campaign.id;setCampaignId(id);setCampaigns(c=>[campaign,...c]);
    }
    if(current&&!dirty)return current;
    const record=await api<RecordData>(current?`/posts/${current.post.id}`:'/posts',current?'PATCH':'POST',current?{revision:current.post.revision,content}:{
      campaignId:id,content,targets:selected.map(accountId=>({accountId,platform:accounts.find(a=>a.id===accountId)?.platform})),scheduledAt:tomorrow(),
    });
    setCurrent(record);setDirty(false);setRecords(rs=>[record,...rs.filter(r=>r.post.id!==record.post.id)]);return record;
  }
  function review(){void run(async()=>{const record=await save();setPreview(await api<Preview>(`/posts/${record.post.id}/preview`));setReviewed(false);setNotice('SNS별 최종 문구와 미디어를 확인하세요.');});}
  function approve(){void run(async()=>{
    if(!current||!preview||!reviewed||dirty)throw new Error('최신 내용을 검수한 뒤 승인하세요.');
    if(preview.issues.length)throw new Error('미리보기의 게시 제한을 먼저 해결하세요.');
    const body=mode==='now'?{approvedRevision:preview.revision}:{approvedRevision:preview.revision,scheduledAt:new Date(scheduledAt).toISOString()};
    const record=await api<RecordData>(`/posts/${current.post.id}/${mode==='now'?'publish':'schedule'}`,'POST',body);
    load(record);setNotice(mode==='now'?'발행을 요청했습니다. 아래에서 결과를 확인하세요.':'예약을 저장했습니다.');await refresh();
  });}
  function connect(platform:Platform){
    if(!process.env.NEXT_PUBLIC_OAUTH_CALLBACK_ORIGIN){setError('SNS 연결 콜백 주소 설정이 필요합니다.');return;}
    popup.current=window.open('about:blank','promotion-oauth','width=650,height=780');connectingPlatform.current=platform;
    void run(async()=>{try{const result=await api<{authorizationUrl:string}>(`/integrations/${platform}/connect`,'POST',{});if(!popup.current)throw new Error('팝업을 허용한 뒤 다시 연결하세요.');popup.current.location.href=result.authorizationUrl;}catch(e){popup.current?.close();throw e;}});
  }
  async function upload(file:File){
    if(file.size>=4*1024*1024)throw new Error('파일은 4MB 미만이어야 합니다. 이미지는 정사각형 변환으로 줄일 수 있습니다.');
    const form=new FormData();form.append('file',file);setUploadProgress(0);
    try{
      const media=await new Promise<Media>((resolve,reject)=>{
        const xhr=new XMLHttpRequest();xhr.open('POST','/api/backend/media');xhr.timeout=60000;
        xhr.upload.onprogress=e=>{if(e.lengthComputable)setUploadProgress(Math.round(e.loaded/e.total*100));};
        xhr.onerror=()=>reject(new Error('업로드 연결에 실패했습니다.'));xhr.ontimeout=()=>reject(new Error('업로드 시간이 초과되었습니다.'));
        xhr.onload=()=>{try{const response=JSON.parse(xhr.responseText);if(xhr.status>=200&&xhr.status<300)resolve(response.data);else reject(new Error(response.message??response.error?.message??'업로드에 실패했습니다.'));}catch{reject(new Error('업로드 응답을 읽지 못했습니다.'));}};xhr.send(form);
      });
      change({...content,media:[{type:media.type,url:media.url}]});setNotice('파일 업로드를 완료했습니다. 초안을 저장하세요.');
    }finally{setUploadProgress(null);}
  }
  async function choose(file:File|undefined,square:boolean){
    if(!file)return;
    await run(async()=>{
      if(!['image/jpeg','image/png','video/mp4'].includes(file.type))throw new Error('JPEG, PNG, MP4만 선택할 수 있습니다.');
      if(!square){await upload(file);return;}
      if(!file.type.startsWith('image/'))throw new Error('정사각형 변환은 이미지에서만 사용할 수 있습니다.');
      const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1080;
      const side=Math.min(bitmap.width,bitmap.height);canvas.getContext('2d')!.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,1080,1080);bitmap.close();
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('이미지 변환에 실패했습니다.')),'image/jpeg',0.88));
      await upload(new File([blob],'campaign-square.jpg',{type:'image/jpeg'}));
    });
  }
  function act(record:RecordData,action:string,jobId?:string){void run(async()=>{
    const fresh=await api<RecordData>(`/posts/${record.post.id}`);
    const next=await api<RecordData>(`/posts/${record.post.id}/${jobId?`jobs/${jobId}/retry`:action}`,'POST',action==='duplicate'?{}:{approvedRevision:fresh.post.revision});
    if(action==='duplicate')load(next);else if(current?.post.id===next.post.id)setCurrent(next);
    setNotice(action==='cancel'?'아직 게시되지 않은 작업을 취소했습니다.':action==='duplicate'?'새 초안을 만들었습니다.':'실패한 SNS의 재시도를 요청했습니다.');await refresh();
  });}
  const result=records.find(r=>r.post.id===current?.post.id)??current;
  const failures=records.flatMap(r=>r.jobs.filter(j=>j.status==='failed').map(j=>({record:r,job:j})));
  const days=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
  const firstDay=new Date(`${month}-01T12:00:00`).getDay();
  const filtered=records.filter(r=>localDate(new Date(r.post.scheduledAt)).startsWith(day||month));
  const accountName=(id:string)=>accounts.find(a=>a.id===id)?.accountName??id.slice(0,8);

  return <main className="shell">
    <header className="intro"><div><span>CAMPAIGN OPERATIONS</span><h1>SNS 홍보 관리</h1><p>초안을 준비하고, 검수한 콘텐츠를 원하는 시간에 게시하세요.</p></div><div className="actions"><a className="button" href="/api/auth/login">{connected?'다시 로그인':'로그인'}</a>{connected&&<form action="/api/auth/logout" method="post"><button>로그아웃</button></form>}</div></header>
    <nav className="tabs" aria-label="홍보 관리 메뉴">{([['compose','작성·검수'],['calendar','예약 캘린더'],['accounts','계정 관리']] as const).map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}<button className="new" onClick={reset} disabled={busy}>+ 새 게시물</button></nav>
    {error&&<div className="message error" role="alert">{error}<button onClick={()=>setError('')} aria-label="오류 닫기">×</button></div>}
    {notice&&<div className="message notice" role="status">{notice}</div>}
    {!connected&&<section className="hint"><strong>관리자 로그인이 필요합니다.</strong><p>로그인 후 연결된 SNS 계정과 저장한 게시물을 불러옵니다.</p></section>}
    {failures.length>0&&<details className="alert-panel"><summary>확인이 필요한 게시 실패 {failures.length}건 <small>현재 불러온 게시물 기준</small></summary>{failures.map(({record,job})=><div key={job.id}><strong>{record.post.content.title||'제목 없음'} · {labels[job.platform]}</strong><p>{advice(job)}</p><button onClick={()=>{if(canLeave())load(record);}}>결과 확인</button></div>)}</details>}

    {tab==='accounts'&&<section className="card panel"><h2>SNS 계정 연결</h2><p className="muted">만료되거나 권한이 변경된 계정은 다시 연결하세요. 계정별 게시 결과는 독립적으로 관리됩니다.</p><div className="account-grid">{platforms.map(platform=><article className="account-card" key={platform}><h3>{labels[platform]}</h3>{accounts.filter(a=>a.platform===platform).map(a=><div className="account" key={a.id}><strong>{a.accountName??'이름 없는 계정'}</strong><span className={`badge ${a.status}`}>{statuses[a.status]??a.status}</span>{a.expiresAt&&<small>연결 만료: {new Date(a.expiresAt).toLocaleString('ko-KR')}</small>}<details><summary>허용된 권한</summary><p>{a.scope.join(', ')||'권한 정보 없음'}</p></details>{a.status!=='revoked'&&<button disabled={busy} onClick={()=>{if(window.confirm(`${a.accountName??labels[platform]} 연결을 해제할까요? 예약 작업은 발행에 실패할 수 있습니다.`))void run(async()=>{await api(`/integrations/${a.id}`,'DELETE');await refresh();setNotice('계정 연결을 해제했습니다.');});}}>연결 해제</button>}</div>)}<button className="primary" disabled={busy||!connected} onClick={()=>connect(platform)}>계정 연결 / 재연결</button></article>)}</div>
    {selection&&<section className="selection"><h3>{selection.platform==='instagram'?'Instagram과 연결된 Facebook 페이지 선택':'게시할 Facebook 페이지 선택'}</h3><p>선택은 10분 동안 유효합니다.</p>{selection.pages.map(page=><button disabled={busy} key={page.pageId} onClick={()=>void run(async()=>{await api('/integrations/facebook/pages/select','POST',{selectionId:selection.selectionId,pageId:page.pageId,platform:selection.platform});setSelection(null);await refresh();setNotice('계정을 연결했습니다.');})}>{page.pageName}</button>)}</section>}</section>}

    {tab==='compose'&&<div className="layout"><section className="card composer"><div className="card-heading"><h2>{current?immutable?'게시물 확인':'초안 편집':'새 게시물 작성'}</h2><span className="badge">{current?statuses[current.post.status]: '저장 전'}</span></div>
      <fieldset disabled={busy||immutable}><label>캠페인<select value={campaignId} disabled={!!current} onChange={e=>{setCampaignId(e.target.value);setDirty(true);}}><option value="">새 캠페인 만들기</option>{campaigns.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>{!campaignId&&<label>새 캠페인 이름<input value={campaignName} maxLength={160} onChange={e=>{setCampaignName(e.target.value);setDirty(true);}} placeholder="예: 가을 신상품 소개"/></label>}
      <label>게시물 제목<input value={content.title} maxLength={300} onChange={e=>change({...content,title:e.target.value})} placeholder="목록에 표시할 제목"/></label>
      <label>공통 홍보 문구<textarea rows={6} maxLength={10000} value={content.body} onChange={e=>change({...content,body:e.target.value})} placeholder="소개할 내용과 고객에게 전할 메시지를 작성하세요."/></label>
      <label>홍보 링크 <small>선택</small><input type="url" value={content.url??''} onChange={e=>change({...content,url:e.target.value||null})} placeholder="https://example.com/product"/></label>
      <div className="field-title">이미지·동영상 <small>JPEG·PNG·MP4, 4MB 미만 / 게시용 공개 파일</small></div><div className="actions"><label className="button upload">파일 업로드<input type="file" accept="image/jpeg,image/png,video/mp4" onChange={e=>{void choose(e.target.files?.[0],false);e.target.value='';}}/></label><label className="button upload">정사각형으로 잘라 업로드<input type="file" accept="image/jpeg,image/png" onChange={e=>{void choose(e.target.files?.[0],true);e.target.value='';}}/></label></div>
      {uploadProgress!==null&&<label>업로드 {uploadProgress}%<progress value={uploadProgress} max={100}/></label>}
      {content.media.map(m=><div key={m.url}>{m.type==='image'?<Image className="preview" src={m.url} alt="게시할 이미지" width={1080} height={1080} unoptimized/>:<video className="preview" src={m.url} controls preload="metadata"/>}<button onClick={()=>change({...content,media:[]})}>파일 제거</button></div>)}
      <details className="external-media"><summary>이미 업로드된 파일 URL 사용</summary><label>미디어 형식<select value={content.media[0]?.type??'image'} onChange={e=>change({...content,media:content.media.length?[{...content.media[0],type:e.target.value as Media['type']}]:[]})}><option value="image">이미지</option><option value="video">동영상</option></select></label><label>공개 HTTPS 파일 URL<input type="url" value={content.media[0]?.url??''} onChange={e=>change({...content,media:e.target.value?[{type:content.media[0]?.type??'image',url:e.target.value}]:[]})}/></label></details>
      <div className="field-title">게시할 SNS 계정</div>{current&&<p className="muted">저장된 초안의 대상 계정은 고정됩니다. 다른 계정으로 게시하려면 새 게시물을 작성하세요.</p>}<div className="platform-grid">{accounts.filter(a=>a.status==='active'||selected.includes(a.id)).map(a=><label className="account-choice" key={a.id}><input type="checkbox" checked={selected.includes(a.id)} disabled={!!current||a.status!=='active'} onChange={()=>{setSelected(ids=>ids.includes(a.id)?ids.filter(id=>id!==a.id):[...ids,a.id]);setDirty(true);setPreview(null);setReviewed(false);}}/><span><strong>{labels[a.platform]}</strong><small>{a.accountName??'연결된 계정'} · {statuses[a.status]}</small></span></label>)}</div>{!accounts.length&&<p>연결된 계정이 없습니다. 계정 관리에서 SNS를 연결하세요.</p>}
      <details className="variants"><summary>SNS별 문구 직접 편집</summary><p className="muted">입력하지 않은 SNS는 공통 문구를 자동으로 변환합니다. 최종 결과는 검수 단계에서 확인하세요.</p>{platforms.filter(p=>accounts.some(a=>a.platform===p&&selected.includes(a.id))).map(p=><label key={p}>{labels[p]}<textarea rows={3} maxLength={{instagram:2200,facebook:10000,threads:500,linkedin:3000,x:280}[p]} value={content.platformBodies?.[p]??''} onChange={e=>{const bodies={...content.platformBodies};if(e.target.value)bodies[p]=e.target.value;else delete bodies[p];change({...content,platformBodies:bodies});}} placeholder="공통 문구 사용"/></label>)}</details></fieldset>
      <div className="actions footer-actions">{!immutable&&<button disabled={busy||!connected} onClick={()=>void run(async()=>{await save();setNotice('초안을 저장했습니다. 승인 전에는 발행되지 않습니다.');})}>초안 저장</button>}<button className="primary" disabled={busy||!connected||!!current&&(!['draft','scheduled'].includes(current.post.status)||current.jobs.some(j=>!['waiting','cancelled'].includes(j.status)||j.remoteRequestKey))} onClick={review}>{busy?'처리 중…':'SNS별 미리보기·검수'}</button>{current&&<button disabled={busy} onClick={()=>{if(canLeave())act(current,'duplicate');}}>새 초안으로 복제</button>}</div>
    </section><aside className="side"><section className="card panel"><h2>게시 결과</h2>{result?<><p><span className="badge">{statuses[result.post.status]}</span> {result.post.status==='draft'?'승인 대기':new Date(result.post.scheduledAt).toLocaleString('ko-KR')}</p><ul className="jobs">{result.jobs.map(job=><li key={job.id}><strong>{labels[job.platform]} · {accountName(job.accountId)}</strong><span className={`badge ${job.status}`}>{result.post.status==='draft'?'초안':statuses[job.status]??job.status}</span>{job.errorMessage&&<p className="failure">{job.errorMessage}</p>}{job.status==='failed'&&<><p>{advice(job)}</p><button disabled={busy||!!job.remoteRequestKey} onClick={()=>act(result,'retry',job.id)}>이 SNS만 재시도</button></>}{job.nextRetryAt&&<small>다음 확인: {new Date(job.nextRetryAt).toLocaleString('ko-KR')}</small>}{job.remotePostUrl&&/^https:\/\//.test(job.remotePostUrl)&&<a href={job.remotePostUrl} target="_blank" rel="noreferrer">실제 게시물 열기 ↗</a>}</li>)}</ul>{!['draft','completed','cancelled'].includes(result.post.status)&&<button disabled={busy} onClick={()=>{if(window.confirm('아직 게시되지 않은 예약을 취소할까요? 이미 게시된 글은 유지됩니다.'))act(result,'cancel');}}>남은 예약 취소</button>}</>:<p className="muted">초안을 저장하면 계정별 진행 상태를 확인할 수 있습니다.</p>}</section><section className="hint"><strong>검수 후 발행</strong><p>초안 저장만으로 게시되지 않습니다. 최종 문구와 미디어를 확인하고 승인해야 예약이 시작됩니다.</p></section></aside></div>}

    {tab==='calendar'&&<section className="card panel"><div className="card-heading"><h2>예약 캘린더·게시 이력</h2><div className="actions"><input aria-label="조회 월" type="month" value={month} onChange={e=>{if(e.target.value){setMonth(e.target.value);setDay('');}}}/><button disabled={busy} onClick={()=>void run(refresh)}>새로고침</button></div></div><p className="muted">브라우저 시간대 기준 · 최신 순 50개씩 조회합니다. 현재 {offset+1}–{offset+records.length}번째 게시물입니다.</p><div className="calendar">{['일','월','화','수','목','금','토'].map(d=><strong key={d}>{d}</strong>)}{Array.from({length:firstDay},(_,i)=><span key={`empty-${i}`}/>)}{Array.from({length:days},(_,i)=>{const date=`${month}-${String(i+1).padStart(2,'0')}`;const count=records.filter(r=>r.post.status!=='draft'&&localDate(new Date(r.post.scheduledAt)).startsWith(date)).length;return <button className={date===day?'selected':''} key={date} onClick={()=>setDay(date===day?'':date)}><span>{i+1}</span>{count>0&&<small>{count}건</small>}</button>;})}</div><h3>{day||month} 게시물</h3>{!filtered.length&&<p className="empty">현재 조회 범위에 게시물이 없습니다.</p>}<div className="post-list">{filtered.map(r=><article key={r.post.id}><div><span className={`badge ${r.post.status}`}>{statuses[r.post.status]}</span><h3>{r.post.content.title||'제목 없음'}</h3><p>{new Date(r.post.scheduledAt).toLocaleString('ko-KR')} · {r.jobs.map(j=>labels[j.platform]).join(', ')}</p></div><div className="actions"><button disabled={busy} onClick={()=>{if(canLeave())void run(async()=>load(await api<RecordData>(`/posts/${r.post.id}`)));}}>열기 / 예약 변경</button><button disabled={busy} onClick={()=>{if(canLeave())act(r,'duplicate');}}>복제</button></div></article>)}</div><div className="actions"><button disabled={offset===0||busy} onClick={()=>setOffset(n=>Math.max(0,n-50))}>이전 50개</button><button disabled={records.length<50||busy} onClick={()=>setOffset(n=>n+50)}>다음 50개</button></div></section>}

    {preview&&<dialog ref={dialog} className="review-dialog" aria-labelledby="review-title" onCancel={e=>{e.preventDefault();if(!busy)setPreview(null);}}><div className="card-heading"><div><span className="eyebrow">FINAL REVIEW</span><h2 id="review-title">최종 게시 내용 확인</h2></div><button aria-label="검수 닫기" onClick={()=>setPreview(null)} disabled={busy}>×</button></div>{error&&<div className="message error" role="alert">{error}</div>}<div className="review-items">{preview.items.map(item=><article className="review-item" key={item.accountId}><strong>{labels[item.platform]} · {accountName(item.accountId)}</strong><p className="final-copy">{item.body}</p>{item.destinationUrl&&<p className="link-preview">홍보 링크: {item.destinationUrl}</p>}{item.media.map(m=>m.type==='image'?<Image key={m.url} className="preview" src={m.url} alt="최종 게시 이미지" width={600} height={600} unoptimized/>:<video key={m.url} className="preview" src={m.url} controls preload="metadata"/>)}</article>)}</div>{preview.issues.length>0&&<div className="message error" role="alert">{preview.issues.map(issue=><p key={issue}>{issue}</p>)}</div>}<fieldset disabled={busy}><legend>게시 시점</legend><div className="actions"><label className="inline"><input type="radio" checked={mode==='schedule'} onChange={()=>setMode('schedule')}/>예약 게시</label><label className="inline"><input type="radio" checked={mode==='now'} onChange={()=>setMode('now')}/>지금 게시</label></div>{mode==='schedule'&&<label>예약 일시<input type="datetime-local" value={scheduledAt} onChange={e=>setScheduledAt(e.target.value)}/></label>}<label className="inline approval"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>문구·이미지·대상 계정과 게시 시점을 확인했습니다.</label></fieldset><button className="primary" disabled={busy||!reviewed||preview.issues.length>0} onClick={approve}>{busy?'처리 중…':mode==='now'?'승인하고 지금 게시':'승인하고 예약 저장'}</button></dialog>}
  </main>;
}
