export class SyncResultDto {
  syncId: string;
  timestamp: Date;
  totalRecords: number;
  successCount: number;
  conflictCount: number;
  errorCount: number;
  conflicts: Array<{
    employeeId: string;
    locationId: string;
    localBalance: number;
    hcmBalance: number;
    delta: number;
  }>;
  errors: Array<{
    employeeId: string;
    locationId: string;
    error: string;
  }>;
}
