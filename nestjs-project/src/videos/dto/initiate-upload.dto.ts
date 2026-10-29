import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class InitiateUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  original_filename: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  content_type: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  size_bytes: number;
}
