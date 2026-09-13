import { IsString, IsEnum, IsOptional, IsDate, IsBoolean, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Session Type
 */
export enum SessionType {
  HOSTED = 'hosted',
  EMBEDDED = 'embedded',
}

/**
 * Session Status
 */
export enum SessionStatus {
  CREATED = 'created',
  STARTED = 'started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
  EXPIRED = 'expired',
}

/**
 * Create Session DTO
 */
export class CreateSessionDto {
  @IsString()
  @IsEnum(SessionType)
  sessionType: SessionType;

  @IsString()
  applicationId: string;

  @IsString()
  @IsOptional()
  returnUrl?: string;

  @IsString()
  @IsOptional()
  cancelUrl?: string;

  @IsObject()
  @IsOptional()
  configuration?: {
    theme?: string;
    language?: string;
    skipSteps?: string[];
    prefilledData?: Record<string, any>;
  };
}

/**
 * Update Session DTO
 */
export class UpdateSessionDto {
  @IsEnum(SessionStatus)
  @IsOptional()
  status?: SessionStatus;

  @IsObject()
  @IsOptional()
  currentStep?: {
    stepId: string;
    completed: boolean;
  };

  @IsObject()
  @IsOptional()
  progress?: {
    totalSteps: number;
    completedSteps: number;
    percentage: number;
  };
}
