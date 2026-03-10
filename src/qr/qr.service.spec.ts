/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QrService } from './qr.service';
import { PrismaService } from '../prisma/prisma.service';

describe('QrService', () => {
  let service: QrService;

  const mockPrisma = {
    gymQrCode: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockEventEmitter = { emit: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QrService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();
    service = module.get<QrService>(QrService);
    jest.clearAllMocks();
  });

  describe('generateCode', () => {
    it('should deactivate old codes and create a new one', async () => {
      const mockCode = { id: 'qr-1', code: 'abc123', isActive: true };
      mockPrisma.gymQrCode.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.gymQrCode.create.mockResolvedValue(mockCode);

      const result = await service.generateCode();

      expect(mockPrisma.gymQrCode.updateMany).toHaveBeenCalledWith({
        where: { isActive: true },
        data: { isActive: false },
      });
      expect(mockPrisma.gymQrCode.create).toHaveBeenCalledWith({
        data: { code: expect.any(String), isActive: true },
      });
      expect(result).toEqual(mockCode);
    });
  });

  describe('rotateDailyCode', () => {
    it('should generate a new code and emit qr.rotated event', async () => {
      const mockCode = { id: 'qr-2', code: 'def456', isActive: true };
      mockPrisma.gymQrCode.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.gymQrCode.create.mockResolvedValue(mockCode);

      await service.rotateDailyCode();

      expect(mockPrisma.gymQrCode.updateMany).toHaveBeenCalled();
      expect(mockPrisma.gymQrCode.create).toHaveBeenCalled();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('qr.rotated', {
        type: 'qr_rotated',
        timestamp: expect.any(String),
      });
    });
  });
});
