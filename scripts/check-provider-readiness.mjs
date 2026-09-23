const platform=process.argv[2]?.toLowerCase();
const definitions={
  linkedin:{required:['OAUTH_LINKEDIN_CLIENT_ID','OAUTH_LINKEDIN_CLIENT_SECRET','OAUTH_LINKEDIN_AUTHORIZATION_URL','OAUTH_LINKEDIN_TOKEN_URL','OAUTH_LINKEDIN_PROFILE_URL','OAUTH_LINKEDIN_SCOPES','LINKEDIN_POSTS_URL','LINKEDIN_API_VERSION'],urls:['OAUTH_LINKEDIN_AUTHORIZATION_URL','OAUTH_LINKEDIN_TOKEN_URL','OAUTH_LINKEDIN_PROFILE_URL','LINKEDIN_POSTS_URL']},
  facebook:{required:['OAUTH_FACEBOOK_CLIENT_ID','OAUTH_FACEBOOK_CLIENT_SECRET','OAUTH_FACEBOOK_AUTHORIZATION_URL','OAUTH_FACEBOOK_TOKEN_URL','OAUTH_FACEBOOK_PROFILE_URL','OAUTH_FACEBOOK_SCOPES','OAUTH_FACEBOOK_MANAGED_PAGES_URL','FACEBOOK_GRAPH_API_BASE_URL'],urls:['OAUTH_FACEBOOK_AUTHORIZATION_URL','OAUTH_FACEBOOK_TOKEN_URL','OAUTH_FACEBOOK_PROFILE_URL','OAUTH_FACEBOOK_MANAGED_PAGES_URL','FACEBOOK_GRAPH_API_BASE_URL']},
  instagram:{required:['OAUTH_FACEBOOK_CLIENT_ID','OAUTH_FACEBOOK_CLIENT_SECRET','OAUTH_FACEBOOK_SCOPES','OAUTH_FACEBOOK_MANAGED_PAGES_URL','FACEBOOK_GRAPH_API_BASE_URL','INSTAGRAM_GRAPH_API_BASE_URL'],urls:['OAUTH_FACEBOOK_MANAGED_PAGES_URL','FACEBOOK_GRAPH_API_BASE_URL','INSTAGRAM_GRAPH_API_BASE_URL']},
  threads:{required:['OAUTH_THREADS_CLIENT_ID','OAUTH_THREADS_CLIENT_SECRET','OAUTH_THREADS_AUTHORIZATION_URL','OAUTH_THREADS_TOKEN_URL','OAUTH_THREADS_PROFILE_URL','OAUTH_THREADS_SCOPES','THREADS_GRAPH_API_BASE_URL'],urls:['OAUTH_THREADS_AUTHORIZATION_URL','OAUTH_THREADS_TOKEN_URL','OAUTH_THREADS_PROFILE_URL','THREADS_GRAPH_API_BASE_URL']},
  x:{required:['OAUTH_X_CLIENT_ID','OAUTH_X_CLIENT_SECRET','OAUTH_X_AUTHORIZATION_URL','OAUTH_X_TOKEN_URL','OAUTH_X_PROFILE_URL','OAUTH_X_SCOPES','X_API_BASE_URL','X_API_PRICING_VERSION','X_API_COST_POST_CREATE_MICRO_USD','X_API_MAX_ESTIMATED_COST_MICRO_USD_PER_REQUEST'],urls:['OAUTH_X_AUTHORIZATION_URL','OAUTH_X_TOKEN_URL','OAUTH_X_PROFILE_URL','X_API_BASE_URL']},
};
if(!platform||!definitions[platform]){
  console.error(`Usage: npm run check:provider -- <${Object.keys(definitions).join('|')}>`);
  process.exitCode=2;
}else{
  let errors=0;
  const definition=definitions[platform];
  const common=['PUBLIC_API_ORIGIN','OAUTH_TOKEN_ENCRYPTION_KEY_VERSION','OAUTH_TOKEN_ENCRYPTION_KEYS','MEDIA_PUBLIC_BASE_URL'];
  for(const name of [...common,...definition.required])if(!process.env[name]?.trim()){console.log(`MISSING ${name}`);errors++;}
  for(const name of ['PUBLIC_API_ORIGIN','MEDIA_PUBLIC_BASE_URL',...definition.urls]){
    const value=process.env[name];if(!value)continue;
    try{if(new URL(value).protocol!=='https:')throw new Error();}catch{console.log(`INVALID ${name} must be an HTTPS URL`);errors++;}
  }
  const keyVersion=process.env.OAUTH_TOKEN_ENCRYPTION_KEY_VERSION;
  const keyRing=process.env.OAUTH_TOKEN_ENCRYPTION_KEYS;
  if(keyVersion&&keyRing)try{
    const keys=JSON.parse(keyRing),decoded=Buffer.from(keys[keyVersion]??'','base64');
    if(decoded.length!==32)throw new Error();
  }catch{console.log('INVALID OAUTH token key ring or current 32-byte key');errors++;}
  if(platform==='x')for(const name of ['X_API_COST_POST_CREATE_MICRO_USD','X_API_MAX_ESTIMATED_COST_MICRO_USD_PER_REQUEST']){
    const value=Number(process.env[name]);if(!Number.isSafeInteger(value)||value<0){console.log(`INVALID ${name} must be a non-negative integer`);errors++;}
  }
  if(errors)console.log(`${platform} readiness not confirmed: ${errors} issue(s).`);
  else console.log(`${platform} static configuration passed. OAuth consent, provider approval, media ingestion, and a real private publication still require live verification.`);
  process.exitCode=errors?1:0;
}
