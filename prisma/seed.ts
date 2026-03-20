import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcrypt';

const dbUrl = process.env.DATABASE_URL;
const useSSL = dbUrl?.includes('sslmode=')
  || process.env.NODE_ENV === 'production';
const cleanUrl = dbUrl?.replace(/[?&]sslmode=[^&]*/g, (match) =>
  match.startsWith('?') ? '?' : '',
).replace(/\?$/, '');
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ...(useSSL && { ssl: { rejectUnauthorized: false } }),
});
const adapter = new PrismaPg(pool);
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
