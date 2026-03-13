import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogController } from './audit-logs.controller';
import { AuditLogService } from './audit-logs.service';
import { AuditAction } from '@prisma/client';

describe('AuditLogController', () => {
  let controller: AuditLogController;

  const mockService = {
    findAll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [{ provide: AuditLogService, useValue: mockService }],
    }).compile();

    controller = module.get<AuditLogController>(AuditLogController);
    jest.clearAllMocks();
  });

  it('should return paginated audit logs by calling findAll with query params', async () => {
    const mockResult = {
      data: [
        {
          id: 'log-1',
          userId: 'user-1',
          action: AuditAction.CREATE,
          resource: 'User',
          resourceId: 'user-2',
          createdAt: new Date('2026-03-10'),
          user: {
            id: 'user-1',
            email: 'admin@example.com',
            firstName: 'Admin',
            lastName: 'User',
          },
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    mockService.findAll.mockResolvedValue(mockResult);

    const query = { page: 1, limit: 20 };
    const result = await controller.findAll(query);

    expect(result).toEqual(mockResult);
    expect(mockService.findAll).toHaveBeenCalledWith(query);
    expect(mockService.findAll).toHaveBeenCalledTimes(1);
  });

  it('should pass filters to the service', async () => {
    const mockResult = {
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
    mockService.findAll.mockResolvedValue(mockResult);

    const query = {
      page: 1,
      limit: 20,
      userId: 'user-1',
      action: AuditAction.UPDATE,
      resource: 'User',
      resourceId: 'user-2',
      startDate: '2026-03-01',
      endDate: '2026-03-10',
      ipAddress: '192.168.1.1',
    };
    const result = await controller.findAll(query);

    expect(result).toEqual(mockResult);
    expect(mockService.findAll).toHaveBeenCalledWith(query);
  });
});
