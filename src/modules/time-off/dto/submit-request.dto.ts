import { IsNotEmpty, IsNumber, IsDateString, IsString, Min, IsOptional, IsUUID } from 'class-validator';

export class SubmitRequestDto {
  @IsNumber()
  @Min(0.5)
  @IsNotEmpty()
  days: number;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsUUID()
  @IsOptional()
  idempotencyKey?: string;
}
