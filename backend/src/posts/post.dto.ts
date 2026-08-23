import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { SOCIAL_PLATFORMS, type SocialPlatform } from './post.entity';

export class CreatePostMediaDto {
  @IsIn(['image', 'video'])
  type!: 'image' | 'video';

  @IsUrl({ protocols: ['https'], require_protocol: true })
  url!: string;
}

export class CreatePostContentDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  body!: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url!: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePostMediaDto)
  media!: CreatePostMediaDto[];
}

export class CreatePostTargetDto {
  @IsIn(SOCIAL_PLATFORMS)
  platform!: SocialPlatform;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  accountId!: string;
}

export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  campaignId!: string;

  @ValidateNested()
  @Type(() => CreatePostContentDto)
  content!: CreatePostContentDto;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreatePostTargetDto)
  targets!: CreatePostTargetDto[];

  @IsISO8601()
  scheduledAt!: string;
}

export class SchedulePostDto {
  @IsISO8601()
  scheduledAt!: string;
}
