import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcrypt';

const dbUrl = process.env.DATABASE_URL;
const useSSL =
  dbUrl?.includes('sslmode=') || process.env.NODE_ENV === 'production';
const cleanUrl = dbUrl
  ?.replace(/[?&]sslmode=[^&]*/g, (match) => (match.startsWith('?') ? '?' : ''))
  .replace(/\?$/, '');
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ...(useSSL && { ssl: { rejectUnauthorized: false } }),
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const hash = await bcrypt.hash('password123', 10);

  const existingSuperAdmin = await prisma.user.findFirst({
    where: {
      OR: [
        { email: 'powerbarnfitnesske@gmail.com' },
        { referralCode: 'SADMIN01' },
      ],
    },
  });
  if (!existingSuperAdmin) {
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
  }

  console.log(
    'Seed data created: Super Admin (powerbarnfitnesske@gmail.com / password123)',
  );

  // Member user for goals testing
  const existingMember = await prisma.user.findFirst({
    where: {
      OR: [{ email: 'member@example.com' }, { referralCode: 'MEMBER01' }],
    },
  });
  const member =
    existingMember ??
    (await prisma.user.create({
      data: {
        email: 'member@example.com',
        password: hash,
        firstName: 'Jane',
        lastName: 'Member',
        role: 'MEMBER',
        referralCode: 'MEMBER01',
      },
    }));

  console.log('Seed data created: Member (member@example.com / password123)');

  // Subscription plan
  const plan = await prisma.subscriptionPlan.upsert({
    where: { id: 'seed-plan-monthly-001' },
    update: {},
    create: {
      id: 'seed-plan-monthly-001',
      name: 'Monthly Standard',
      price: 3000,
      currency: 'KES',
      billingInterval: 'MONTHLY',
      maxMembers: 1,
      isActive: true,
    },
  });

  // Active subscription for the member
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 30);

  const subscription = await prisma.memberSubscription.upsert({
    where: { id: 'seed-subscription-member-001' },
    update: {},
    create: {
      id: 'seed-subscription-member-001',
      primaryMemberId: member.id,
      planId: plan.id,
      startDate: now,
      endDate,
      status: 'ACTIVE',
      paymentMethod: 'COMPLIMENTARY',
    },
  });

  // SubscriptionMember join record
  await prisma.subscriptionMember.upsert({
    where: {
      subscriptionId_memberId: {
        subscriptionId: subscription.id,
        memberId: member.id,
      },
    },
    update: {},
    create: {
      subscriptionId: subscription.id,
      memberId: member.id,
    },
  });

  // 4 weeks of attendance records (Mon–Thu each week) for goals testing
  const attendanceDates: Date[] = [];
  for (let week = 0; week < 4; week++) {
    for (let day = 0; day < 4; day++) {
      const d = new Date();
      // Go back (3 - week) full weeks, then pick Mon/Tue/Wed/Thu of that week
      d.setDate(d.getDate() - week * 7 - (day + 1));
      // Zero out time so it's just a date
      d.setHours(0, 0, 0, 0);
      attendanceDates.push(d);
    }
  }

  for (const checkInDate of attendanceDates) {
    await prisma.attendance.upsert({
      where: {
        memberId_checkInDate: {
          memberId: member.id,
          checkInDate,
        },
      },
      update: {},
      create: {
        memberId: member.id,
        checkInDate,
      },
    });
  }

  console.log(
    `Seed data created: 16 attendance records for ${member.email} across 4 weeks`,
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
