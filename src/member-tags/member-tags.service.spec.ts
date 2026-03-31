import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, TagSource } from '@prisma/client';
import { MemberTagsService } from './member-tags.service';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';

describe('MemberTagsService', () => {
  let service: MemberTagsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let gymSettingsService: { getCachedSettings: jest.Mock };

  beforeEach(async () => {
    gymSettingsService = { getCachedSettings: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberTagsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: GymSettingsService, useValue: gymSettingsService },
      ],
    }).compile();

    service = module.get<MemberTagsService>(MemberTagsService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all tags', async () => {
      const tags = [{ id: 't1', name: 'VIP', source: TagSource.MANUAL }];
      prisma.tag.findMany.mockResolvedValueOnce(tags as any);

      const result = await service.findAll();
      expect(result).toEqual(tags);
    });

    it('should filter by source', async () => {
      prisma.tag.findMany.mockResolvedValueOnce([]);

      await service.findAll(TagSource.SYSTEM);
      expect(prisma.tag.findMany).toHaveBeenCalledWith({
        where: { source: TagSource.SYSTEM },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('create', () => {
    it('should create a manual tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce(null);
      prisma.tag.create.mockResolvedValueOnce({
        id: 't1',
        name: 'VIP',
        source: TagSource.MANUAL,
      } as any);

      const result = await service.create({ name: 'VIP' });
      expect(result.name).toBe('VIP');
      expect(prisma.tag.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'VIP',
          source: TagSource.MANUAL,
        }),
      });
    });

    it('should reject duplicate tag name', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        name: 'VIP',
      } as any);

      await expect(service.create({ name: 'VIP' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('should update a manual tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        name: 'VIP',
        source: TagSource.MANUAL,
      } as any);
      prisma.tag.update.mockResolvedValueOnce({
        id: 't1',
        name: 'VIP Updated',
        source: TagSource.MANUAL,
      } as any);

      const result = await service.update('t1', { name: 'VIP Updated' });
      expect(result.name).toBe('VIP Updated');
    });

    it('should reject updating a SYSTEM tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        name: 'at-risk',
        source: TagSource.SYSTEM,
      } as any);

      await expect(service.update('t1', { name: 'renamed' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException for missing tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.update('nonexistent', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should delete a manual tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        source: TagSource.MANUAL,
      } as any);
      prisma.tag.delete.mockResolvedValueOnce({ id: 't1' } as any);

      await service.delete('t1');
      expect(prisma.tag.delete).toHaveBeenCalledWith({
        where: { id: 't1' },
      });
    });

    it('should reject deleting a SYSTEM tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        source: TagSource.SYSTEM,
      } as any);

      await expect(service.delete('t1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('assignTag', () => {
    it('should assign a manual tag to members', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        source: TagSource.MANUAL,
      } as any);
      prisma.memberTag.createMany.mockResolvedValueOnce({ count: 2 });

      const result = await service.assignTag('t1', ['m1', 'm2'], 'admin-1');
      expect(result.count).toBe(2);
    });

    it('should reject assigning a SYSTEM tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        source: TagSource.SYSTEM,
      } as any);

      await expect(service.assignTag('t1', ['m1'], 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('removeTag', () => {
    it('should remove a manual tag from a member', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        source: TagSource.MANUAL,
      } as any);
      prisma.memberTag.deleteMany.mockResolvedValueOnce({ count: 1 });

      await service.removeTag('t1', 'm1');
      expect(prisma.memberTag.deleteMany).toHaveBeenCalledWith({
        where: { tagId: 't1', memberId: 'm1' },
      });
    });
  });

  describe('getSummary', () => {
    it('should return tag counts', async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        {
          id: 't1',
          name: 'at-risk',
          source: TagSource.SYSTEM,
          color: '#F44336',
          description: 'At risk',
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { members: 5 },
        },
        {
          id: 't2',
          name: 'VIP',
          source: TagSource.MANUAL,
          color: null,
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { members: 3 },
        },
      ] as any);

      const result = await service.getSummary();
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('memberCount', 5);
    });
  });
});
