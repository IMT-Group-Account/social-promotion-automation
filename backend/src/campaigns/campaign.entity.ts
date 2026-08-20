export type CampaignStatus = 'draft' | 'active' | 'archived';

export interface Campaign {
  id: string;
  ownerId: string;
  name: string;
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}
