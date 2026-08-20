import assert from 'node:assert/strict';
import test from 'node:test';
import { FormatterService } from '../src/publishing/formatter.service';
import type { Post, SocialPublishJob } from '../src/posts/post.entity';

const post: Post = {
  id: 'post_001', campaignId: 'campaign_001', ownerId: 'owner_001', status: 'scheduled', scheduledAt: new Date('2026-08-21T00:00:00Z'),
  content: {
    title: 'Flood relief campaign', body: 'Help children affected by flooding. #FloodRelief #ChildSupport',
    url: 'https://example.com/campaign/123', media: [],
  },
};

function job(platform: SocialPublishJob['platform']): SocialPublishJob {
  return {
    id: `${platform}-job`, postId: post.id, platform, accountId: `${platform}-account`, status: 'processing', scheduledAt: post.scheduledAt,
    publishedAt: null, remotePostId: null, remotePostUrl: null, errorCode: null, errorMessage: null, retryCount: 0, leaseExpiresAt: null, nextRetryAt: null,
  };
}

test('preserves original campaign content and creates a distinct content object for every social platform', () => {
  const formatter = new FormatterService();
  const formatted = formatter.formatAll(post);

  assert.deepEqual(formatted.original, {
    title: 'Flood relief campaign', message: 'Help children affected by flooding. #FloodRelief #ChildSupport', url: 'https://example.com/campaign/123',
  });
  assert.deepEqual(formatted.platformContents.instagram.hashtags, ['#FloodRelief', '#ChildSupport']);
  assert.equal(formatted.platformContents.instagram.caption.includes('#FloodRelief #ChildSupport'), true);
  assert.equal(formatted.platformContents.facebook.message.includes('https://example.com'), false);
  assert.equal(formatted.platformContents.linkedin.text.startsWith('Flood relief campaign\n\n'), true);
  assert.notEqual(formatted.platformContents.linkedin.text, formatted.platformContents.instagram.caption);
  assert.notEqual(formatted.platformContents.threads.text, formatted.platformContents.facebook.message);
});

test('passes the platform-specific result to the publishing adapter contract without mutating the original post', () => {
  const formatter = new FormatterService();
  const formattedInstagram = formatter.format(post, job('instagram'));
  const formattedFacebook = formatter.format(post, job('facebook'));

  assert.equal(formattedInstagram.body, 'Flood relief campaign\n\nHelp children affected by flooding.\n\nhttps://example.com/campaign/123\n\n#FloodRelief #ChildSupport');
  assert.equal(formattedFacebook.body, 'Flood relief campaign\n\nHelp children affected by flooding. #FloodRelief #ChildSupport');
  assert.deepEqual(post.content, {
    title: 'Flood relief campaign', body: 'Help children affected by flooding. #FloodRelief #ChildSupport',
    url: 'https://example.com/campaign/123', media: [],
  });
});

test('reserves URL space when formatting X content', () => {
  const formatter = new FormatterService();
  const longPost: Post = { ...post, content: { ...post.content, body: 'A'.repeat(500) } };
  const formatted = formatter.format(longPost, job('x'));
  assert.ok([...formatted.body].length + [...(formatted.destinationUrl ?? '')].length + 1 <= 280);
});
