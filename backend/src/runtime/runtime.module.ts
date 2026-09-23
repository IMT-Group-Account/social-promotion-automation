import { Global,Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RuntimeHeartbeatService } from './runtime-heartbeat.service';
@Global()
@Module({providers:[DatabaseService,RuntimeHeartbeatService],exports:[DatabaseService,RuntimeHeartbeatService]})
export class RuntimeModule{}
