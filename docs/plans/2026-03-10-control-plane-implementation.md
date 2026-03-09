# Control Plane Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a centralized control plane service that manages gym licenses, tiers, and enables remote disable of non-paying gyms.

**Architecture:** NestJS API (`api/`) serving the phone-home endpoint and admin CRUD. Next.js dashboard (`dashboard/`) for managing gyms and tiers. Single repo, two packages.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Passport JWT, Next.js 15 (App Router), Tailwind CSS, SWR

---

### Task 1: Scaffold the Project

**Files:**
- Create: `~/Documents/js/gym-control-plane/`

**Step 1: Create repo and API scaffold**

```bash
mkdir -p ~/Documents/js/gym-control-plane
cd ~/Documents/js/gym-control-plane
git init

# Scaffold NestJS API
npx @nestjs/cli new api --package-manager yarn --skip-git
```

**Step 2: Create .gitignore**

Create `~/Documents/js/gym-control-plane/.gitignore`:

```
node_modules
dist
.env
.env.*
!.env.example
.DS_Store
coverage
.worktrees
```

**Step 3: Clean up NestJS defaults**

Remove default test files that won't be needed:
```bash
cd ~/Documents/js/gym-control-plane/api
rm -f test/app.e2e-spec.ts test/jest-e2e.json
rmdir test 2>/dev/null || true
```

**Step 4: Install API dependencies**

```bash
cd ~/Documents/js/gym-control-plane/api
yarn add @nestjs/config @nestjs/passport @nestjs/jwt @nestjs/swagger @nestjs/throttler passport passport-jwt bcrypt class-validator class-transformer helmet
yarn add -D @types/passport-jwt @types/bcrypt prisma
```

**Step 5: Initialize Prisma**

```bash
cd ~/Documents/js/gym-control-plane/api
npx prisma init
```

**Step 6: Create .env.example**

Create `~/Documents/js/gym-control-plane/api/.env.example`:

```
DATABASE_URL="postgresql://user:password@localhost:5432/gym_control_plane"
JWT_SECRET="change-me"
PORT=3002
DASHBOARD_URL="http://localhost:3000"
```

**Step 7: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add -A
git commit -m "chore: scaffold NestJS API with dependencies"
```

---

### Task 2: Database Schema

**Files:**
- Modify: `api/prisma/schema.prisma`

**Step 1: Write the schema**

Replace the contents of `api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum GymStatus {
  ACTIVE
  SUSPENDED
  EXPIRED
}

model Tier {
  id          String   @id @default(uuid())
  name        String   @unique
  maxMembers  Int
  priceKes    Float
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  gyms Gym[]
}

model Gym {
  id           String    @id @default(uuid())
  name         String
  licenseKey   String    @unique @default(uuid())
  status       GymStatus @default(ACTIVE)
  tierId       String
  ownerName    String
  ownerEmail   String
  ownerPhone   String?
  expiresAt    DateTime?
  notes        String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  tier         Tier          @relation(fields: [tierId], references: [id])
  healthChecks HealthCheck[]
}

model HealthCheck {
  id          String   @id @default(uuid())
  gymId       String
  memberCount Int
  appVersion  String?
  ipAddress   String?
  checkedAt   DateTime @default(now())

  gym Gym @relation(fields: [gymId], references: [id])
}

model AdminUser {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Step 2: Create .env with your local DATABASE_URL**

Create `api/.env` with your local PostgreSQL connection string pointing to a `gym_control_plane` database.

**Step 3: Run migration**

```bash
cd ~/Documents/js/gym-control-plane/api
npx prisma migrate dev --name init
```

Expected: Migration created and applied.

**Step 4: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add api/prisma/
git commit -m "feat: add database schema with Gym, Tier, HealthCheck, AdminUser"
```

---

### Task 3: PrismaModule + Config Setup

**Files:**
- Create: `api/src/prisma/prisma.module.ts`
- Create: `api/src/prisma/prisma.service.ts`
- Create: `api/src/common/config/app.config.ts`
- Create: `api/src/common/config/auth.config.ts`
- Modify: `api/src/app.module.ts`

**Step 1: Create PrismaService**

Create `api/src/prisma/prisma.service.ts`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

**Step 2: Create PrismaModule**

Create `api/src/prisma/prisma.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

**Step 3: Create app config**

Create `api/src/common/config/app.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';

export type AppConfig = {
  port: number;
  dashboardUrl: string;
};

export const getAppConfigName = () => 'app';

export default registerAs(getAppConfigName(), (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3002', 10),
  dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:3000',
}));
```

**Step 4: Create auth config**

Create `api/src/common/config/auth.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';

export type AuthConfig = {
  jwtSecret: string;
};

export const getAuthConfigName = () => 'auth';

export default registerAs(getAuthConfigName(), (): AuthConfig => ({
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
}));
```

**Step 5: Update AppModule**

Replace `api/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import appConfig from './common/config/app.config';
import authConfig from './common/config/auth.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfig, authConfig],
      isGlobal: true,
      cache: true,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 60 }],
    }),
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    AppService,
  ],
})
export class AppModule {}
```

**Step 6: Update main.ts**

Replace `api/src/main.ts`:

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, getAppConfigName } from './common/config/app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>(getAppConfigName())!;

  app.use(helmet());
  app.enableCors({ origin: [appConfig.dashboardUrl], credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const config = new DocumentBuilder()
    .setTitle('Gym Control Plane API')
    .setDescription('License management and gym administration')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(appConfig.port);
}
void bootstrap();
```

**Step 7: Verify build**

```bash
cd ~/Documents/js/gym-control-plane/api
yarn build
```

Expected: Build succeeds.

**Step 8: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add api/src/
git commit -m "feat: add PrismaModule, config factories, main.ts setup"
```

---

### Task 4: Auth Module (Admin JWT)

**Files:**
- Create: `api/src/auth/auth.module.ts`
- Create: `api/src/auth/auth.service.ts`
- Create: `api/src/auth/auth.controller.ts`
- Create: `api/src/auth/auth.service.spec.ts`
- Create: `api/src/auth/strategies/jwt.strategy.ts`
- Create: `api/src/auth/guards/jwt-auth.guard.ts`
- Create: `api/src/auth/dto/login.dto.ts`

**Step 1: Create Login DTO**

Create `api/src/auth/dto/login.dto.ts`:

```typescript
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;
}
```

**Step 2: Create JWT Strategy**

Create `api/src/auth/strategies/jwt.strategy.ts`:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthConfig, getAuthConfigName } from '../../common/config/auth.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    const authConfig = configService.get<AuthConfig>(getAuthConfigName())!;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: authConfig.jwtSecret,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
    });
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, name: user.name };
  }
}
```

**Step 3: Create JwtAuthGuard**

Create `api/src/auth/guards/jwt-auth.guard.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

**Step 4: Write failing AuthService tests**

Create `api/src/auth/auth.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  const mockPrisma = {
    adminUser: {
      findUnique: jest.fn(),
    },
  };
  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should return access token on valid credentials', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      mockPrisma.adminUser.findUnique.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@test.com',
        password: hashedPassword,
        name: 'Admin',
      });

      const result = await service.login({
        email: 'admin@test.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('accessToken');
      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'admin-1', email: 'admin@test.com' }),
      );
    });

    it('should throw UnauthorizedException on invalid email', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'bad@test.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException on wrong password', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      mockPrisma.adminUser.findUnique.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@test.com',
        password: hashedPassword,
        name: 'Admin',
      });

      await expect(
        service.login({ email: 'admin@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
```

**Step 5: Run tests to verify they fail**

```bash
cd ~/Documents/js/gym-control-plane/api
yarn test --testPathPatterns=auth.service
```

Expected: FAIL — `Cannot find module './auth.service'`

**Step 6: Create AuthService**

Create `api/src/auth/auth.service.ts`:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.adminUser.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return { accessToken };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
```

**Step 7: Run tests to verify they pass**

```bash
cd ~/Documents/js/gym-control-plane/api
yarn test --testPathPatterns=auth.service
```

Expected: All 3 tests PASS.

**Step 8: Create AuthController**

Create `api/src/auth/auth.controller.ts`:

```typescript
import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async getProfile(@Request() req: { user: { id: string } }) {
    return this.authService.getProfile(req.user.id);
  }
}
```

**Step 9: Create AuthModule**

Create `api/src/auth/auth.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthConfig, getAuthConfigName } from '../common/config/auth.config';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const authConfig = configService.get<AuthConfig>(getAuthConfigName())!;
        return {
          secret: authConfig.jwtSecret,
          signOptions: { expiresIn: '24h', algorithm: 'HS256' },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
```

**Step 10: Register AuthModule in AppModule**

Add to `api/src/app.module.ts` imports:

```typescript
import { AuthModule } from './auth/auth.module';
```

Add `AuthModule` to the `imports` array after `PrismaModule`.

**Step 11: Build and verify**

```bash
cd ~/Documents/js/gym-control-plane/api
yarn build
```

Expected: Build succeeds.

**Step 12: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add api/src/auth/ api/src/app.module.ts
git commit -m "feat: add admin auth module with JWT login"
```

---

### Task 5: Tiers Module

**Files:**
- Create: `api/src/tiers/tiers.module.ts`
- Create: `api/src/tiers/tiers.service.ts`
- Create: `api/src/tiers/tiers.controller.ts`
- Create: `api/src/tiers/tiers.service.spec.ts`
- Create: `api/src/tiers/dto/create-tier.dto.ts`
- Create: `api/src/tiers/dto/update-tier.dto.ts`

**Step 1: Create DTOs**

Create `api/src/tiers/dto/create-tier.dto.ts`:

```typescript
import { IsString, IsInt, IsNumber, IsOptional, MaxLength, Min } from 'class-validator';

export class CreateTierDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsInt()
  @Min(1)
  maxMembers: number;

  @IsNumber()
  @Min(0)
  priceKes: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
```

Create `api/src/tiers/dto/update-tier.dto.ts`:

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateTierDto } from './create-tier.dto';

export class UpdateTierDto extends PartialType(CreateTierDto) {}
```

**Step 2: Write failing tests**

Create `api/src/tiers/tiers.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { TiersService } from './tiers.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TiersService', () => {
  let service: TiersService;
  const mockPrisma = {
    tier: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TiersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TiersService>(TiersService);
    jest.clearAllMocks();
  });

  it('should list all tiers ordered by maxMembers', async () => {
    const tiers = [{ id: '1', name: 'Starter', maxMembers: 50 }];
    mockPrisma.tier.findMany.mockResolvedValue(tiers);

    const result = await service.findAll();
    expect(result).toEqual(tiers);
    expect(mockPrisma.tier.findMany).toHaveBeenCalledWith({
      orderBy: { maxMembers: 'asc' },
    });
  });

  it('should create a tier', async () => {
    const dto = { name: 'Growth', maxMembers: 200, priceKes: 5000 };
    mockPrisma.tier.create.mockResolvedValue({ id: '2', ...dto });

    const result = await service.create(dto);
    expect(result.name).toBe('Growth');
  });

  it('should update a tier', async () => {
    mockPrisma.tier.update.mockResolvedValue({ id: '1', name: 'Updated' });

    const result = await service.update('1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });
});
```

**Step 3: Run tests to verify fail, then implement**

Create `api/src/tiers/tiers.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTierDto } from './dto/create-tier.dto';
import { UpdateTierDto } from './dto/update-tier.dto';

@Injectable()
export class TiersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.tier.findMany({
      orderBy: { maxMembers: 'asc' },
    });
  }

  async create(dto: CreateTierDto) {
    return this.prisma.tier.create({ data: dto });
  }

  async update(id: string, dto: UpdateTierDto) {
    return this.prisma.tier.update({
      where: { id },
      data: dto,
    });
  }
}
```

**Step 4: Run tests**

```bash
cd ~/Documents/js/gym-control-plane/api
yarn test --testPathPatterns=tiers.service
```

Expected: All 3 tests PASS.

**Step 5: Create TiersController**

Create `api/src/tiers/tiers.controller.ts`:

```typescript
import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TiersService } from './tiers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateTierDto } from './dto/create-tier.dto';
import { UpdateTierDto } from './dto/update-tier.dto';

@ApiTags('Tiers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tiers')
export class TiersController {
  constructor(private readonly tiersService: TiersService) {}

  @Get()
  findAll() {
    return this.tiersService.findAll();
  }

  @Post()
  create(@Body() dto: CreateTierDto) {
    return this.tiersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTierDto) {
    return this.tiersService.update(id, dto);
  }
}
```

**Step 6: Create TiersModule, register in AppModule**

Create `api/src/tiers/tiers.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TiersService } from './tiers.service';
import { TiersController } from './tiers.controller';

@Module({
  controllers: [TiersController],
  providers: [TiersService],
})
export class TiersModule {}
```

Add `TiersModule` to AppModule imports.

**Step 7: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add api/src/tiers/ api/src/app.module.ts
git commit -m "feat: add tiers module with CRUD"
```

---

### Task 6: Gyms Module

**Files:**
- Create: `api/src/gyms/gyms.module.ts`
- Create: `api/src/gyms/gyms.service.ts`
- Create: `api/src/gyms/gyms.controller.ts`
- Create: `api/src/gyms/gyms.service.spec.ts`
- Create: `api/src/gyms/dto/create-gym.dto.ts`
- Create: `api/src/gyms/dto/update-gym.dto.ts`
- Create: `api/src/gyms/dto/update-gym-status.dto.ts`

**Step 1: Create DTOs**

Create `api/src/gyms/dto/create-gym.dto.ts`:

```typescript
import { IsString, IsEmail, IsOptional, IsUUID, IsDateString, MaxLength } from 'class-validator';

export class CreateGymDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsUUID()
  tierId: string;

  @IsString()
  @MaxLength(200)
  ownerName: string;

  @IsEmail()
  @MaxLength(255)
  ownerEmail: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  ownerPhone?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
```

Create `api/src/gyms/dto/update-gym.dto.ts`:

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateGymDto } from './create-gym.dto';

export class UpdateGymDto extends PartialType(CreateGymDto) {}
```

Create `api/src/gyms/dto/update-gym-status.dto.ts`:

```typescript
import { IsEnum } from 'class-validator';

enum GymStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  EXPIRED = 'EXPIRED',
}

export class UpdateGymStatusDto {
  @IsEnum(GymStatus)
  status: GymStatus;
}
```

**Step 2: Write failing tests**

Create `api/src/gyms/gyms.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GymsService } from './gyms.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GymsService', () => {
  let service: GymsService;
  const mockPrisma = {
    gym: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    healthCheck: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GymsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GymsService>(GymsService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return gyms with tier and latest health check', async () => {
      const gyms = [{ id: '1', name: 'Test Gym', tier: { name: 'Starter' } }];
      mockPrisma.gym.findMany.mockResolvedValue(gyms);
      mockPrisma.gym.count.mockResolvedValue(1);

      const result = await service.findAll();
      expect(result.data).toEqual(gyms);
      expect(result.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should return gym with health check history', async () => {
      const gym = { id: '1', name: 'Test Gym' };
      mockPrisma.gym.findUnique.mockResolvedValue(gym);
      mockPrisma.healthCheck.findMany.mockResolvedValue([]);

      const result = await service.findOne('1');
      expect(result.gym).toEqual(gym);
    });

    it('should throw NotFoundException when gym not found', async () => {
      mockPrisma.gym.findUnique.mockResolvedValue(null);

      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create a gym with auto-generated license key', async () => {
      const dto = { name: 'New Gym', tierId: 'tier-1', ownerName: 'John', ownerEmail: 'john@test.com' };
      mockPrisma.gym.create.mockResolvedValue({ id: '2', licenseKey: 'uuid-key', ...dto });

      const result = await service.create(dto);
      expect(result).toHaveProperty('licenseKey');
    });
  });

  describe('updateStatus', () => {
    it('should update gym status', async () => {
      mockPrisma.gym.findUnique.mockResolvedValue({ id: '1' });
      mockPrisma.gym.update.mockResolvedValue({ id: '1', status: 'SUSPENDED' });

      const result = await service.updateStatus('1', 'SUSPENDED');
      expect(result.status).toBe('SUSPENDED');
    });

    it('should throw NotFoundException when gym not found', async () => {
      mockPrisma.gym.findUnique.mockResolvedValue(null);

      await expect(service.updateStatus('bad-id', 'SUSPENDED')).rejects.toThrow(NotFoundException);
    });
  });

  describe('regenerateKey', () => {
    it('should generate a new license key', async () => {
      mockPrisma.gym.findUnique.mockResolvedValue({ id: '1', licenseKey: 'old-key' });
      mockPrisma.gym.update.mockResolvedValue({ id: '1', licenseKey: 'new-key' });

      const result = await service.regenerateKey('1');
      expect(result.licenseKey).not.toBe('old-key');
    });
  });
});
```

**Step 3: Implement GymsService**

Create `api/src/gyms/gyms.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGymDto } from './dto/create-gym.dto';
import { UpdateGymDto } from './dto/update-gym.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class GymsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page: number = 1, limit: number = 20) {
    const [data, total] = await Promise.all([
      this.prisma.gym.findMany({
        include: {
          tier: true,
          healthChecks: {
            orderBy: { checkedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.gym.count(),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const gym = await this.prisma.gym.findUnique({
      where: { id },
      include: { tier: true },
    });
    if (!gym) throw new NotFoundException(`Gym ${id} not found`);

    const healthChecks = await this.prisma.healthCheck.findMany({
      where: { gymId: id },
      orderBy: { checkedAt: 'desc' },
      take: 30,
    });

    return { gym, healthChecks };
  }

  async create(dto: CreateGymDto) {
    return this.prisma.gym.create({
      data: {
        ...dto,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      include: { tier: true },
    });
  }

  async update(id: string, dto: UpdateGymDto) {
    await this.findOne(id);
    return this.prisma.gym.update({
      where: { id },
      data: {
        ...dto,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
      include: { tier: true },
    });
  }

  async updateStatus(id: string, status: string) {
    const { gym } = await this.findOne(id);
    if (!gym) throw new NotFoundException(`Gym ${id} not found`);
    return this.prisma.gym.update({
      where: { id },
      data: { status: status as any },
      include: { tier: true },
    });
  }

  async regenerateKey(id: string) {
    await this.findOne(id);
    return this.prisma.gym.update({
      where: { id },
      data: { licenseKey: randomUUID() },
      include: { tier: true },
    });
  }
}
```

**Step 4: Run tests**

```bash
cd ~/Documents/js/gym-control-plane/api
yarn test --testPathPatterns=gyms.service
```

Expected: All 6 tests PASS.

**Step 5: Create GymsController**

Create `api/src/gyms/gyms.controller.ts`:

```typescript
import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { GymsService } from './gyms.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateGymDto } from './dto/create-gym.dto';
import { UpdateGymDto } from './dto/update-gym.dto';
import { UpdateGymStatusDto } from './dto/update-gym-status.dto';

@ApiTags('Gyms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('gyms')
export class GymsController {
  constructor(private readonly gymsService: GymsService) {}

  @Get()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.gymsService.findAll(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.gymsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateGymDto) {
    return this.gymsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGymDto) {
    return this.gymsService.update(id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateGymStatusDto) {
    return this.gymsService.updateStatus(id, dto.status);
  }

  @Post(':id/regenerate-key')
  regenerateKey(@Param('id') id: string) {
    return this.gymsService.regenerateKey(id);
  }
}
```

**Step 6: Create GymsModule, register in AppModule**

Create `api/src/gyms/gyms.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { GymsService } from './gyms.service';
import { GymsController } from './gyms.controller';

@Module({
  controllers: [GymsController],
  providers: [GymsService],
  exports: [GymsService],
})
export class GymsModule {}
```

Add `GymsModule` to AppModule imports.

**Step 7: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add api/src/gyms/ api/src/app.module.ts
git commit -m "feat: add gyms module with CRUD, status toggle, key regeneration"
```

---

### Task 7: Licenses Module (Phone-Home Endpoint)

**Files:**
- Create: `api/src/licenses/licenses.module.ts`
- Create: `api/src/licenses/licenses.service.ts`
- Create: `api/src/licenses/licenses.controller.ts`
- Create: `api/src/licenses/licenses.service.spec.ts`
- Create: `api/src/licenses/dto/validate-license.dto.ts`

**Step 1: Create DTO**

Create `api/src/licenses/dto/validate-license.dto.ts`:

```typescript
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ValidateLicenseDto {
  @IsInt()
  @Min(0)
  currentMemberCount: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  appVersion?: string;
}
```

**Step 2: Write failing tests**

Create `api/src/licenses/licenses.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { LicensesService } from './licenses.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LicensesService', () => {
  let service: LicensesService;
  const mockPrisma = {
    gym: {
      findUnique: jest.fn(),
    },
    healthCheck: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicensesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LicensesService>(LicensesService);
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('should return license info for active gym', async () => {
      mockPrisma.gym.findUnique.mockResolvedValue({
        id: 'gym-1',
        name: 'Test Gym',
        status: 'ACTIVE',
        expiresAt: new Date('2026-04-10'),
        tier: { name: 'Growth', maxMembers: 100 },
      });
      mockPrisma.healthCheck.create.mockResolvedValue({});

      const result = await service.validate(
        'valid-key',
        { currentMemberCount: 25, appVersion: '1.0.0' },
        '127.0.0.1',
      );

      expect(result.status).toBe('ACTIVE');
      expect(result.gymName).toBe('Test Gym');
      expect(result.maxMembers).toBe(100);
    });

    it('should log health check even for suspended gyms', async () => {
      mockPrisma.gym.findUnique.mockResolvedValue({
        id: 'gym-1',
        name: 'Test Gym',
        status: 'SUSPENDED',
        tier: { name: 'Growth', maxMembers: 100 },
      });
      mockPrisma.healthCheck.create.mockResolvedValue({});

      await expect(
        service.validate('valid-key', { currentMemberCount: 25 }, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.healthCheck.create).toHaveBeenCalled();
    });

    it('should throw ForbiddenException for invalid key', async () => {
      mockPrisma.gym.findUnique.mockResolvedValue(null);

      await expect(
        service.validate('bad-key', { currentMemberCount: 0 }, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for expired gym', async () => {
      mockPrisma.gym.findUnique.mockResolvedValue({
        id: 'gym-1',
        name: 'Test Gym',
        status: 'EXPIRED',
        tier: { name: 'Growth', maxMembers: 100 },
      });
      mockPrisma.healthCheck.create.mockResolvedValue({});

      await expect(
        service.validate('valid-key', { currentMemberCount: 25 }, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
```

**Step 3: Implement LicensesService**

Create `api/src/licenses/licenses.service.ts`:

```typescript
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidateLicenseDto } from './dto/validate-license.dto';

@Injectable()
export class LicensesService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(licenseKey: string, dto: ValidateLicenseDto, ipAddress: string) {
    const gym = await this.prisma.gym.findUnique({
      where: { licenseKey },
      include: { tier: true },
    });

    if (!gym) throw new ForbiddenException('Invalid license key');

    // Log health check regardless of status
    await this.prisma.healthCheck.create({
      data: {
        gymId: gym.id,
        memberCount: dto.currentMemberCount,
        appVersion: dto.appVersion,
        ipAddress,
      },
    });

    if (gym.status !== 'ACTIVE') {
      throw new ForbiddenException('License is not active');
    }

    return {
      status: gym.status,
      gymName: gym.name,
      tierName: gym.tier.name,
      maxMembers: gym.tier.maxMembers,
      expiresAt: gym.expiresAt?.toISOString() ?? null,
    };
  }
}
```

**Step 4: Run tests**

```bash
cd ~/Documents/js/gym-control-plane/api
yarn test --testPathPatterns=licenses.service
```

Expected: All 4 tests PASS.

**Step 5: Create LicensesController**

Create `api/src/licenses/licenses.controller.ts`:

```typescript
import { Controller, Post, Body, Headers, Ip } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LicensesService } from './licenses.service';
import { ValidateLicenseDto } from './dto/validate-license.dto';

@ApiTags('Licenses')
@Controller('licenses')
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Post('validate')
  async validate(
    @Headers('x-license-key') licenseKey: string,
    @Body() dto: ValidateLicenseDto,
    @Ip() ip: string,
  ) {
    return this.licensesService.validate(licenseKey, dto, ip);
  }
}
```

**Step 6: Create LicensesModule, register in AppModule**

Create `api/src/licenses/licenses.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { LicensesService } from './licenses.service';
import { LicensesController } from './licenses.controller';

@Module({
  controllers: [LicensesController],
  providers: [LicensesService],
})
export class LicensesModule {}
```

Add `LicensesModule` to AppModule imports.

**Step 7: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add api/src/licenses/ api/src/app.module.ts
git commit -m "feat: add licenses module with phone-home validate endpoint"
```

---

### Task 8: Dashboard Module (Aggregate Stats)

**Files:**
- Create: `api/src/dashboard/dashboard.module.ts`
- Create: `api/src/dashboard/dashboard.service.ts`
- Create: `api/src/dashboard/dashboard.controller.ts`
- Create: `api/src/dashboard/dashboard.service.spec.ts`

**Step 1: Write failing tests**

Create `api/src/dashboard/dashboard.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DashboardService', () => {
  let service: DashboardService;
  const mockPrisma = {
    gym: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    healthCheck: {
      aggregate: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    jest.clearAllMocks();
  });

  it('should return aggregate stats', async () => {
    mockPrisma.gym.count
      .mockResolvedValueOnce(10)   // total
      .mockResolvedValueOnce(8)    // active
      .mockResolvedValueOnce(2);   // suspended
    mockPrisma.healthCheck.aggregate.mockResolvedValue({
      _sum: { memberCount: 500 },
    });
    mockPrisma.gym.findMany.mockResolvedValue([]);

    const result = await service.getStats();
    expect(result.totalGyms).toBe(10);
    expect(result.activeGyms).toBe(8);
    expect(result.suspendedGyms).toBe(2);
    expect(result.totalMembers).toBe(500);
  });
});
```

**Step 2: Implement DashboardService**

Create `api/src/dashboard/dashboard.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalGyms, activeGyms, suspendedGyms, memberAgg, staleGyms] =
      await Promise.all([
        this.prisma.gym.count(),
        this.prisma.gym.count({ where: { status: 'ACTIVE' } }),
        this.prisma.gym.count({ where: { status: 'SUSPENDED' } }),
        this.prisma.healthCheck.aggregate({
          _sum: { memberCount: true },
          where: {
            checkedAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
        }),
        this.prisma.gym.findMany({
          where: {
            status: 'ACTIVE',
            healthChecks: {
              none: { checkedAt: { gte: sevenDaysAgo } },
            },
          },
          select: { id: true, name: true, ownerEmail: true },
        }),
      ]);

    return {
      totalGyms,
      activeGyms,
      suspendedGyms,
      totalMembers: memberAgg._sum.memberCount ?? 0,
      staleGyms,
    };
  }
}
```

**Step 3: Run tests**

```bash
cd ~/Documents/js/gym-control-plane/api
yarn test --testPathPatterns=dashboard.service
```

Expected: PASS.

**Step 4: Create DashboardController and Module**

Create `api/src/dashboard/dashboard.controller.ts`:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getStats() {
    return this.dashboardService.getStats();
  }
}
```

Create `api/src/dashboard/dashboard.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

Add `DashboardModule` to AppModule imports.

**Step 5: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add api/src/dashboard/ api/src/app.module.ts
git commit -m "feat: add dashboard module with aggregate stats"
```

---

### Task 9: Admin Seed Script

**Files:**
- Create: `api/prisma/seed.ts`
- Modify: `api/package.json`

**Step 1: Create seed script**

Create `api/prisma/seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Create admin user
  const hashedPassword = await bcrypt.hash('admin123', 10);
  await prisma.adminUser.upsert({
    where: { email: 'admin@gymplatform.com' },
    update: {},
    create: {
      email: 'admin@gymplatform.com',
      password: hashedPassword,
      name: 'Platform Admin',
    },
  });

  // Create tiers
  const starter = await prisma.tier.upsert({
    where: { name: 'Starter' },
    update: {},
    create: { name: 'Starter', maxMembers: 50, priceKes: 3000, description: 'For small gyms up to 50 members' },
  });

  const growth = await prisma.tier.upsert({
    where: { name: 'Growth' },
    update: {},
    create: { name: 'Growth', maxMembers: 200, priceKes: 7500, description: 'For growing gyms up to 200 members' },
  });

  await prisma.tier.upsert({
    where: { name: 'Enterprise' },
    update: {},
    create: { name: 'Enterprise', maxMembers: 1000, priceKes: 15000, description: 'For large gyms up to 1000 members' },
  });

  // Create sample gym
  await prisma.gym.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'FitZone Nairobi',
      tierId: growth.id,
      ownerName: 'James Mwangi',
      ownerEmail: 'james@fitzone.co.ke',
      ownerPhone: '+254712345678',
    },
  });

  console.log('Seed complete. Admin login: admin@gymplatform.com / admin123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

**Step 2: Add prisma seed config to package.json**

Add to `api/package.json`:

```json
"prisma": {
  "seed": "ts-node prisma/seed.ts"
}
```

**Step 3: Run seed**

```bash
cd ~/Documents/js/gym-control-plane/api
npx prisma db seed
```

Expected: Seed complete message.

**Step 4: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add api/prisma/seed.ts api/package.json
git commit -m "feat: add seed script with admin user, tiers, and sample gym"
```

---

### Task 10: Scaffold Next.js Dashboard

**Files:**
- Create: `dashboard/`

**Step 1: Create Next.js app**

```bash
cd ~/Documents/js/gym-control-plane
npx create-next-app@latest dashboard --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-yarn
```

**Step 2: Install dependencies**

```bash
cd ~/Documents/js/gym-control-plane/dashboard
yarn add swr
```

**Step 3: Create API client**

Create `dashboard/src/lib/api.ts`:

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002/api/v1';

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message ?? 'Request failed');
  }

  return res.json() as T;
}

export const api = {
  get: <T>(endpoint: string) => fetchApi<T>(endpoint),
  post: <T>(endpoint: string, body: unknown) =>
    fetchApi<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(endpoint: string, body: unknown) =>
    fetchApi<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
};
```

**Step 4: Create auth helpers**

Create `dashboard/src/lib/auth.ts`:

```typescript
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export function setToken(token: string) {
  localStorage.setItem('token', token);
}

export function clearToken() {
  localStorage.removeItem('token');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
```

**Step 5: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add dashboard/
git commit -m "feat: scaffold Next.js dashboard with API client"
```

---

### Task 11: Dashboard Login Page

**Files:**
- Create: `dashboard/src/app/login/page.tsx`
- Modify: `dashboard/src/app/layout.tsx`
- Modify: `dashboard/src/app/page.tsx`

**Step 1: Create login page**

Create `dashboard/src/app/login/page.tsx`:

```tsx
'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { setToken } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await api.post<{ accessToken: string }>('/auth/login', {
        email,
        password,
      });
      setToken(data.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Control Plane</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

**Step 2: Update root page to redirect**

Replace `dashboard/src/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard');
}
```

**Step 3: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add dashboard/src/
git commit -m "feat: add login page"
```

---

### Task 12: Dashboard Home Page

**Files:**
- Create: `dashboard/src/app/dashboard/page.tsx`
- Create: `dashboard/src/app/dashboard/layout.tsx`
- Create: `dashboard/src/components/sidebar.tsx`
- Create: `dashboard/src/components/stat-card.tsx`

**Step 1: Create Sidebar component**

Create `dashboard/src/components/sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearToken } from '@/lib/auth';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/gyms', label: 'Gyms' },
  { href: '/dashboard/tiers', label: 'Tiers' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="w-60 bg-gray-900 text-gray-100 min-h-screen flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold">Control Plane</h1>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block px-3 py-2 rounded text-sm ${
              pathname === item.href
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-800">
        <button
          onClick={() => {
            clearToken();
            router.push('/login');
          }}
          className="text-sm text-gray-400 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
```

**Step 2: Create StatCard component**

Create `dashboard/src/components/stat-card.tsx`:

```tsx
export function StatCard({
  label,
  value,
  color = 'blue',
}: {
  label: string;
  value: string | number;
  color?: 'blue' | 'green' | 'red' | 'yellow';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
    yellow: 'bg-yellow-50 text-yellow-700',
  };

  return (
    <div className={`rounded-lg p-5 ${colors[color]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}
```

**Step 3: Create dashboard layout**

Create `dashboard/src/app/dashboard/layout.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login');
    }
  }, [router]);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 bg-gray-50 p-8">{children}</main>
    </div>
  );
}
```

**Step 4: Create dashboard page**

Create `dashboard/src/app/dashboard/page.tsx`:

```tsx
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api';
import { StatCard } from '@/components/stat-card';

type DashboardStats = {
  totalGyms: number;
  activeGyms: number;
  suspendedGyms: number;
  totalMembers: number;
  staleGyms: { id: string; name: string; ownerEmail: string }[];
};

export default function DashboardPage() {
  const { data, error, isLoading } = useSWR<DashboardStats>(
    '/dashboard',
    (url: string) => api.get<DashboardStats>(url),
  );

  if (isLoading) return <p className="text-gray-500">Loading...</p>;
  if (error) return <p className="text-red-600">Failed to load dashboard</p>;
  if (!data) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Gyms" value={data.totalGyms} color="blue" />
        <StatCard label="Active" value={data.activeGyms} color="green" />
        <StatCard label="Suspended" value={data.suspendedGyms} color="red" />
        <StatCard label="Total Members" value={data.totalMembers} color="yellow" />
      </div>

      {data.staleGyms.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-yellow-800 mb-2">
            Gyms not checked in for 7+ days
          </h2>
          <ul className="space-y-1">
            {data.staleGyms.map((gym) => (
              <li key={gym.id} className="text-sm text-yellow-700">
                {gym.name} — {gym.ownerEmail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

**Step 5: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add dashboard/src/
git commit -m "feat: add dashboard home page with stats and sidebar"
```

---

### Task 13: Gyms List Page

**Files:**
- Create: `dashboard/src/app/dashboard/gyms/page.tsx`

**Step 1: Create gyms list page**

Create `dashboard/src/app/dashboard/gyms/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { api } from '@/lib/api';

type Gym = {
  id: string;
  name: string;
  status: string;
  licenseKey: string;
  ownerName: string;
  ownerEmail: string;
  tier: { name: string };
  healthChecks: { memberCount: number; checkedAt: string }[];
};

type GymsResponse = {
  data: Gym[];
  total: number;
  page: number;
  limit: number;
};

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  SUSPENDED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

export default function GymsPage() {
  const [search, setSearch] = useState('');
  const { data, error, isLoading } = useSWR<GymsResponse>(
    '/gyms',
    (url: string) => api.get<GymsResponse>(url),
  );

  if (isLoading) return <p className="text-gray-500">Loading...</p>;
  if (error) return <p className="text-red-600">Failed to load gyms</p>;
  if (!data) return null;

  const filtered = data.data.filter((gym) =>
    gym.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Gyms</h1>
        <Link
          href="/dashboard/gyms/new"
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          Add Gym
        </Link>
      </div>

      <input
        type="text"
        placeholder="Search gyms..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-xs border border-gray-300 rounded px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Members</th>
              <th className="px-4 py-3">Last Check-in</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((gym) => {
              const lastCheck = gym.healthChecks[0];
              return (
                <tr key={gym.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/gyms/${gym.id}`}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {gym.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{gym.tier.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[gym.status]}`}
                    >
                      {gym.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {lastCheck?.memberCount ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {lastCheck
                      ? new Date(lastCheck.checkedAt).toLocaleDateString()
                      : 'Never'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add dashboard/src/app/dashboard/gyms/
git commit -m "feat: add gyms list page with search and status badges"
```

---

### Task 14: Gym Detail Page

**Files:**
- Create: `dashboard/src/app/dashboard/gyms/[id]/page.tsx`

**Step 1: Create gym detail page**

Create `dashboard/src/app/dashboard/gyms/[id]/page.tsx`:

```tsx
'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import { api } from '@/lib/api';

type Gym = {
  id: string;
  name: string;
  status: string;
  licenseKey: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string | null;
  expiresAt: string | null;
  notes: string | null;
  tier: { name: string; maxMembers: number };
};

type HealthCheck = {
  id: string;
  memberCount: number;
  appVersion: string | null;
  ipAddress: string | null;
  checkedAt: string;
};

type GymDetail = {
  gym: Gym;
  healthChecks: HealthCheck[];
};

export default function GymDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, isLoading } = useSWR<GymDetail>(
    `/gyms/${id}`,
    (url: string) => api.get<GymDetail>(url),
  );

  if (isLoading) return <p className="text-gray-500">Loading...</p>;
  if (error) return <p className="text-red-600">Failed to load gym</p>;
  if (!data) return null;

  const { gym, healthChecks } = data;

  async function toggleStatus() {
    const newStatus = gym.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    await api.patch(`/gyms/${id}/status`, { status: newStatus });
    mutate(`/gyms/${id}`);
  }

  async function regenerateKey() {
    if (!confirm('Regenerate license key? The gym will need to update their config.')) return;
    await api.post(`/gyms/${id}/regenerate-key`, {});
    mutate(`/gyms/${id}`);
  }

  return (
    <div className="max-w-4xl">
      <button
        onClick={() => router.push('/dashboard/gyms')}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        &larr; Back to gyms
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{gym.name}</h1>
        <div className="flex gap-2">
          <button
            onClick={toggleStatus}
            className={`px-4 py-2 rounded text-sm font-medium ${
              gym.status === 'ACTIVE'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {gym.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
          </button>
          <button
            onClick={regenerateKey}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-300"
          >
            Regenerate Key
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase">Gym Info</h2>
          <InfoRow label="Status" value={gym.status} />
          <InfoRow label="Tier" value={`${gym.tier.name} (max ${gym.tier.maxMembers})`} />
          <InfoRow label="License Key" value={gym.licenseKey} mono />
          <InfoRow label="Expires" value={gym.expiresAt ? new Date(gym.expiresAt).toLocaleDateString() : 'No expiry'} />
          {gym.notes && <InfoRow label="Notes" value={gym.notes} />}
        </div>

        <div className="bg-white rounded-lg shadow p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase">Owner</h2>
          <InfoRow label="Name" value={gym.ownerName} />
          <InfoRow label="Email" value={gym.ownerEmail} />
          <InfoRow label="Phone" value={gym.ownerPhone ?? '—'} />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <h2 className="px-4 py-3 text-sm font-semibold text-gray-500 bg-gray-50">
          Health Check History (last 30)
        </h2>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Members</th>
              <th className="px-4 py-2">Version</th>
              <th className="px-4 py-2">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {healthChecks.map((hc) => (
              <tr key={hc.id}>
                <td className="px-4 py-2 text-gray-600">
                  {new Date(hc.checkedAt).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-gray-600">{hc.memberCount}</td>
                <td className="px-4 py-2 text-gray-500">{hc.appVersion ?? '—'}</td>
                <td className="px-4 py-2 text-gray-500">{hc.ipAddress ?? '—'}</td>
              </tr>
            ))}
            {healthChecks.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-gray-400">
                  No health checks yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm text-gray-900 ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </span>
    </div>
  );
}
```

**Step 2: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add dashboard/src/app/dashboard/gyms/
git commit -m "feat: add gym detail page with status toggle and health history"
```

---

### Task 15: Tiers Page + Create Gym Page

**Files:**
- Create: `dashboard/src/app/dashboard/tiers/page.tsx`
- Create: `dashboard/src/app/dashboard/gyms/new/page.tsx`

**Step 1: Create tiers page**

Create `dashboard/src/app/dashboard/tiers/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { api } from '@/lib/api';

type Tier = {
  id: string;
  name: string;
  maxMembers: number;
  priceKes: number;
  description: string | null;
};

export default function TiersPage() {
  const { data: tiers, isLoading } = useSWR<Tier[]>(
    '/tiers',
    (url: string) => api.get<Tier[]>(url),
  );
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [maxMembers, setMaxMembers] = useState('');
  const [priceKes, setPriceKes] = useState('');

  async function handleCreate() {
    await api.post('/tiers', {
      name,
      maxMembers: parseInt(maxMembers),
      priceKes: parseFloat(priceKes),
    });
    setShowForm(false);
    setName('');
    setMaxMembers('');
    setPriceKes('');
    mutate('/tiers');
  }

  if (isLoading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tiers</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : 'Add Tier'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Max Members</label>
            <input value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)} type="number" className="border rounded px-2 py-1 text-sm w-28" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Price (KES)</label>
            <input value={priceKes} onChange={(e) => setPriceKes(e.target.value)} type="number" className="border rounded px-2 py-1 text-sm w-28" />
          </div>
          <button onClick={handleCreate} className="bg-green-600 text-white px-4 py-1 rounded text-sm hover:bg-green-700">
            Save
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Max Members</th>
              <th className="px-4 py-3">Price (KES/mo)</th>
              <th className="px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tiers?.map((tier) => (
              <tr key={tier.id}>
                <td className="px-4 py-3 font-medium text-gray-900">{tier.name}</td>
                <td className="px-4 py-3 text-gray-600">{tier.maxMembers}</td>
                <td className="px-4 py-3 text-gray-600">{tier.priceKes.toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-500">{tier.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Create new gym page**

Create `dashboard/src/app/dashboard/gyms/new/page.tsx`:

```tsx
'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { api } from '@/lib/api';

type Tier = { id: string; name: string; maxMembers: number; priceKes: number };

export default function NewGymPage() {
  const router = useRouter();
  const { data: tiers } = useSWR<Tier[]>('/tiers', (url: string) => api.get<Tier[]>(url));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const form = new FormData(e.currentTarget);
    try {
      await api.post('/gyms', {
        name: form.get('name'),
        tierId: form.get('tierId'),
        ownerName: form.get('ownerName'),
        ownerEmail: form.get('ownerEmail'),
        ownerPhone: form.get('ownerPhone') || undefined,
        notes: form.get('notes') || undefined,
      });
      router.push('/dashboard/gyms');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create gym');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Gym</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        {error && <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>}

        <Field label="Gym Name" name="name" required />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tier</label>
          <select name="tierId" required className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
            <option value="">Select a tier</option>
            {tiers?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} (up to {t.maxMembers} members — KES {t.priceKes.toLocaleString()}/mo)
              </option>
            ))}
          </select>
        </div>
        <Field label="Owner Name" name="ownerName" required />
        <Field label="Owner Email" name="ownerEmail" type="email" required />
        <Field label="Owner Phone" name="ownerPhone" />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea name="notes" rows={3} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Gym'}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
```

**Step 3: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add dashboard/src/
git commit -m "feat: add tiers page and create gym page"
```

---

### Task 16: CLAUDE.md + Final Verification

**Files:**
- Create: `~/Documents/js/gym-control-plane/CLAUDE.md`

**Step 1: Create CLAUDE.md**

Create `~/Documents/js/gym-control-plane/CLAUDE.md`:

```markdown
# CLAUDE.md

## Project

Control plane for managing gym deployment licenses. White-label SaaS — each gym gets its own deployment of the gym management API. This service manages license keys, tiers, and billing status.

## Commands

### API (from `api/`)

```bash
yarn start:dev          # Dev server (port 3002)
yarn test               # Run unit tests
yarn lint               # ESLint
yarn build              # Production build
npx prisma migrate dev  # Run migrations
npx prisma db seed      # Seed admin user, tiers, sample gym
```

### Dashboard (from `dashboard/`)

```bash
yarn dev                # Dev server (port 3000)
yarn build              # Production build
```

## Architecture

**API** (`api/`): NestJS 11, Prisma 6, PostgreSQL. Global prefix `/api`, URI versioning `v1`.

**Dashboard** (`dashboard/`): Next.js 15 App Router, Tailwind CSS, SWR.

**Modules:**
- `auth/` — Admin JWT login (24h tokens)
- `gyms/` — Gym CRUD, status toggle, license key regeneration
- `tiers/` — Tier CRUD (name, maxMembers, priceKes)
- `licenses/` — Phone-home validate endpoint (public, no auth)
- `dashboard/` — Aggregate stats

**Phone-home:** Gym instances call `POST /api/v1/licenses/validate` with `X-License-Key` header. Returns gym status, tier info, member limit.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection
- `JWT_SECRET` — For admin auth
- `PORT` — API port (default 3002)
- `DASHBOARD_URL` — CORS origin (default http://localhost:3000)
- `NEXT_PUBLIC_API_URL` — Dashboard env, API base URL (default http://localhost:3002/api/v1)

## Seed Data

Admin login: `admin@gymplatform.com` / `admin123`
```

**Step 2: Run all API tests**

```bash
cd ~/Documents/js/gym-control-plane/api
yarn test
```

Expected: All tests pass.

**Step 3: Build both**

```bash
cd ~/Documents/js/gym-control-plane/api && yarn build
cd ~/Documents/js/gym-control-plane/dashboard && yarn build
```

Expected: Both build successfully.

**Step 4: Commit**

```bash
cd ~/Documents/js/gym-control-plane
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md"
```
