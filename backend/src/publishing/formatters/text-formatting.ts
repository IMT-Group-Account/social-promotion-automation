import type { OriginalCampaignContent } from './platform-content.interface';

export function titleAndMessage(input: OriginalCampaignContent): string {
  return [input.title.trim(), input.message.trim()].filter(Boolean).join('\n\n');
}

export function compact(text: string, maximumCharacters: number): string {
  const characters = [...text.trim()];
  if (characters.length <= maximumCharacters) return characters.join('');
  return `${characters.slice(0, Math.max(1, maximumCharacters - 1)).join('').trimEnd()}…`;
}

export function extractHashtags(message: string): readonly string[] {
  const tags = message.match(/(?:^|\s)#([\p{L}\p{N}_]{1,50})/gu) ?? [];
  return [...new Set(tags.map((tag) => `#${tag.trim().replace(/^#/, '')}`))].slice(0, 30);
}

export function removeHashtags(message: string): string {
  return message.replace(/(?:^|\s)#[\p{L}\p{N}_]{1,50}/gu, ' ').replace(/\s{2,}/g, ' ').trim();
}
