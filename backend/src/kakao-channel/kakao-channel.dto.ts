import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, Matches, MaxLength } from 'class-validator';
import type { KakaoChannelInboundSource, KakaoConsultationStatus } from './kakao-channel.entity';

export class CreateKakaoChannelDto {
  @Matches(/^[_A-Za-z0-9-]{1,100}$/)
  publicId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  consultationUrl!: string;
}

export class CreateKakaoChannelEntryDto {
  @IsUUID()
  channelId!: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsIn(['linkedin', 'facebook', 'instagram', 'threads', 'x', 'direct'])
  source!: KakaoChannelInboundSource;
}

export class KakaoConsultationEventDto {
  @IsUUID()
  channelId!: string;

  @IsOptional()
  @IsUUID()
  inboundTrackingCode?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  externalConversationRef!: string;

  @IsIn(['started', 'assigned', 'resolved', 'closed'])
  status!: KakaoConsultationStatus;
}
