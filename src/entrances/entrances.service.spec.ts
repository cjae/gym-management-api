import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EntrancesService } from './entrances.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EntrancesService', () => {
  let service: EntrancesService;

  const mockPrisma = {
    entrance: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntrancesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<EntrancesService>(EntrancesService);
    jest.clearAllMocks();
  });

  it('should create an entrance', async () => {
    const entrance = { id: 'e-1', name: 'Front Door', isActive: true };
    mockPrisma.entrance.create.mockResolvedValue(entrance);

    const result = await service.create({ name: 'Front Door' });
    expect(result).toEqual(entrance);
    expect(mockPrisma.entrance.create).toHaveBeenCalledWith({
      data: { name: 'Front Door' },
    });
  });

  it('should return paginated entrances', async () => {
    const entrances = [{ id: 'e-1', name: 'Front Door' }];
    mockPrisma.entrance.findMany.mockResolvedValue(entrances);
    mockPrisma.entrance.count.mockResolvedValue(1);

    const result = await service.findAll(1, 20);
    expect(result).toEqual({ data: entrances, total: 1, page: 1, limit: 20 });
  });

  it('should find one entrance by id', async () => {
    const entrance = { id: 'e-1', name: 'Front Door' };
    mockPrisma.entrance.findUnique.mockResolvedValue(entrance);

    const result = await service.findOne('e-1');
    expect(result).toEqual(entrance);
  });

  it('should throw NotFoundException for missing entrance', async () => {
    mockPrisma.entrance.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('should update an entrance', async () => {
    const entrance = { id: 'e-1', name: 'Side Gate', isActive: true };
    mockPrisma.entrance.findUnique.mockResolvedValue(entrance);
    mockPrisma.entrance.update.mockResolvedValue({
      ...entrance,
      name: 'Side Gate',
    });

    const result = await service.update('e-1', { name: 'Side Gate' });
    expect(result.name).toBe('Side Gate');
  });

  it('should delete an entrance', async () => {
    const entrance = { id: 'e-1', name: 'Front Door' };
    mockPrisma.entrance.findUnique.mockResolvedValue(entrance);
    mockPrisma.entrance.delete.mockResolvedValue(entrance);

    const result = await service.remove('e-1');
    expect(result).toEqual(entrance);
  });
});
