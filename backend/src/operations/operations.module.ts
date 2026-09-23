import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
@Module({controllers:[OperationsController],providers:[OperationsService,DatabaseService]})
export class OperationsModule{}
