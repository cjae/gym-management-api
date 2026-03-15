import { Test, TestingModule } from '@nestjs/testing';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

describe('ImportsController', () => {
  let controller: ImportsController;
  let service: DeepMockProxy<ImportsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImportsController],
      providers: [
        { provide: ImportsService, useValue: mockDeep<ImportsService>() },
      ],
    }).compile();

    controller = module.get<ImportsController>(ImportsController);
    service = module.get(ImportsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('importMembers', () => {
    it('should call service.importMembers with file and admin id', async () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        originalname: 'test.csv',
      } as Express.Multer.File;

      service.importMembers.mockResolvedValue({
        id: 'job-1',
        type: 'MEMBERS',
        status: 'PROCESSING',
        fileName: 'test.csv',
        totalRows: 1,
      } as any);

      const result = await controller.importMembers(
        mockFile,
        'admin-1',
        'admin@gym.com',
      );

      expect(service.importMembers).toHaveBeenCalledWith(
        mockFile,
        'admin-1',
        'admin@gym.com',
      );
      expect(result.status).toBe('PROCESSING');
    });
  });

  describe('findAll', () => {
    it('should call service.findAll with pagination', async () => {
      service.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      } as any);

      const result = await controller.findAll({ page: 1, limit: 20 });

      expect(service.findAll).toHaveBeenCalledWith(1, 20);
      expect(result.data).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should call service.findOne with id', async () => {
      const mockJob = {
        id: 'job-1',
        status: 'COMPLETED',
      } as any;
      service.findOne.mockResolvedValue(mockJob);

      const result = await controller.findOne('job-1');

      expect(service.findOne).toHaveBeenCalledWith('job-1');
      expect(result.status).toBe('COMPLETED');
    });
  });
});
