export const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  status: true,
  gender: true,
  displayPicture: true,
  birthday: true,
  experienceLevel: true,
  bodyweightKg: true,
  heightCm: true,
  sessionMinutes: true,
  preferredTrainingDays: true,
  sleepHoursAvg: true,
  primaryMotivation: true,
  injuryNotes: true,
  onboardingCompletedAt: true,
  mustChangePassword: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
};

import { SubscriptionStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

export const safeUserWithSubscriptionSelect =
  Prisma.validator<Prisma.UserSelect>()({
    ...safeUserSelect,
    attendances: {
      orderBy: { checkInDate: 'desc' as const },
      take: 1,
      select: { checkInDate: true },
    },
    subscriptionMembers: {
      where: {
        subscription: {
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.FROZEN],
          },
        },
      },
      take: 1,
      select: {
        subscription: {
          select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true,
            freezeStartDate: true,
            freezeEndDate: true,
            plan: {
              select: {
                id: true,
                name: true,
                price: true,
                currency: true,
                billingInterval: true,
              },
            },
          },
        },
      },
    },
    memberTags: {
      select: {
        tag: {
          select: {
            name: true,
            source: true,
            color: true,
          },
        },
      },
    },
  });
