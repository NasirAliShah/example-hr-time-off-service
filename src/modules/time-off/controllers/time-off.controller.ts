import { Controller, Post, Get, Body, Query, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TimeOffRequestService } from '../services/time-off-request.service';
import { BalanceService } from '../../balance/services/balance.service';
import { SubmitRequestDto } from '../dto/submit-request.dto';
import { RequestResponseDto } from '../dto/request-response.dto';
import { AuthGuard, CurrentUser, AuthenticatedUser, Roles } from '../../../common';
import { RolesGuard } from '../../../common/guards/roles.guard';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class TimeOffController {
  constructor(
    private readonly timeOffRequestService: TimeOffRequestService,
    private readonly balanceService: BalanceService,
  ) {}

  @Post('requests')
  @Roles('employee')
  @UseGuards(RolesGuard)
  async submitRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitRequestDto,
  ): Promise<RequestResponseDto> {
    try {
      return await this.timeOffRequestService.submitRequest(user.id, dto);
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to submit request',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('requests')
  @Roles('employee')
  @UseGuards(RolesGuard)
  async getRequestHistory(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RequestResponseDto[]> {
    try {
      return await this.timeOffRequestService.getRequestHistory(user.id);
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to get request history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('balance')
  @Roles('employee')
  @UseGuards(RolesGuard)
  async getBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('locationId') locationId: string,
  ): Promise<any> {
    if (!locationId) {
      throw new HttpException('locationId is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.balanceService.getBalance(user.id, locationId);
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to get balance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
