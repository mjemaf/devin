import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { RequirementsController } from './requirements.controller';
import { DocumentsController } from './documents.controller';
import { SessionsController } from './sessions.controller';
import { OnboardingService } from './onboarding.service';
import { RequirementsService } from './requirements.service';
import { DocumentsService } from './documents.service';
import { SessionsService } from './sessions.service';
import { TimelineService } from './timeline.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [OnboardingController, RequirementsController, DocumentsController, SessionsController],
  providers: [OnboardingService, RequirementsService, DocumentsService, SessionsService, TimelineService],
  exports: [OnboardingService, RequirementsService, DocumentsService, SessionsService, TimelineService],
})
export class OnboardingModule {}
