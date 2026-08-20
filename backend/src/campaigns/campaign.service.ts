import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Campaign } from './campaign.entity';

@Injectable()
export class CampaignService {
  private readonly campaigns = new Map<string, Campaign>();

  create(ownerId: string, name: string): Campaign {
    if (!name.trim() || name.length > 160) throw new TypeError('Campaign name must be 1-160 characters.');
    const now = new Date();
    const campaign: Campaign = { id: randomUUID(), ownerId, name, status: 'draft', createdAt: now, updatedAt: now };
    this.campaigns.set(campaign.id, campaign);
    return campaign;
  }

  findOwnedBy(id: string, ownerId: string): Campaign {
    const campaign = this.campaigns.get(id);
    if (!campaign || campaign.ownerId !== ownerId) throw new NotFoundException('Campaign not found.');
    return campaign;
  }

  findAllOwnedBy(ownerId: string): readonly Campaign[] {
    return [...this.campaigns.values()]
      .filter((campaign) => campaign.ownerId === ownerId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }
}
