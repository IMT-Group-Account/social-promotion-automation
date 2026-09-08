import type { SocialPlatform } from '../posts/post.entity';

/** Requirements mirror the registered adapters, not a claim of provider app approval. */
export function missingPublishingScopes(platform:SocialPlatform,scope:readonly string[],externalId:string):string[]{
  const required:Record<SocialPlatform,readonly string[]>={
    facebook:['pages_manage_posts'],instagram:['instagram_content_publish'],threads:['threads_content_publish'],
    linkedin:[externalId.startsWith('urn:li:organization:')?'w_organization_social':'w_member_social'],
    x:['tweet.read','tweet.write','users.read'],
  };
  return required[platform].filter(s=>!scope.includes(s));
}
