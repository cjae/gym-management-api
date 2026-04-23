import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { TrainersController } from './trainers.controller';
import { TrainersService } from './trainers.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

/**
 * These tests lock in the role-based access matrix on the trainers
 * controller (security finding M7). They exercise the RolesGuard
 * against the metadata attached to each handler, simulating what
 * Nest does at request time.
 */
describe('TrainersController', () => {
  let controller: TrainersController;
  let rolesGuard: RolesGuard;

  const mockService = {
    createProfile: jest.fn(),
    findAll: jest.fn(),
    updateProfile: jest.fn(),
    findOne: jest.fn(),
    findByUserId: jest.fn(),
    assignMember: jest.fn(),
    getMemberTrainer: jest.fn(),
  };

  const buildContext = (
    handlerName: keyof TrainersController,
    role: string,
  ): ExecutionContext => {
    const handler = (controller as any)[handlerName] as (...args: any[]) => any;
    return {
      getHandler: () => handler,
      getClass: () => TrainersController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'user-1', role } }),
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrainersController],
      providers: [
        { provide: TrainersService, useValue: mockService },
        RolesGuard,
        Reflector,
      ],
    }).compile();

    controller = module.get<TrainersController>(TrainersController);
    rolesGuard = module.get<RolesGuard>(RolesGuard);
    jest.clearAllMocks();
  });

  describe('role-based access control', () => {
    describe.each(['findAll', 'findOne', 'findByUserId'] as const)(
      'GET handler %s',
      (handlerName) => {
        it('has roles metadata restricting to ADMIN, SUPER_ADMIN, TRAINER', () => {
          const reflector = new Reflector();
          const roles = reflector.get<string[]>(
            ROLES_KEY,
            (controller as any)[handlerName],
          );
          expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN', 'TRAINER']);
        });

        it.each(['ADMIN', 'SUPER_ADMIN', 'TRAINER'])(
          'allows %s through RolesGuard',
          (role) => {
            const ctx = buildContext(handlerName, role);
            expect(rolesGuard.canActivate(ctx)).toBe(true);
          },
        );

        it('blocks MEMBER through RolesGuard', () => {
          const ctx = buildContext(handlerName, 'MEMBER');
          expect(rolesGuard.canActivate(ctx)).toBe(false);
        });
      },
    );

    describe('GET /trainers/my/trainer (getMyTrainer)', () => {
      it('is restricted to MEMBER role', () => {
        const reflector = new Reflector();
        const roles = reflector.get<string[]>(
          ROLES_KEY,
          controller.getMyTrainer,
        );
        expect(roles).toEqual(['MEMBER']);
      });

      it('allows MEMBER through RolesGuard', () => {
        const ctx = buildContext('getMyTrainer', 'MEMBER');
        expect(rolesGuard.canActivate(ctx)).toBe(true);
      });

      it('delegates to TrainersService.getMemberTrainer with the caller id', async () => {
        const payload = {
          id: 'assign-1',
          trainerId: 'profile-1',
          memberId: 'member-1',
          startDate: new Date(),
          endDate: null,
          notes: null,
          trainer: {
            id: 'profile-1',
            userId: 'trainer-user-1',
            specialization: 'Strength',
            bio: 'Coach',
            availability: null,
            user: {
              id: 'trainer-user-1',
              firstName: 'Mike',
              lastName: 'O',
              displayPicture: null,
            },
            classes: [],
          },
        };
        mockService.getMemberTrainer.mockResolvedValue(payload);

        const result = await controller.getMyTrainer('member-1');

        expect(mockService.getMemberTrainer).toHaveBeenCalledWith('member-1');
        expect(result).toEqual(payload);

        // Sensitive trainer user fields must not leak to the member.
        const trainerUser: Record<string, unknown> = result!.trainer.user;
        expect(trainerUser).not.toHaveProperty('email');
        expect(trainerUser).not.toHaveProperty('phone');
        expect(trainerUser).not.toHaveProperty('role');
        expect(trainerUser).not.toHaveProperty('status');
      });
    });

    describe.each(['createProfile', 'updateProfile', 'assignMember'] as const)(
      'mutating handler %s',
      (handlerName) => {
        it('has roles metadata restricting to ADMIN, SUPER_ADMIN', () => {
          const reflector = new Reflector();
          const roles = reflector.get<string[]>(
            ROLES_KEY,
            (controller as any)[handlerName],
          );
          expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN']);
        });

        it('blocks TRAINER through RolesGuard', () => {
          const ctx = buildContext(handlerName, 'TRAINER');
          expect(rolesGuard.canActivate(ctx)).toBe(false);
        });

        it('blocks MEMBER through RolesGuard', () => {
          const ctx = buildContext(handlerName, 'MEMBER');
          expect(rolesGuard.canActivate(ctx)).toBe(false);
        });
      },
    );
  });
});
