import { RequestStatus } from '../entities/time-off-request.entity';

export class RequestResponseDto {
  id: string;
  employeeId: string;
  locationId: string;
  managerId: string | null;
  days: number;
  startDate: string;
  endDate: string;
  status: RequestStatus;
  managerComment: string | null;
  hcmConfirmationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  confirmedAt: Date | null;
}
