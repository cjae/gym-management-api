/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '@prisma/client';

describe('AuditLogService', () => {
  let service: AuditLogService;

  const mockPrisma = {
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    subscriptionPlan: { findUnique: jest.fn() },
    memberSubscription: { findUnique: jest.fn() },
    staffSalaryRecord: { findUnique: jest.fn() },
    trainerProfile: { findUnique: jest.fn() },
    entrance: { findUnique: jest.fn() },
    gymQrCode: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AuditLogService>(AuditLogService);
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create an audit log entry', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({});

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

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
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
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.log({
        userId: null,
        action: AuditAction.LOGIN_FAILED,
        resource: 'Auth',
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
          action: AuditAction.LOGIN_FAILED,
          resource: 'Auth',
        }),
      });
    });

    it('should strip sensitive fields from oldData', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({});

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

      const call = mockPrisma.auditLog.create.mock.calls[0][0];
      expect(call.data.oldData).toEqual({ email: 'test@example.com' });
      expect(call.data.oldData).not.toHaveProperty('password');
      expect(call.data.oldData).not.toHaveProperty('paystackAuthorizationCode');
      expect(call.data.oldData).not.toHaveProperty('token');
      expect(call.data.oldData).not.toHaveProperty('signatureData');
    });

    it('should strip sensitive fields from newData', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({});

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

      const call = mockPrisma.auditLog.create.mock.calls[0][0];
      expect(call.data.newData).toEqual({ firstName: 'Jane' });
    });

    it('should handle null oldData and newData gracefully', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.log({
        userId: 'user-1',
        action: AuditAction.DELETE,
        resource: 'User',
        resourceId: 'user-2',
      });

      const call = mockPrisma.auditLog.create.mock.calls[0][0];
      expect(call.data.oldData).toBeUndefined();
      expect(call.data.newData).toBeUndefined();
    });

    it('should strip sensitive fields from metadata', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.log({
        userId: 'user-1',
        action: AuditAction.CREATE,
        resource: 'Auth',
        metadata: {
          reason: 'test',
          password: 'secret',
        },
      });

      const call = mockPrisma.auditLog.create.mock.calls[0][0];
      expect(call.data.metadata).toEqual({ reason: 'test' });
    });

    it('should not throw when database create fails', async () => {
      mockPrisma.auditLog.create.mockRejectedValue(new Error('DB down'));

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
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await service.fetchOldData('User', 'user-1');

      expect(result).toEqual(user);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should fetch SubscriptionPlan record', async () => {
      const plan = { id: 'plan-1', name: 'Monthly' };
      mockPrisma.subscriptionPlan.findUnique.mockResolvedValue(plan);

      const result = await service.fetchOldData('SubscriptionPlan', 'plan-1');

      expect(result).toEqual(plan);
      expect(mockPrisma.subscriptionPlan.findUnique).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
      });
    });

    it('should fetch Subscription (memberSubscription) record', async () => {
      const sub = { id: 'sub-1', status: 'ACTIVE' };
      mockPrisma.memberSubscription.findUnique.mockResolvedValue(sub);

      const result = await service.fetchOldData('Subscription', 'sub-1');

      expect(result).toEqual(sub);
      expect(mockPrisma.memberSubscription.findUnique).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
      });
    });

    it('should fetch Salary (staffSalaryRecord) record', async () => {
      const salary = { id: 'sal-1', amount: 50000 };
      mockPrisma.staffSalaryRecord.findUnique.mockResolvedValue(salary);

      const result = await service.fetchOldData('Salary', 'sal-1');

      expect(result).toEqual(salary);
    });

    it('should fetch Trainer (trainerProfile) record', async () => {
      const trainer = { id: 'trainer-1', specialization: 'Fitness' };
      mockPrisma.trainerProfile.findUnique.mockResolvedValue(trainer);

      const result = await service.fetchOldData('Trainer', 'trainer-1');

      expect(result).toEqual(trainer);
    });

    it('should fetch Entrance record', async () => {
      const entrance = { id: 'ent-1', name: 'Main' };
      mockPrisma.entrance.findUnique.mockResolvedValue(entrance);

      const result = await service.fetchOldData('Entrance', 'ent-1');

      expect(result).toEqual(entrance);
    });

    it('should fetch QrCode (gymQrCode) record', async () => {
      const qr = { id: 'qr-1', code: 'abc123' };
      mockPrisma.gymQrCode.findUnique.mockResolvedValue(qr);

      const result = await service.fetchOldData('QrCode', 'qr-1');

      expect(result).toEqual(qr);
    });

    it('should return null for unknown resource', async () => {
      const result = await service.fetchOldData('Unknown', 'id-1');

      expect(result).toBeNull();
    });

    it('should return null when record not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.fetchOldData('User', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when database query fails', async () => {
      mockPrisma.user.findUnique.mockRejectedValue(
        new Error('DB connection lost'),
      );

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
      mockPrisma.auditLog.findMany.mockResolvedValue(mockAuditLogs);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result).toEqual({
        data: mockAuditLogs,
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
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
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, userId: 'user-1' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
    });

    it('should apply action filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, action: AuditAction.CREATE });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: AuditAction.CREATE }),
        }),
      );
    });

    it('should apply resource filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, resource: 'User' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resource: 'User' }),
        }),
      );
    });

    it('should apply resourceId filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, resourceId: 'user-2' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceId: 'user-2' }),
        }),
      );
    });

    it('should apply date range filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      const startDate = '2026-03-01';
      const endDate = '2026-03-10';

      await service.findAll({ page: 1, limit: 20, startDate, endDate });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: new Date(startDate), lte: new Date(endDate) },
          }),
        }),
      );
    });

    it('should apply ipAddress filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, ipAddress: '192.168.1.1' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ipAddress: '192.168.1.1' }),
        }),
      );
    });

    it('should calculate correct pagination offset', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(50);

      const result = await service.findAll({ page: 3, limit: 10 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
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
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        limit: 20,
        userId: 'user-1',
        action: AuditAction.UPDATE,
        resource: 'User',
      });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
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
