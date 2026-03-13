import { PrismaClient, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('password123', 10);

  // Super Admin
  const superAdmin = await prisma.user.create({
    data: { email: 'admin@gym.co.ke', password: hash, firstName: 'Super', lastName: 'Admin', role: 'SUPER_ADMIN', mustChangePassword: true },
  });

  // Admins
  const admin1 = await prisma.user.create({
    data: { email: 'frontdesk1@gym.co.ke', password: hash, firstName: 'Jane', lastName: 'Wanjiku', role: 'ADMIN', mustChangePassword: true },
  });
  const admin2 = await prisma.user.create({
    data: { email: 'frontdesk2@gym.co.ke', password: hash, firstName: 'John', lastName: 'Kamau', role: 'ADMIN', mustChangePassword: true },
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
  const members: User[] = [];
  for (let i = 1; i <= 10; i++) {
    const member = await prisma.user.create({
      data: { email: `member${i}@example.com`, password: hash, firstName: `Member`, lastName: `${i}`, role: 'MEMBER', phone: `+2547000000${i.toString().padStart(2, '0')}` },
    });
    members.push(member);
  }

  // Subscription Plans
  const monthlyPlan = await prisma.subscriptionPlan.create({
    data: { name: 'Monthly Solo', price: 3000, currency: 'KES', billingInterval: 'MONTHLY', description: 'Standard monthly membership for one person', maxMembers: 1 },
  });
  const duoPlan = await prisma.subscriptionPlan.create({
    data: { name: 'Monthly Duo', price: 5000, currency: 'KES', billingInterval: 'MONTHLY', description: 'Monthly membership for two people', maxMembers: 2 },
  });
  const annualPlan = await prisma.subscriptionPlan.create({
    data: { name: 'Annual Solo', price: 30000, currency: 'KES', billingInterval: 'ANNUALLY', description: 'Annual membership with savings', maxMembers: 1 },
  });

  // ── Helpers ──
  const now = new Date();
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d;
  };
  const daysFromNow = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    return d;
  };

  // ── Subscriptions (mix of active, expiring soon, expired) ──

  // Member 1: active solo, 25 days remaining
  const sub1 = await prisma.memberSubscription.create({
    data: {
      primaryMemberId: members[0].id, planId: monthlyPlan.id,
      startDate: daysAgo(5), endDate: daysFromNow(25), status: 'ACTIVE',
      paymentMethod: 'MPESA', autoRenew: true, nextBillingDate: daysFromNow(25),
      members: { create: { memberId: members[0].id } },
    },
  });

  // Members 2 & 3: active duo, 20 days remaining
  const sub2 = await prisma.memberSubscription.create({
    data: {
      primaryMemberId: members[1].id, planId: duoPlan.id,
      startDate: daysAgo(10), endDate: daysFromNow(20), status: 'ACTIVE',
      paymentMethod: 'CARD', autoRenew: true, nextBillingDate: daysFromNow(20),
      members: { create: [{ memberId: members[1].id }, { memberId: members[2].id }] },
    },
  });

  // Member 4: expiring in 3 days (shows in expiringSoon)
  const sub3 = await prisma.memberSubscription.create({
    data: {
      primaryMemberId: members[3].id, planId: monthlyPlan.id,
      startDate: daysAgo(27), endDate: daysFromNow(3), status: 'ACTIVE',
      paymentMethod: 'MPESA', autoRenew: false, nextBillingDate: daysFromNow(3),
      members: { create: { memberId: members[3].id } },
    },
  });

  // Member 5: expiring in 5 days (shows in expiringSoon)
  const sub4 = await prisma.memberSubscription.create({
    data: {
      primaryMemberId: members[4].id, planId: monthlyPlan.id,
      startDate: daysAgo(25), endDate: daysFromNow(5), status: 'ACTIVE',
      paymentMethod: 'CARD', autoRenew: true, nextBillingDate: daysFromNow(5),
      members: { create: { memberId: members[4].id } },
    },
  });

  // Member 6: expiring in 12 days (shows in expiring-memberships endpoint, 14-day window)
  const sub5 = await prisma.memberSubscription.create({
    data: {
      primaryMemberId: members[5].id, planId: duoPlan.id,
      startDate: daysAgo(18), endDate: daysFromNow(12), status: 'ACTIVE',
      paymentMethod: 'MPESA', autoRenew: false, nextBillingDate: daysFromNow(12),
      members: { create: [{ memberId: members[5].id }, { memberId: members[6].id }] },
    },
  });

  // Member 7: annual plan, active, plenty of time left
  const sub6 = await prisma.memberSubscription.create({
    data: {
      primaryMemberId: members[7].id, planId: annualPlan.id,
      startDate: daysAgo(60), endDate: daysFromNow(305), status: 'ACTIVE',
      paymentMethod: 'CARD', autoRenew: true, nextBillingDate: daysFromNow(305),
      members: { create: { memberId: members[7].id } },
    },
  });

  // Member 8: expired subscription (expired 5 days ago)
  const sub7 = await prisma.memberSubscription.create({
    data: {
      primaryMemberId: members[8].id, planId: monthlyPlan.id,
      startDate: daysAgo(35), endDate: daysAgo(5), status: 'EXPIRED',
      paymentMethod: 'MPESA', autoRenew: false, nextBillingDate: daysAgo(5),
      members: { create: { memberId: members[8].id } },
    },
  });

  // Member 9: cancelled subscription
  const sub8 = await prisma.memberSubscription.create({
    data: {
      primaryMemberId: members[9].id, planId: monthlyPlan.id,
      startDate: daysAgo(20), endDate: daysFromNow(10), status: 'CANCELLED',
      paymentMethod: 'CARD', autoRenew: false, nextBillingDate: daysFromNow(10),
      members: { create: { memberId: members[9].id } },
    },
  });

  // Set member 8 & 9 as INACTIVE (expired/cancelled)
  await prisma.user.updateMany({
    where: { id: { in: [members[8].id, members[9].id] } },
    data: { status: 'INACTIVE' },
  });

  // ── Payments (revenue data spanning 2 months) ──
  const paymentSeeds = [
    // This month — paid
    { subId: sub1.id, amount: 3000, status: 'PAID', method: 'MPESA', daysAgo: 5 },
    { subId: sub2.id, amount: 5000, status: 'PAID', method: 'CARD', daysAgo: 10 },
    { subId: sub3.id, amount: 3000, status: 'PAID', method: 'MPESA', daysAgo: 2 },
    { subId: sub4.id, amount: 3000, status: 'PAID', method: 'CARD', daysAgo: 8 },
    { subId: sub5.id, amount: 5000, status: 'PAID', method: 'MPESA', daysAgo: 12 },
    { subId: sub6.id, amount: 30000, status: 'PAID', method: 'CARD', daysAgo: 15 },
    // This month — failed / pending
    { subId: sub7.id, amount: 3000, status: 'FAILED', method: 'MPESA', daysAgo: 7 },
    { subId: sub8.id, amount: 3000, status: 'PENDING', method: 'CARD', daysAgo: 4 },
    { subId: sub1.id, amount: 3000, status: 'FAILED', method: 'MPESA', daysAgo: 1 },
    // Last month — paid
    { subId: sub1.id, amount: 3000, status: 'PAID', method: 'MPESA', daysAgo: 35 },
    { subId: sub2.id, amount: 5000, status: 'PAID', method: 'CARD', daysAgo: 40 },
    { subId: sub3.id, amount: 3000, status: 'PAID', method: 'MPESA', daysAgo: 32 },
    { subId: sub4.id, amount: 3000, status: 'PAID', method: 'CARD', daysAgo: 38 },
    { subId: sub6.id, amount: 30000, status: 'PAID', method: 'CARD', daysAgo: 45 },
    // Last month — failed
    { subId: sub5.id, amount: 5000, status: 'FAILED', method: 'MPESA', daysAgo: 33 },
  ];

  for (const p of paymentSeeds) {
    await prisma.payment.create({
      data: {
        subscriptionId: p.subId,
        amount: p.amount,
        currency: 'KES',
        status: p.status as 'PAID' | 'FAILED' | 'PENDING',
        paymentMethod: p.method as 'CARD' | 'MPESA',
        paystackReference: `seed_${crypto.randomBytes(12).toString('hex')}`,
        createdAt: daysAgo(p.daysAgo),
      },
    });
  }

  // ── Salary records (for financials section) ──
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  const staffUsers = [trainer1, trainer2, trainer3, admin1, admin2];
  const salaryAmounts = [40000, 35000, 38000, 50000, 45000];

  for (let i = 0; i < staffUsers.length; i++) {
    // This month: first 3 paid, last 2 pending
    await prisma.staffSalaryRecord.create({
      data: {
        staffId: staffUsers[i].id,
        month: currentMonth,
        year: currentYear,
        amount: salaryAmounts[i],
        status: i < 3 ? 'PAID' : 'PENDING',
        paidAt: i < 3 ? daysAgo(3) : null,
      },
    });
    // Last month: all paid
    await prisma.staffSalaryRecord.create({
      data: {
        staffId: staffUsers[i].id,
        month: lastMonth,
        year: lastMonthYear,
        amount: salaryAmounts[i],
        status: 'PAID',
        paidAt: daysAgo(33),
      },
    });
  }

  // ── Attendance records (last 30 days, multiple members) ──
  const attendanceMembers = [members[0], members[1], members[2], members[3], members[4], members[5], members[7]];
  const checkInHours = [6, 7, 8, 9, 10, 16, 17, 18, 19]; // realistic gym hours

  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    const date = new Date(now);
    date.setDate(date.getDate() - dayOffset);
    date.setHours(0, 0, 0, 0);

    // Skip some days randomly for realism (weekends have fewer check-ins)
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    for (const member of attendanceMembers) {
      // Each member has ~70% chance of showing up on weekdays, ~40% on weekends
      const showUpChance = isWeekend ? 0.4 : 0.7;
      // Use deterministic "randomness" based on member index + day offset
      const memberIndex = attendanceMembers.indexOf(member);
      const pseudoRandom = ((memberIndex * 7 + dayOffset * 13) % 100) / 100;

      if (pseudoRandom < showUpChance) {
        const checkInTime = new Date(date);
        checkInTime.setHours(checkInHours[(memberIndex + dayOffset) % checkInHours.length], (dayOffset * 7) % 60, 0, 0);

        await prisma.attendance.create({
          data: {
            memberId: member.id,
            checkInDate: date,
            checkInTime: checkInTime,
          },
        });
      }
    }
  }

  // Streaks for active members (weekly consistency model)
  const monday = new Date();
  const day = monday.getDay();
  const diff = day === 0 ? 6 : day - 1;
  monday.setDate(monday.getDate() - diff);
  monday.setHours(0, 0, 0, 0);

  await prisma.streak.create({
    data: { memberId: members[0].id, weeklyStreak: 12, longestStreak: 18, daysThisWeek: 3, weekStart: monday, lastCheckInDate: new Date(new Date().setHours(0,0,0,0)) },
  });
  await prisma.streak.create({
    data: { memberId: members[1].id, weeklyStreak: 5, longestStreak: 10, daysThisWeek: 2, weekStart: monday, lastCheckInDate: new Date(new Date().setHours(0,0,0,0)) },
  });
  await prisma.streak.create({
    data: { memberId: members[3].id, weeklyStreak: 8, longestStreak: 15, daysThisWeek: 4, weekStart: monday, lastCheckInDate: new Date(new Date().setHours(0,0,0,0)) },
  });

  // Active QR code
  await prisma.gymQrCode.create({
    data: { code: crypto.randomBytes(32).toString('hex'), isActive: true },
  });

  console.log('Seed data created successfully');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
