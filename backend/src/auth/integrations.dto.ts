import { IsIn, IsOptional, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SelectFacebookPageDto {
  @IsOptional() @IsIn(['facebook','instagram']) platform?: 'facebook'|'instagram';
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  selectionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  pageId!: string;
}
