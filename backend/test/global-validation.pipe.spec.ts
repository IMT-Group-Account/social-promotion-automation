import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateCampaignDto } from '../src/campaigns/campaign.dto';
import { CreatePostDto } from '../src/posts/post.dto';
import { globalValidationPipeOptions } from '../src/validation/global-validation.pipe';

const metadata = { type: 'body' as const, metatype: CreateCampaignDto, data: undefined };

test('global validation pipe transforms DTOs and rejects non-whitelisted input', async () => {
  const pipe = new ValidationPipe(globalValidationPipeOptions);
  const transformed = await pipe.transform({ name: 'Campaign 2026' }, metadata);
  assert.ok(transformed instanceof CreateCampaignDto);

  await assert.rejects(
    () => pipe.transform({ name: 'Campaign 2026', unexpected: true }, metadata),
    BadRequestException,
  );
});

test('global validation pipe validates nested post DTO fields', async () => {
  const pipe = new ValidationPipe(globalValidationPipeOptions);
  await assert.rejects(
    () => pipe.transform({
      campaignId: 'campaign_001',
      content: { title: 'Support', body: 'Please support us.', media: [{ type: 'image', url: 'https://cdn.example.com/image.jpg', extra: 'blocked' }] },
      targets: [{ platform: 'instagram', accountId: 'account_001' }],
      scheduledAt: '2026-08-25T09:00:00.000Z',
    }, { type: 'body' as const, metatype: CreatePostDto, data: undefined }),
    BadRequestException,
  );
});
