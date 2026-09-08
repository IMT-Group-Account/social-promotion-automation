import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { Campaign } from './campaign.entity';
@Injectable()
export class CampaignService {
  constructor(private readonly database: DatabaseService) {}
  async create(ownerId:string,name:string):Promise<Campaign> {
    if (!name.trim() || name.length>160) throw new BadRequestException('Campaign name must be 1-160 characters.');
    return this.database.transaction(async client => {
      await client.query('INSERT INTO users(id) VALUES($1) ON CONFLICT(id) DO NOTHING',[ownerId]);
      const result = await client.query(`INSERT INTO campaigns(owner_id,name) VALUES($1,$2) RETURNING id,owner_id AS "ownerId",name,status,created_at AS "createdAt",updated_at AS "updatedAt"`,[ownerId,name.trim()]);
      return result.rows[0] as Campaign;
    });
  }
  async findOwnedBy(id:string,ownerId:string):Promise<Campaign> {
    const result = await this.database.db().query('SELECT id,owner_id AS "ownerId",name,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM campaigns WHERE id=$1 AND owner_id=$2',[id,ownerId]);
    if (!result.rows[0]) throw new NotFoundException('Campaign not found.');
    return result.rows[0] as Campaign;
  }
  async findAllOwnedBy(ownerId:string):Promise<readonly Campaign[]> {
    return (await this.database.db().query('SELECT id,name,status,owner_id AS "ownerId",created_at AS "createdAt",updated_at AS "updatedAt" FROM campaigns WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 200',[ownerId])).rows as Campaign[];
  }
}
