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
        subscription: { status: SubscriptionStatus.ACTIVE },
      },
      take: 1,
      select: {
        subscription: {
          select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true,
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
