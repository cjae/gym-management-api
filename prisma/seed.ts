import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcrypt';

const dbUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';
const useSSL = dbUrl?.includes('sslmode=') || isProduction;
const cleanUrl = dbUrl
  ?.replace(/[?&]sslmode=[^&]*/g, (match) => (match.startsWith('?') ? '?' : ''))
  .replace(/\?$/, '');
// Enforce TLS cert validation in production; allow self-signed elsewhere.
const sslOption = useSSL ? { ssl: { rejectUnauthorized: isProduction } } : {};
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ...sslOption,
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

  // Member user for goals testing.
  // Upsert keyed on email so re-seeds heal old rows missing personalization fields.
  const member = await prisma.user.upsert({
    where: { email: 'member@example.com' },
    create: {
      email: 'member@example.com',
      password: hash,
      firstName: 'Jane',
      lastName: 'Member',
      role: 'MEMBER',
      referralCode: 'MEMBER01',
      // Personalization profile (for goals feature)
      experienceLevel: 'INTERMEDIATE',
      bodyweightKg: 70.5,
      heightCm: 175,
      sessionMinutes: 60,
      preferredTrainingDays: ['MON', 'TUE', 'WED', 'THU'],
      sleepHoursAvg: 7.5,
      primaryMotivation: 'STRENGTH',
      injuryNotes: null,
      onboardingCompletedAt: new Date(),
    },
    update: {
      // Heal personalization fields on re-seed. Do NOT overwrite password,
      // firstName, lastName, referralCode, or injuryNotes — a developer may
      // have intentionally changed those locally.
      experienceLevel: 'INTERMEDIATE',
      bodyweightKg: 70.5,
      heightCm: 175,
      sessionMinutes: 60,
      preferredTrainingDays: ['MON', 'TUE', 'WED', 'THU'],
      sleepHoursAvg: 7.5,
      primaryMotivation: 'STRENGTH',
      onboardingCompletedAt: new Date(),
    },
  });

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
      d.setUTCDate(d.getUTCDate() - week * 7 - (day + 1));
      d.setUTCHours(0, 0, 0, 0);
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
