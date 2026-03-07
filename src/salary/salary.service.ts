import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalaryRecordDto } from './dto/create-salary-record.dto';

@Injectable()
export class SalaryService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSalaryRecordDto) {
    return this.prisma.staffSalaryRecord.create({
      data: {
        staffId: dto.staffId,
        month: dto.month,
        year: dto.year,
        amount: dto.amount,
        notes: dto.notes,
      },
    });
  }

  async findAll(filters?: { month?: number; year?: number }) {
    const where: Record<string, number> = {};
    if (filters?.month) where.month = filters.month;
    if (filters?.year) where.year = filters.year;

    return this.prisma.staffSalaryRecord.findMany({
      where,
      include: {
        staff: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async findByStaff(staffId: string) {
    return this.prisma.staffSalaryRecord.findMany({
      where: { staffId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async markAsPaid(id: string) {
    return this.prisma.staffSalaryRecord.update({
      where: { id },
      data: { status: 'PAID', paidAt: new Date() },
    });
  }

  async remove(id: string) {
    return this.prisma.staffSalaryRecord.delete({ where: { id } });
  }
}
