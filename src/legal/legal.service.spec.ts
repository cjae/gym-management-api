import { Test, TestingModule } from '@nestjs/testing';
import { LegalService } from './legal.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('LegalService', () => {
  let service: LegalService;
  let prisma: PrismaService;

  const mockDocument = {
    id: 'doc-1',
    title: 'Waiver',
    content: 'Content here',
    version: 1,
    isRequired: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSignature = {
    id: 'sig-1',
    memberId: 'member-1',
    documentId: 'doc-1',
    signatureData: 'base64data',
    signedAt: new Date(),
    ipAddress: '127.0.0.1',
  };

  const mockPrisma = {
    legalDocument: {
      create: jest.fn().mockResolvedValue(mockDocument),
      findMany: jest.fn().mockResolvedValue([mockDocument]),
      findUnique: jest.fn().mockResolvedValue(mockDocument),
    },
    documentSignature: {
      create: jest.fn().mockResolvedValue(mockSignature),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegalService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LegalService>(LegalService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
    // Reset default mocks
    mockPrisma.legalDocument.findUnique.mockResolvedValue(mockDocument);
    mockPrisma.documentSignature.findUnique.mockResolvedValue(null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a legal document', async () => {
      const result = await service.create({
        title: 'Waiver',
        content: 'Content here',
      });
      expect(result).toEqual(mockDocument);
    });
  });

  describe('findAll', () => {
    it('should return all documents', async () => {
      const result = await service.findAll();
      expect(result).toEqual([mockDocument]);
    });
  });

  describe('findOne', () => {
    it('should return a document by id', async () => {
      const result = await service.findOne('doc-1');
      expect(result).toEqual(mockDocument);
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.legalDocument.findUnique.mockResolvedValueOnce(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('sign', () => {
    it('should sign a document', async () => {
      const result = await service.sign(
        'member-1',
        { documentId: 'doc-1', signatureData: 'base64data' },
        '127.0.0.1',
      );
      expect(result).toEqual(mockSignature);
    });

    it('should throw NotFoundException if document not found', async () => {
      mockPrisma.legalDocument.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.sign('member-1', {
          documentId: 'nonexistent',
          signatureData: 'data',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if already signed', async () => {
      mockPrisma.documentSignature.findUnique.mockResolvedValueOnce(
        mockSignature,
      );
      await expect(
        service.sign('member-1', {
          documentId: 'doc-1',
          signatureData: 'data',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getUnsignedDocuments', () => {
    it('should return documents not yet signed', async () => {
      mockPrisma.legalDocument.findMany.mockResolvedValueOnce([mockDocument]);
      mockPrisma.documentSignature.findMany.mockResolvedValueOnce([]);
      const result = await service.getUnsignedDocuments('member-1');
      expect(result).toEqual([mockDocument]);
    });
  });

  describe('getSigningStatus', () => {
    it('should return signatures for a document', async () => {
      mockPrisma.documentSignature.findMany.mockResolvedValueOnce([
        mockSignature,
      ]);
      const result = await service.getSigningStatus('doc-1');
      expect(result).toEqual([mockSignature]);
    });
  });
});
