import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SignDocumentDto } from './dto/sign-document.dto';

@Injectable()
export class LegalService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateDocumentDto) {
    return this.prisma.legalDocument.create({
      data: {
        title: dto.title,
        content: dto.content,
        isRequired: dto.isRequired ?? true,
      },
    });
  }

  async findAll(page: number = 1, limit: number = 20) {
    const [data, total] = await Promise.all([
      this.prisma.legalDocument.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.legalDocument.count(),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const doc = await this.prisma.legalDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async sign(memberId: string, dto: SignDocumentDto, ipAddress?: string) {
    const doc = await this.prisma.legalDocument.findUnique({
      where: { id: dto.documentId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const existing = await this.prisma.documentSignature.findUnique({
      where: {
        memberId_documentId: { memberId, documentId: dto.documentId },
      },
    });
    if (existing) throw new ConflictException('Document already signed');

    return this.prisma.documentSignature.create({
      data: {
        memberId,
        documentId: dto.documentId,
        signatureData: dto.signatureData,
        ipAddress,
      },
    });
  }

  async getUnsignedDocuments(memberId: string) {
    const requiredDocs = await this.prisma.legalDocument.findMany({
      where: { isRequired: true },
    });

    const signedDocs = await this.prisma.documentSignature.findMany({
      where: { memberId },
      select: { documentId: true },
    });

    const signedIds = new Set(signedDocs.map((s) => s.documentId));
    return requiredDocs.filter((doc) => !signedIds.has(doc.id));
  }

  async getSigningStatus(documentId: string) {
    return this.prisma.documentSignature.findMany({
      where: { documentId },
      include: {
        member: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }
}
