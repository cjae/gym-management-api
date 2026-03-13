/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { AuditLogService } from './audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '@prisma/client';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();
    service = module.get<AuditLogService>(AuditLogService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create an audit log entry', async () => {
      prisma.auditLog.create.mockResolvedValue({} as any);

      await service.log({
        userId: 'user-1',
        action: AuditAction.CREATE,
        resource: 'User',
        resourceId: 'user-2',
        newData: { email: 'test@example.com', firstName: 'John' },
        ipAddress: '127.0.0.1',
        userAgent: 'Jest',
        route: 'POST /api/v1/users',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          action: AuditAction.CREATE,
          resource: 'User',
          resourceId: 'user-2',
          oldData: undefined,
          newData: { email: 'test@example.com', firstName: 'John' },
          ipAddress: '127.0.0.1',
          userAgent: 'Jest',
          route: 'POST /api/v1/users',
          metadata: undefined,
        },
      });
    });

    it('should accept null userId for unauthenticated actions', async () => {
      prisma.auditLog.create.mockResolvedValue({} as any);

      await service.log({
        userId: null,
        action: AuditAction.LOGIN_FAILED,
        resource: 'Auth',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
          action: AuditAction.LOGIN_FAILED,
          resource: 'Auth',
        }),
      });
    });

    it('should strip sensitive fields from oldData', async () => {
      prisma.auditLog.create.mockResolvedValue({} as any);

      await service.log({
        userId: 'user-1',
        action: AuditAction.UPDATE,
        resource: 'User',
        resourceId: 'user-2',
        oldData: {
          email: 'test@example.com',
          password: 'hashed-secret',
          paystackAuthorizationCode: 'AUTH_xxx',
          token: 'some-token',
          signatureData: 'base64data',
        },
      });

      const call = prisma.auditLog.create.mock.calls[0][0];
      expect(call.data.oldData).toEqual({ email: 'test@example.com' });
      expect(call.data.oldData).not.toHaveProperty('password');
      expect(call.data.oldData).not.toHaveProperty('paystackAuthorizationCode');
      expect(call.data.oldData).not.toHaveProperty('token');
      expect(call.data.oldData).not.toHaveProperty('signatureData');
    });

    it('should strip sensitive fields from newData', async () => {
      prisma.auditLog.create.mockResolvedValue({} as any);

      await service.log({
        userId: 'user-1',
        action: AuditAction.UPDATE,
        resource: 'User',
        resourceId: 'user-2',
        newData: {
          firstName: 'Jane',
          password: 'new-hashed',
          token: 'refresh-token',
        },
      });

      const call = prisma.auditLog.create.mock.calls[0][0];
      expect(call.data.newData).toEqual({ firstName: 'Jane' });
    });

    it('should handle null oldData and newData gracefully', async () => {
      prisma.auditLog.create.mockResolvedValue({} as any);

      await service.log({
        userId: 'user-1',
        action: AuditAction.DELETE,
        resource: 'User',
        resourceId: 'user-2',
      });

      const call = prisma.auditLog.create.mock.calls[0][0];
      expect(call.data.oldData).toBeUndefined();
      expect(call.data.newData).toBeUndefined();
    });

    it('should strip sensitive fields from metadata', async () => {
      prisma.auditLog.create.mockResolvedValue({} as any);

      await service.log({
        userId: 'user-1',
        action: AuditAction.CREATE,
        resource: 'Auth',
        metadata: {
          reason: 'test',
          password: 'secret',
        },
      });

      const call = prisma.auditLog.create.mock.calls[0][0];
      expect(call.data.metadata).toEqual({ reason: 'test' });
    });

    it('should not throw when database create fails', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB down'));

      await expect(
        service.log({
          userId: null,
          action: AuditAction.LOGIN,
          resource: 'Auth',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('fetchOldData', () => {
    it('should fetch User record', async () => {
      const user = { id: 'user-1', email: 'test@example.com' };
      prisma.user.findUnique.mockResolvedValue(user as any);

      const result = await service.fetchOldData('User', 'user-1');

      expect(result).toEqual(user);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should fetch SubscriptionPlan record', async () => {
      const plan = { id: 'plan-1', name: 'Monthly' };
      prisma.subscriptionPlan.findUnique.mockResolvedValue(plan as any);

      const result = await service.fetchOldData('SubscriptionPlan', 'plan-1');

      expect(result).toEqual(plan);
      expect(prisma.subscriptionPlan.findUnique).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
      });
    });

    it('should fetch Subscription (memberSubscription) record', async () => {
      const sub = { id: 'sub-1', status: 'ACTIVE' };
      prisma.memberSubscription.findUnique.mockResolvedValue(sub as any);

      const result = await service.fetchOldData('Subscription', 'sub-1');

      expect(result).toEqual(sub);
      expect(prisma.memberSubscription.findUnique).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
      });
    });

    it('should fetch Salary (staffSalaryRecord) record', async () => {
      const salary = { id: 'sal-1', amount: 50000 };
      prisma.staffSalaryRecord.findUnique.mockResolvedValue(salary as any);

      const result = await service.fetchOldData('Salary', 'sal-1');

      expect(result).toEqual(salary);
    });

    it('should fetch Trainer (trainerProfile) record', async () => {
      const trainer = { id: 'trainer-1', specialization: 'Fitness' };
      prisma.trainerProfile.findUnique.mockResolvedValue(trainer as any);

      const result = await service.fetchOldData('Trainer', 'trainer-1');

      expect(result).toEqual(trainer);
    });

    it('should fetch Entrance record', async () => {
      const entrance = { id: 'ent-1', name: 'Main' };
      prisma.entrance.findUnique.mockResolvedValue(entrance as any);

      const result = await service.fetchOldData('Entrance', 'ent-1');

      expect(result).toEqual(entrance);
    });

    it('should fetch QrCode (gymQrCode) record', async () => {
      const qr = { id: 'qr-1', code: 'abc123' };
      prisma.gymQrCode.findUnique.mockResolvedValue(qr as any);

      const result = await service.fetchOldData('QrCode', 'qr-1');

      expect(result).toEqual(qr);
    });

    it('should return null for unknown resource', async () => {
      const result = await service.fetchOldData('Unknown', 'id-1');

      expect(result).toBeNull();
    });

    it('should return null when record not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.fetchOldData('User', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when database query fails', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.fetchOldData('User', 'user-1');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    const mockAuditLogs = [
      {
        id: 'log-1',
        userId: 'user-1',
        action: AuditAction.CREATE,
        resource: 'User',
        resourceId: 'user-2',
        oldData: null,
        newData: { firstName: 'John' },
        ipAddress: '127.0.0.1',
        userAgent: 'Jest',
        route: 'POST /api/v1/users',
        metadata: null,
        createdAt: new Date('2026-03-10'),
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          firstName: 'Admin',
          lastName: 'User',
        },
      },
    ];

    it('should return paginated audit logs', async () => {
      prisma.auditLog.findMany.mockResolvedValue(mockAuditLogs as any);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result).toEqual({
        data: mockAuditLogs,
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should apply userId filter', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, userId: 'user-1' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
    });

    it('should apply action filter', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, action: AuditAction.CREATE });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: AuditAction.CREATE }),
        }),
      );
    });

    it('should apply resource filter', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, resource: 'User' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resource: 'User' }),
        }),
      );
    });

    it('should apply resourceId filter', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, resourceId: 'user-2' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceId: 'user-2' }),
        }),
      );
    });

    it('should apply date range filter', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      const startDate = '2026-03-01';
      const endDate = '2026-03-10';

      await service.findAll({ page: 1, limit: 20, startDate, endDate });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: new Date(startDate), lte: new Date(endDate) },
          }),
        }),
      );
    });

    it('should apply ipAddress filter', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, ipAddress: '192.168.1.1' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ipAddress: '192.168.1.1' }),
        }),
      );
    });

    it('should calculate correct pagination offset', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(50);

      const result = await service.findAll({ page: 3, limit: 10 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.meta).toEqual({
        page: 3,
        limit: 10,
        total: 50,
        totalPages: 5,
      });
    });

    it('should apply multiple filters simultaneously', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        limit: 20,
        userId: 'user-1',
        action: AuditAction.UPDATE,
        resource: 'User',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            action: AuditAction.UPDATE,
            resource: 'User',
          }),
        }),
      );
    });
  });
});
