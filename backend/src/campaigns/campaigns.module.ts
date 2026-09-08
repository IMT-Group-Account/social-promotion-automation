import { DatabaseService } from '../database/database.service';
import { Module } from '@nestjs/common';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

@Module({ controllers: [CampaignController], providers: [CampaignService, DatabaseService], exports: [CampaignService] })
export class CampaignsModule {}
