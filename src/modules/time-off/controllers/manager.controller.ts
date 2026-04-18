import { Controller, Post, Get, Param, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TimeOffRequestService } from '../services/time-off-request.service';
import { ApproveRequestDto } from '../dto/approve-request.dto';
import { RejectRequestDto } from '../dto/reject-request.dto';
import { RequestResponseDto } from '../dto/request-response.dto';
import { AuthGuard, CurrentUser, AuthenticatedUser, Roles } from '../../../common';
import { RolesGuard } from '../../../common/guards/roles.guard';

@Controller('api/v1/manager')
@UseGuards(AuthGuard)
export class ManagerController {
  constructor(private readonly timeOffRequestService: TimeOffRequestService) {}

  @Get('requests')
  @Roles('manager')
  @UseGuards(RolesGuard)
  async getPendingRequests(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RequestResponseDto[]> {
    try {
      return await this.timeOffRequestService.getPendingRequests(user.id);
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to get pending requests',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('requests/:id/approve')
  @Roles('manager')
  @UseGuards(RolesGuard)
  async approveRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') requestId: string,
    @Body() dto: ApproveRequestDto,
  ): Promise<RequestResponseDto> {
    try {
      return await this.timeOffRequestService.approveRequest(requestId, user.id, dto);
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to approve request',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('requests/:id/reject')
  @Roles('manager')
  @UseGuards(RolesGuard)
  async rejectRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') requestId: string,
    @Body() dto: RejectRequestDto,
  ): Promise<RequestResponseDto> {
    try {
      return await this.timeOffRequestService.rejectRequest(requestId, user.id, dto);
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to reject request',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
