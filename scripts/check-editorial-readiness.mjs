import { Pool } from 'pg';
const required=['DATABASE_URL','REDIS_URL','SERVICE_JWT_ISSUER','SERVICE_JWT_AUDIENCE','SERVICE_JWT_SIGNING_ALGORITHM','SERVICE_JWT_JWKS_URL','PUBLIC_API_ORIGIN','ADMIN_CONSOLE_ORIGIN','MEDIA_STORAGE_DIR','MEDIA_PUBLIC_BASE_URL','OAUTH_TOKEN_ENCRYPTION_KEY_VERSION','OAUTH_TOKEN_ENCRYPTION_KEYS'];
let errors=0;
for(const name of required)if(!process.env[name]){console.log(`MISSING ${name}`);errors++;}
if(process.env.SERVICE_RBAC_ENABLED!=='true'){console.log('INVALID SERVICE_RBAC_ENABLED must be true for operational readiness');errors++;}
if(!/^[A-Za-z0-9_.:-]{1,100}$/.test(process.env.SERVICE_JWT_ROLES_CLAIM??'')){console.log('INVALID SERVICE_JWT_ROLES_CLAIM');errors++;}
for(const name of ['SERVICE_JWT_JWKS_URL','PUBLIC_API_ORIGIN','ADMIN_CONSOLE_ORIGIN','MEDIA_PUBLIC_BASE_URL']){
  const value=process.env[name];if(!value)continue;
  try{if(new URL(value).protocol!=='https:')throw new Error();}catch{console.log(`INVALID ${name} must be an HTTPS URL`);errors++;}
}
if(process.env.OAUTH_TOKEN_ENCRYPTION_KEYS&&process.env.OAUTH_TOKEN_ENCRYPTION_KEY_VERSION)try{
  const keys=JSON.parse(process.env.OAUTH_TOKEN_ENCRYPTION_KEYS),current=Buffer.from(keys[process.env.OAUTH_TOKEN_ENCRYPTION_KEY_VERSION]??'','base64');
  if(current.length!==32)throw new Error();
}catch{console.log('INVALID OAUTH token key ring or current 32-byte key');errors++;}
if(process.env.DATABASE_URL){
  const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
  try{
    const columns=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='posts' AND column_name IN ('revision','platform_bodies')");
    if(columns.rowCount!==2){console.log('MISSING migration 014');errors++;}else console.log('OK editorial schema columns');
    const alertColumns=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='social_publish_failure_alerts' AND column_name IN ('delivery_attempts','next_delivery_at','lease_expires_at','last_delivery_error')");
    if(alertColumns.rowCount!==4){console.log('MISSING migration 015');errors++;}else console.log('OK failure alert delivery columns');
    const heartbeatTable=await pool.query("SELECT to_regclass(current_schema()||'.runtime_heartbeats') AS table_name");
    if(!heartbeatTable.rows[0]?.table_name){console.log('MISSING migration 016');errors++;}else console.log('OK runtime heartbeat table');
    const trigger=await pool.query("SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname='social_publish_jobs_enqueue_outbox_trigger' AND tgrelid='social_publish_jobs'::regclass");
    if(!trigger.rows[0]?.definition.includes('UPDATE OF')){console.log('MISSING scheduling update trigger');errors++;}else console.log('OK schedule update trigger');
    const drafts=await pool.query("SELECT count(*) FROM social_publish_queue_outbox o JOIN social_publish_jobs j ON j.id=o.publish_job_id JOIN posts p ON p.id=j.post_id WHERE p.status='draft'");
    if(Number(drafts.rows[0].count)){console.log('ERROR unapproved draft has an outbox record');errors++;}else console.log('OK no unapproved drafts in outbox');
  }catch{console.log('ERROR database readiness query failed; check connectivity and migrations');errors++;}finally{await pool.end();}
}
console.log(errors?`Readiness not confirmed: ${errors} configuration/check issue(s).`:'Backend static and database prerequisites checked. This does not verify Redis, public media retrieval, OAuth consent, webhook receipt, or real SNS publication.');
process.exitCode=errors?1:0;
