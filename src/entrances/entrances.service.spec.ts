import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { EntrancesService } from './entrances.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EntrancesService', () => {
  let service: EntrancesService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntrancesService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();
    service = module.get<EntrancesService>(EntrancesService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should create an entrance', async () => {
    const entrance = { id: 'e-1', name: 'Front Door', isActive: true };
    prisma.entrance.create.mockResolvedValue(entrance as any);

    const result = await service.create({ name: 'Front Door' });
    expect(result).toEqual(entrance);
    expect(prisma.entrance.create).toHaveBeenCalledWith({
      data: { name: 'Front Door' },
    });
  });

  it('should return paginated entrances', async () => {
    const entrances = [{ id: 'e-1', name: 'Front Door' }];
    prisma.entrance.findMany.mockResolvedValue(entrances as any);
    prisma.entrance.count.mockResolvedValue(1);

    const result = await service.findAll(1, 20);
    expect(result).toEqual({ data: entrances, total: 1, page: 1, limit: 20 });
  });

  it('should find one entrance by id', async () => {
    const entrance = { id: 'e-1', name: 'Front Door' };
    prisma.entrance.findUnique.mockResolvedValue(entrance as any);

    const result = await service.findOne('e-1');
    expect(result).toEqual(entrance);
  });

  it('should throw NotFoundException for missing entrance', async () => {
    prisma.entrance.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('should update an entrance', async () => {
    const entrance = { id: 'e-1', name: 'Side Gate', isActive: true };
    prisma.entrance.findUnique.mockResolvedValue(entrance as any);
    prisma.entrance.update.mockResolvedValue({
      ...entrance,
      name: 'Side Gate',
    } as any);

    const result = await service.update('e-1', { name: 'Side Gate' });
    expect(result.name).toBe('Side Gate');
  });

  it('should delete an entrance', async () => {
    const entrance = { id: 'e-1', name: 'Front Door' };
    prisma.entrance.findUnique.mockResolvedValue(entrance as any);
    prisma.entrance.delete.mockResolvedValue(entrance as any);

    const result = await service.remove('e-1');
    expect(result).toEqual(entrance);
  });
});
