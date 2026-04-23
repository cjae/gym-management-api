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
  mustChangePassword: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
};

// Personalization fields are health data — only include where the context
// warrants full member profile access (self-view, individual admin profile).
// Never spread into broad list selects.
export const safeUserPersonalizationSelect = {
  experienceLevel: true,
  bodyweightKg: true,
  heightCm: true,
  sessionMinutes: true,
  preferredTrainingDays: true,
  sleepHoursAvg: true,
  primaryMotivation: true,
  injuryNotes: true,
  onboardingCompletedAt: true,
};

export const safeUserWithPersonalizationSelect = {
  ...safeUserSelect,
  ...safeUserPersonalizationSelect,
};

import { SubscriptionStatus, Prisma } from '@prisma/client';

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

// For admin single-user detail view: includes subscription context AND
// personalization/health fields. Not used for list endpoints.
export const safeUserDetailSelect = Prisma.validator<Prisma.UserSelect>()({
  ...safeUserWithSubscriptionSelect,
  ...safeUserPersonalizationSelect,
});
