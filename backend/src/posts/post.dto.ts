import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsDefined, IsIn, IsInt, Min, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { SOCIAL_PLATFORMS, type SocialPlatform } from './post.entity';

export class PlatformBodiesDto {
  @IsOptional() @IsString() @MaxLength(3000) linkedin?: string;
  @IsOptional() @IsString() @MaxLength(2200) instagram?: string;
  @IsOptional() @IsString() @MaxLength(10000) facebook?: string;
  @IsOptional() @IsString() @MaxLength(500) threads?: string;
  @IsOptional() @IsString() @MaxLength(280) x?: string;
}

export class CreatePostMediaDto {
  @IsIn(['image', 'video'])
  type!: 'image' | 'video';

  @IsUrl({ protocols: ['https'], require_protocol: true })
  url!: string;
}

export class CreatePostContentDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformBodiesDto)
  platformBodies?: PlatformBodiesDto;
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
  @ArrayMaxSize(4)
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
  @IsUUID() accountId!: string;
}

export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @IsUUID() campaignId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => CreatePostContentDto)
  content!: CreatePostContentDto;

  @IsArray()
  @ArrayMaxSize(25)
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreatePostTargetDto)
  targets!: CreatePostTargetDto[];

  @IsISO8601()
  scheduledAt!: string;
}

export class SchedulePostDto {
  @IsInt()
  @Min(1)
  approvedRevision!: number;
  @IsISO8601()
  scheduledAt!: string;
}

export class ApprovePostDto {
  @IsInt() @Min(1) approvedRevision!: number;
}
export class UpdateDraftDto {
  @IsInt() @Min(1) revision!: number;
  @IsDefined() @ValidateNested() @Type(() => CreatePostContentDto) content!: CreatePostContentDto;
}
