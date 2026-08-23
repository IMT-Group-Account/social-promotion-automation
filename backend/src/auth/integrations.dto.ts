import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SelectFacebookPageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  selectionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  pageId!: string;
}
