import { Pool } from 'pg';
const required=['DATABASE_URL','REDIS_URL','SERVICE_JWT_ISSUER','SERVICE_JWT_AUDIENCE','SERVICE_JWT_SIGNING_ALGORITHM','SERVICE_JWT_JWKS_URL','ADMIN_CONSOLE_ORIGIN','MEDIA_STORAGE_DIR','MEDIA_PUBLIC_BASE_URL'];
let errors=0;
for(const name of required)if(!process.env[name]){console.log(`MISSING ${name}`);errors++;}
if(process.env.DATABASE_URL){
  const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
  try{
    const columns=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='posts' AND column_name IN ('revision','platform_bodies')");
    if(columns.rowCount!==2){console.log('MISSING migration 014');errors++;}else console.log('OK editorial schema columns');
    const trigger=await pool.query("SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname='social_publish_jobs_enqueue_outbox_trigger' AND tgrelid='social_publish_jobs'::regclass");
    if(!trigger.rows[0]?.definition.includes('UPDATE OF')){console.log('MISSING scheduling update trigger');errors++;}else console.log('OK schedule update trigger');
    const drafts=await pool.query("SELECT count(*) FROM social_publish_queue_outbox o JOIN social_publish_jobs j ON j.id=o.publish_job_id JOIN posts p ON p.id=j.post_id WHERE p.status='draft'");
    if(Number(drafts.rows[0].count)){console.log('ERROR unapproved draft has an outbox record');errors++;}else console.log('OK no unapproved drafts in outbox');
  }catch{console.log('ERROR database readiness query failed; check connectivity and migrations');errors++;}finally{await pool.end();}
}
console.log(errors?`Readiness not confirmed: ${errors} configuration/check issue(s).`:'Backend prerequisites checked. This does not verify Redis, public media, OAuth, or real SNS publication.');
process.exitCode=errors?1:0;
