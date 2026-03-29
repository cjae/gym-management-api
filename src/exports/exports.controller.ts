import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
import { ExportsService } from './exports.service';
import {
  ExportMembersQueryDto,
  ExportFormat,
} from './dto/export-members-query.dto';
import { ExportPaymentsQueryDto } from './dto/export-payments-query.dto';
import { ExportSubscriptionsQueryDto } from './dto/export-subscriptions-query.dto';
import { ExportColumn } from './formatters/csv.formatter';
import { formatCsv } from './formatters/csv.formatter';
import { formatExcel } from './formatters/excel.formatter';
import { formatPdf } from './formatters/pdf.formatter';

const MEMBERS_COLUMNS: ExportColumn[] = [
  { header: 'First Name', key: 'firstName' },
  { header: 'Last Name', key: 'lastName' },
  { header: 'Email', key: 'email' },
  { header: 'Phone', key: 'phone' },
  { header: 'Gender', key: 'gender' },
  { header: 'Birthday', key: 'birthday' },
  { header: 'Status', key: 'status' },
  { header: 'Join Date', key: 'joinDate' },
  { header: 'Current Plan', key: 'currentPlan' },
  { header: 'Subscription Status', key: 'subscriptionStatus' },
  { header: 'Subscription End Date', key: 'subscriptionEndDate' },
  { header: 'Payment Method', key: 'paymentMethod' },
];

const PAYMENTS_COLUMNS: ExportColumn[] = [
  { header: 'Member Name', key: 'memberName' },
  { header: 'Member Email', key: 'memberEmail' },
  { header: 'Plan Name', key: 'planName' },
  { header: 'Amount (KES)', key: 'amount' },
  { header: 'Payment Status', key: 'paymentStatus' },
  { header: 'Payment Method', key: 'paymentMethod' },
  { header: 'Reference', key: 'reference' },
  { header: 'Date', key: 'date' },
];

const SUBSCRIPTIONS_COLUMNS: ExportColumn[] = [
  { header: 'Primary Member', key: 'primaryMember' },
  { header: 'Primary Email', key: 'primaryEmail' },
  { header: 'Duo Member', key: 'duoMember' },
  { header: 'Duo Email', key: 'duoEmail' },
  { header: 'Plan', key: 'plan' },
  { header: 'Price (KES)', key: 'price' },
  { header: 'Billing Interval', key: 'billingInterval' },
  { header: 'Status', key: 'status' },
  { header: 'Start Date', key: 'startDate' },
  { header: 'End Date', key: 'endDate' },
  { header: 'Auto-Renew', key: 'autoRenew' },
  { header: 'Payment Method', key: 'paymentMethod' },
  { header: 'Frozen', key: 'frozen' },
];

const CONTENT_TYPES: Record<ExportFormat, string> = {
  [ExportFormat.CSV]: 'text/csv',
  [ExportFormat.XLSX]:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  [ExportFormat.PDF]: 'application/pdf',
};

const FILE_EXTENSIONS: Record<ExportFormat, string> = {
  [ExportFormat.CSV]: 'csv',
  [ExportFormat.XLSX]: 'xlsx',
  [ExportFormat.PDF]: 'pdf',
};

@ApiTags('Exports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({
  description: 'Insufficient role or feature not enabled',
})
@Controller('exports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequiresFeature('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('members')
  @ApiOkResponse({ description: 'Members data file download' })
  async exportMembers(
    @Query() query: ExportMembersQueryDto,
    @Res() res: Response,
  ) {
    const format = query.format || ExportFormat.CSV;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { format: _format, ...filters } = query;
    const data = await this.exportsService.getMembers(filters);
    const buffer = await this.formatData(
      data,
      MEMBERS_COLUMNS,
      'Members',
      format,
    );
    this.sendFile(res, buffer, 'members-export', format);
  }

  @Get('payments')
  @ApiOkResponse({ description: 'Payments data file download' })
  async exportPayments(
    @Query() query: ExportPaymentsQueryDto,
    @Res() res: Response,
  ) {
    const format = query.format || ExportFormat.CSV;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { format: _format, ...filters } = query;
    const data = await this.exportsService.getPayments(filters);
    const buffer = await this.formatData(
      data,
      PAYMENTS_COLUMNS,
      'Payments',
      format,
    );
    this.sendFile(res, buffer, 'payments-export', format);
  }

  @Get('subscriptions')
  @ApiOkResponse({ description: 'Subscriptions data file download' })
  async exportSubscriptions(
    @Query() query: ExportSubscriptionsQueryDto,
    @Res() res: Response,
  ) {
    const format = query.format || ExportFormat.CSV;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { format: _format, ...filters } = query;
    const data = await this.exportsService.getSubscriptions(filters);
    const buffer = await this.formatData(
      data,
      SUBSCRIPTIONS_COLUMNS,
      'Subscriptions',
      format,
    );
    this.sendFile(res, buffer, 'subscriptions-export', format);
  }

  private async formatData(
    data: Record<string, any>[],
    columns: ExportColumn[],
    sheetName: string,
    format: ExportFormat,
  ): Promise<Buffer> {
    switch (format) {
      case ExportFormat.XLSX:
        return formatExcel(data, columns, sheetName);
      case ExportFormat.PDF:
        return formatPdf(data, columns, `${sheetName} Export`);
      case ExportFormat.CSV:
      default:
        return formatCsv(data, columns);
    }
  }

  private sendFile(
    res: Response,
    buffer: Buffer,
    name: string,
    format: ExportFormat,
  ) {
    const date = new Date().toISOString().split('T')[0];
    const ext = FILE_EXTENSIONS[format];
    res.setHeader('Content-Type', CONTENT_TYPES[format]);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${name}-${date}.${ext}"`,
    );
    res.send(buffer);
  }
}
