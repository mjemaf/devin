import { Module } from '@nestjs/common';
import { WorkflowEngine } from './workflow-engine.service';
import { DiligenceSagaService } from './diligence-saga.service';
import { WorkflowController } from './workflow.controller';
import { VerificationModule } from '../verification/verification.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [VerificationModule, DatabaseModule],
  controllers: [WorkflowController],
  providers: [WorkflowEngine, DiligenceSagaService],
  exports: [WorkflowEngine, DiligenceSagaService],
})
export class WorkflowModule {}
