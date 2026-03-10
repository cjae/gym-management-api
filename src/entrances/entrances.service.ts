import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEntranceDto } from './dto/create-entrance.dto';
import { UpdateEntranceDto } from './dto/update-entrance.dto';

@Injectable()
export class EntrancesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateEntranceDto) {
    return this.prisma.entrance.create({ data: dto });
  }

  async findAll(page: number = 1, limit: number = 20) {
    const [data, total] = await Promise.all([
      this.prisma.entrance.findMany({
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.entrance.count(),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const entrance = await this.prisma.entrance.findUnique({ where: { id } });
    if (!entrance) {
      throw new NotFoundException(`Entrance with id ${id} not found`);
    }
    return entrance;
  }

  async update(id: string, dto: UpdateEntranceDto) {
    await this.findOne(id);
    return this.prisma.entrance.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.entrance.delete({ where: { id } });
  }
}
