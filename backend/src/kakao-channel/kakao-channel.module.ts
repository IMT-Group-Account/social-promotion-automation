import { Module } from '@nestjs/common';
import { KakaoChannelController } from './kakao-channel.controller';
import { KAKAO_CHANNEL_REPOSITORY } from './kakao-channel.repository';
import { KakaoChannelService } from './kakao-channel.service';
import { PgKakaoChannelRepository } from './pg-kakao-channel.repository';

@Module({
  controllers: [KakaoChannelController],
  providers: [KakaoChannelService, PgKakaoChannelRepository, { provide: KAKAO_CHANNEL_REPOSITORY, useExisting: PgKakaoChannelRepository }],
  exports: [KakaoChannelService],
})
export class KakaoChannelModule {}
