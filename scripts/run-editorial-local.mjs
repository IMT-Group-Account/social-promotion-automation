import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { testEditorialDatabase } from './test-editorial-db.mjs';

if(!process.env.EDITORIAL_TEST_TOOLS)throw new Error('Set EDITORIAL_TEST_TOOLS to a separate directory containing embedded-postgres. See docs/editorial-workflow.md.');
const {default:EmbeddedPostgres}=await import(pathToFileURL(join(process.env.EDITORIAL_TEST_TOOLS,'node_modules/embedded-postgres/dist/index.js')).href);
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const directory=await mkdtemp(join(tmpdir(),'promotion-editorial-'));
const password=randomBytes(24).toString('hex');
const postgres=new EmbeddedPostgres({databaseDir:join(directory,'pgdata'),user:'postgres',password,port,persistent:true,
  postgresFlags:['-h','127.0.0.1'],initdbFlags:['--locale=C','--encoding=UTF8'],onLog:()=>{},onError:()=>{}});
try{
  await postgres.initialise();await postgres.start();await postgres.createDatabase('promotion_test_editorial');
  await testEditorialDatabase(`postgresql://postgres:${password}@127.0.0.1:${port}/promotion_test_editorial`);
}finally{await postgres.stop();}
