import assert from 'node:assert/strict';
// Requires the local fixture and frontend described in editorial-workflow.md.
const origin='http://localhost:3100';
const headers={cookie:'promotion_session=fixture.session.only',origin};
assert.equal((await fetch(`${origin}/api/backend/posts`)).status,401);
assert.equal((await fetch(`${origin}/api/backend/posts`,{headers})).status,200);
assert.equal((await fetch(`${origin}/api/backend/posts`,{method:'POST',headers:{...headers,origin:'https://untrusted.example','content-type':'application/json'},body:'{}'})).status,403);
assert.equal((await fetch(`${origin}/api/backend/not-allowed`,{headers})).status,404);
assert.equal((await fetch(`${origin}/api/backend/posts`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'x'.repeat(4*1024*1024+1)})).status,413);
assert.equal((await fetch(`${origin}/api/auth/logout`,{method:'POST',headers:{...headers,origin:'https://untrusted.example'},redirect:'manual'})).status,403);
const invalidCallback=await fetch(`${origin}/api/auth/callback?code=invalid&state=invalid`,{redirect:'manual'});
assert.equal(invalidCallback.status,307);assert.equal(new URL(invalidCallback.headers.get('location')).searchParams.get('login'),'failed');
assert.ok(!invalidCallback.headers.get('set-cookie')?.includes('promotion_session='));
console.log('PASS 7 local BFF checks: session, proxy allowlist, CSRF, upload size, logout, callback state.');
