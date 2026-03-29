import { Test, TestingModule } from '@nestjs/testing';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

describe('ExportsController', () => {
  let controller: ExportsController;
  let service: DeepMockProxy<ExportsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportsController],
      providers: [
        { provide: ExportsService, useValue: mockDeep<ExportsService>() },
      ],
    }).compile();

    controller = module.get<ExportsController>(ExportsController);
    service = module.get(ExportsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('exportMembers', () => {
    it('should call service.getMembers and set CSV response headers', async () => {
      service.getMembers.mockResolvedValue([
        {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          phone: '',
          gender: 'FEMALE',
          birthday: '1990-05-15',
          status: 'ACTIVE',
          joinDate: '2026-01-01',
          currentPlan: 'Premium',
          subscriptionStatus: 'ACTIVE',
          subscriptionEndDate: '2026-06-01',
          paymentMethod: 'CARD',
        },
      ]);

      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as any;

      await controller.exportMembers({ format: 'csv' as any }, res);

      expect(service.getMembers).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('members-export-'),
      );
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe('exportPayments', () => {
    it('should call service.getPayments and set XLSX response headers', async () => {
      service.getPayments.mockResolvedValue([]);

      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as any;

      await controller.exportPayments({ format: 'xlsx' as any }, res);

      expect(service.getPayments).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    });
  });

  describe('exportSubscriptions', () => {
    it('should call service.getSubscriptions and set PDF response headers', async () => {
      service.getSubscriptions.mockResolvedValue([]);

      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as any;

      await controller.exportSubscriptions({ format: 'pdf' as any }, res);

      expect(service.getSubscriptions).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
    });
  });
});
