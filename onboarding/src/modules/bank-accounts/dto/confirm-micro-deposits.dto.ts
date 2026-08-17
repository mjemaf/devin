import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Max, Min } from 'class-validator';

export class ConfirmMicroDepositsDto {
  @ApiProperty({ example: [12, 34], description: 'Deposit amounts in minor units' })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(99, { each: true })
  amounts!: number[];
}
