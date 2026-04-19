import { IsString, IsOptional } from 'class-validator';

export class RejectRequestDto {
  @IsString()
  @IsOptional()
  comment?: string;
}
