import { Controller, Post, Get, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SyncService } from '../services/sync.service';
import { SyncResultDto } from '../dto/sync-result.dto';
import { SyncLog } from '../entities/sync-log.entity';
import { AuthGuard, Roles } from '../../../common';
import { RolesGuard } from '../../../common/guards/roles.guard';

@Controller('api/v1/admin')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(private readonly syncService: SyncService) {}

  @Post('sync/batch')
  @Roles('admin')
  @UseGuards(RolesGuard)
  async triggerBatchSync(): Promise<SyncResultDto> {
    try {
      return await this.syncService.batchSync();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to trigger batch sync',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('sync/:id')
  @Roles('admin')
  @UseGuards(RolesGuard)
  async getSyncStatus(@Param('id') syncId: string): Promise<SyncLog[]> {
    try {
      return await this.syncService.getSyncLog(syncId);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to get sync status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('sync')
  @Roles('admin')
  @UseGuards(RolesGuard)
  async getRecentSyncLogs(): Promise<SyncLog[]> {
    try {
      return await this.syncService.getRecentSyncLogs(100);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to get sync logs',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
