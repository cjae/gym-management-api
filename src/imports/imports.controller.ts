import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ImportsService } from './imports.service';
import {
  ImportJobResponseDto,
  ImportJobDetailResponseDto,
} from './dto/import-members.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Imports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Insufficient role' })
@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('members')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({
    description: 'Import job created and processing in background',
    type: ImportJobResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid CSV format, missing headers, or active import exists',
  })
  async importMembers(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({
            fileType: /^text\/csv|application\/vnd\.ms-excel$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
  ) {
    return this.importsService.importMembers(file, adminId, adminEmail);
  }

  @Get()
  @ApiOkResponse({
    description: 'Paginated list of import jobs',
    type: [ImportJobResponseDto],
  })
  findAll(@Query() query: PaginationQueryDto) {
    return this.importsService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Import job details with error/skip report',
    type: ImportJobDetailResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Import job not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.importsService.findOne(id);
  }
}
