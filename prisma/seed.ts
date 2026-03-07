import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('password123', 10);

  // Super Admin
  const superAdmin = await prisma.user.create({
    data: { email: 'admin@gym.co.ke', password: hash, firstName: 'Super', lastName: 'Admin', role: 'SUPER_ADMIN' },
  });

  // Admins
  const admin1 = await prisma.user.create({
    data: { email: 'frontdesk1@gym.co.ke', password: hash, firstName: 'Jane', lastName: 'Wanjiku', role: 'ADMIN' },
  });
  const admin2 = await prisma.user.create({
    data: { email: 'frontdesk2@gym.co.ke', password: hash, firstName: 'John', lastName: 'Kamau', role: 'ADMIN' },
  });

  // Trainers
  const trainer1 = await prisma.user.create({
    data: { email: 'trainer1@gym.co.ke', password: hash, firstName: 'Mike', lastName: 'Ochieng', role: 'TRAINER' },
  });
  const trainer2 = await prisma.user.create({
    data: { email: 'trainer2@gym.co.ke', password: hash, firstName: 'Faith', lastName: 'Njeri', role: 'TRAINER' },
  });
  const trainer3 = await prisma.user.create({
    data: { email: 'trainer3@gym.co.ke', password: hash, firstName: 'David', lastName: 'Mwangi', role: 'TRAINER' },
  });

  // Trainer profiles
  await prisma.trainerProfile.create({
    data: { userId: trainer1.id, specialization: 'Strength Training', bio: 'Certified strength coach with 5 years experience' },
  });
  await prisma.trainerProfile.create({
    data: { userId: trainer2.id, specialization: 'Yoga & Flexibility', bio: 'Yoga instructor specializing in flexibility and recovery' },
  });
  await prisma.trainerProfile.create({
    data: { userId: trainer3.id, specialization: 'Cardio & HIIT', bio: 'High intensity training specialist' },
  });

  // Members
  const members = [];
  for (let i = 1; i <= 10; i++) {
    const member = await prisma.user.create({
      data: { email: `member${i}@example.com`, password: hash, firstName: `Member`, lastName: `${i}`, role: 'MEMBER', phone: `+2547000000${i.toString().padStart(2, '0')}` },
    });
    members.push(member);
  }

  // Subscription Plans
  const monthlyPlan = await prisma.subscriptionPlan.create({
    data: { name: 'Monthly Solo', price: 3000, currency: 'KES', durationDays: 30, description: 'Standard monthly membership for one person', maxMembers: 1 },
  });
  const duoPlan = await prisma.subscriptionPlan.create({
    data: { name: 'Monthly Duo', price: 5000, currency: 'KES', durationDays: 30, description: 'Monthly membership for two people', maxMembers: 2 },
  });
  const annualPlan = await prisma.subscriptionPlan.create({
    data: { name: 'Annual Solo', price: 30000, currency: 'KES', durationDays: 365, description: 'Annual membership with savings', maxMembers: 1 },
  });

  // Active subscriptions
  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Member 1: solo subscription
  const sub1 = await prisma.memberSubscription.create({
    data: {
      primaryMemberId: members[0].id, planId: monthlyPlan.id,
      startDate: now, endDate: thirtyDaysLater, status: 'ACTIVE', paymentStatus: 'PAID',
      members: { create: { memberId: members[0].id } },
    },
  });

  // Members 2 & 3: duo subscription
  const sub2 = await prisma.memberSubscription.create({
    data: {
      primaryMemberId: members[1].id, planId: duoPlan.id,
      startDate: now, endDate: thirtyDaysLater, status: 'ACTIVE', paymentStatus: 'PAID',
      members: { create: [{ memberId: members[1].id }, { memberId: members[2].id }] },
    },
  });

  // Some attendance records and streaks
  for (let i = 0; i < 3; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    await prisma.attendance.create({ data: { memberId: members[0].id, checkInDate: date } });
  }
  await prisma.streak.create({
    data: { memberId: members[0].id, currentStreak: 3, longestStreak: 3, lastCheckInDate: new Date(new Date().setHours(0,0,0,0)) },
  });

  // Legal document
  await prisma.legalDocument.create({
    data: { title: 'Gym Membership Waiver', content: 'I hereby acknowledge that physical exercise involves risks...', version: 1, isRequired: true },
  });

  // Active QR code
  const crypto = require('crypto');
  await prisma.gymQrCode.create({
    data: { code: crypto.randomBytes(32).toString('hex'), isActive: true },
  });

  console.log('Seed data created successfully');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
