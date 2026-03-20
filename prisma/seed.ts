import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const hash = await bcrypt.hash('password123', 10);

  await prisma.user.create({
    data: {
      email: 'powerbarnfitnesske@gmail.com',
      password: hash,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      mustChangePassword: true,
      referralCode: 'SADMIN01',
    },
  });

  console.log(
    'Seed data created: Super Admin (powerbarnfitnesske@gmail.com / password123)',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
