# /me Endpoint & Image Uploads Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/me` endpoint for users to view/update their own profile (including gender and display picture), plus an image upload endpoint backed by Cloudinary.

**Architecture:** Add `gender` (enum) and `displayPicture` (string) fields to User. Add `GET/PATCH /auth/me` endpoints in auth controller. Create a new `uploads` module with Cloudinary integration for image uploads. Update existing `UpdateUserDto` and `safeUserSelect` to include new fields.

**Tech Stack:** NestJS, Prisma, Cloudinary SDK, Multer, Jest

---

### Task 1: Add Gender enum and new User fields to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma` (add Gender enum, add fields to User model)

**Step 1: Add the Gender enum after the existing enums**

In `prisma/schema.prisma`, add after the `SalaryStatus` enum (around line 52):

```prisma
enum Gender {
  MALE
  FEMALE
  NON_BINARY
  PREFER_NOT_TO_SAY
}
```

**Step 2: Add fields to User model**

In the User model, add after `mustChangePassword` (around line 63):

```prisma
gender         Gender?
displayPicture String?
```

**Step 3: Generate and apply the migration**

Run:
```bash
npx prisma migrate dev --name add-gender-and-display-picture
```

Expected: Migration created and applied. Existing users get `null` for both fields.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(prisma): add gender enum and displayPicture to User model"
```

---

### Task 2: Update existing DTOs and safeUserSelect for new fields

**Files:**
- Modify: `src/users/users.service.ts:5-15` (safeUserSelect)
- Modify: `src/users/dto/update-user.dto.ts`
- Modify: `src/users/dto/user-response.dto.ts`

**Step 1: Add new fields to `safeUserSelect`**

In `src/users/users.service.ts`, update `safeUserSelect`:

```typescript
const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  status: true,
  gender: true,
  displayPicture: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
};
```

**Step 2: Add new fields to `UpdateUserDto`**

In `src/users/dto/update-user.dto.ts`, add imports and fields:

```typescript
import { IsOptional, IsString, IsEnum, IsUrl, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus, Gender } from '@prisma/client';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'John', description: 'First name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'Last name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({
    example: '+254712345678',
    description: 'Phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    example: 'ACTIVE',
    description: 'User status',
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    example: 'MALE',
    description: 'Gender',
    enum: Gender,
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/example/image/upload/v1/avatar.jpg',
    description: 'Display picture URL',
  })
  @IsOptional()
  @IsUrl()
  displayPicture?: string;
}
```

**Step 3: Add new fields to `UserResponseDto`**

In `src/users/dto/user-response.dto.ts`, add:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'admin@gym.co.ke' })
  email: string;

  @ApiPropertyOptional({ example: '+254700000000' })
  phone?: string;

  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ enum: ['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'MEMBER'] })
  role: string;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] })
  status: string;

  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY'] })
  gender?: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/example/image/upload/v1/avatar.jpg' })
  displayPicture?: string;

  @ApiProperty()
  mustChangePassword: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
```

**Step 4: Update `mockUser` in users service spec**

In `src/users/users.service.spec.ts`, add the new fields to `mockUser`:

```typescript
const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  role: 'MEMBER',
  status: 'ACTIVE',
  gender: null,
  displayPicture: null,
  mustChangePassword: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
```

**Step 5: Run tests**

Run: `yarn test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/users/users.service.ts src/users/dto/update-user.dto.ts src/users/dto/user-response.dto.ts src/users/users.service.spec.ts
git commit -m "feat(users): add gender and displayPicture to DTOs and safeUserSelect"
```

---

### Task 3: Add GET /auth/me and PATCH /auth/me endpoints

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/auth.controller.ts`
- Create: `src/auth/dto/update-profile.dto.ts`
- Test: `src/auth/auth.service.spec.ts`

**Step 1: Create the UpdateProfileDto**

Create `src/auth/dto/update-profile.dto.ts`:

```typescript
import { IsOptional, IsString, IsEnum, IsUrl, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John', description: 'First name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'Last name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({
    example: '+254712345678',
    description: 'Phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    example: 'MALE',
    description: 'Gender',
    enum: Gender,
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/example/image/upload/v1/avatar.jpg',
    description: 'Display picture URL',
  })
  @IsOptional()
  @IsUrl()
  displayPicture?: string;
}
```

Note: No `status`, `role`, or `email` fields — users cannot change those on themselves.

**Step 2: Write the failing tests**

In `src/auth/auth.service.spec.ts`, add a new describe block for `getProfile`:

```typescript
describe('getProfile', () => {
  it('should return user profile without password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '1',
      email: 'test@test.com',
      firstName: 'Test',
      lastName: 'User',
      phone: null,
      role: 'MEMBER',
      status: 'ACTIVE',
      gender: null,
      displayPicture: null,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.getProfile('1');
    expect(result).toHaveProperty('email', 'test@test.com');
    expect(result).not.toHaveProperty('password');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: '1' },
      select: expect.objectContaining({
        id: true,
        email: true,
        gender: true,
        displayPicture: true,
      }),
    });
  });

  it('should throw UnauthorizedException if user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getProfile('nonexistent')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('updateProfile', () => {
  it('should update user profile fields', async () => {
    mockPrisma.user.update.mockResolvedValue({
      id: '1',
      email: 'test@test.com',
      firstName: 'Updated',
      lastName: 'User',
      phone: null,
      role: 'MEMBER',
      status: 'ACTIVE',
      gender: 'MALE',
      displayPicture: null,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.updateProfile('1', {
      firstName: 'Updated',
      gender: 'MALE' as any,
    });
    expect(result.firstName).toBe('Updated');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { firstName: 'Updated', gender: 'MALE' },
      select: expect.objectContaining({
        id: true,
        gender: true,
        displayPicture: true,
      }),
    });
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=auth`
Expected: FAIL — `getProfile` and `updateProfile` methods don't exist.

**Step 4: Add `getProfile` and `updateProfile` to AuthService**

In `src/auth/auth.service.ts`, add the import and a `safeUserSelect` constant at the top of the file (after imports):

```typescript
import { UpdateProfileDto } from './dto/update-profile.dto';

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  status: true,
  gender: true,
  displayPicture: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
};
```

Add the methods to the class:

```typescript
async getProfile(userId: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: safeUserSelect,
  });
  if (!user) throw new UnauthorizedException('User not found');
  return user;
}

async updateProfile(userId: string, dto: UpdateProfileDto) {
  return this.prisma.user.update({
    where: { id: userId },
    data: dto,
    select: safeUserSelect,
  });
}
```

**Step 5: Add endpoints to AuthController**

In `src/auth/auth.controller.ts`, add the imports and endpoints:

```typescript
import { Controller, Post, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
// ... existing imports ...

// Add before the changePassword endpoint:
@Get('me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiOkResponse({ type: UserResponseDto, description: 'Current user profile' })
getProfile(@CurrentUser('id') userId: string) {
  return this.authService.getProfile(userId);
}

@Patch('me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiOkResponse({ type: UserResponseDto, description: 'Updated user profile' })
updateProfile(
  @CurrentUser('id') userId: string,
  @Body() dto: UpdateProfileDto,
) {
  return this.authService.updateProfile(userId, dto);
}
```

Import `UserResponseDto` from `'../users/dto/user-response.dto'` for the Swagger response type.

**Step 6: Run tests**

Run: `yarn test -- --testPathPattern=auth`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.controller.ts src/auth/dto/update-profile.dto.ts src/auth/auth.service.spec.ts
git commit -m "feat(auth): add GET/PATCH /auth/me endpoints for user profile"
```

---

### Task 4: Add Cloudinary config

**Files:**
- Create: `src/common/config/cloudinary.config.ts`
- Modify: `src/common/loaders/config.loader.module.ts`

**Step 1: Create cloudinary config**

Create `src/common/config/cloudinary.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';

export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

export const getCloudinaryConfigName = () => 'cloudinary';

export const getCloudinaryConfig = (): CloudinaryConfig => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  apiKey: process.env.CLOUDINARY_API_KEY ?? '',
  apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
});

export default registerAs(getCloudinaryConfigName(), getCloudinaryConfig);
```

**Step 2: Add to ConfigLoaderModule**

In `src/common/loaders/config.loader.module.ts`, add:

```typescript
import cloudinaryConfig from '../config/cloudinary.config';

export const ConfigLoaderModule = ConfigModule.forRoot({
  load: [appConfig, authConfig, mailConfig, paymentConfig, sentryConfig, cloudinaryConfig],
  isGlobal: true,
  cache: true,
});
```

**Step 3: Commit**

```bash
git add src/common/config/cloudinary.config.ts src/common/loaders/config.loader.module.ts
git commit -m "feat(config): add Cloudinary configuration"
```

---

### Task 5: Create uploads module with Cloudinary integration

**Files:**
- Create: `src/uploads/uploads.module.ts`
- Create: `src/uploads/uploads.service.ts`
- Create: `src/uploads/uploads.controller.ts`
- Create: `src/uploads/uploads.service.spec.ts`
- Modify: `src/app.module.ts`

**Step 1: Install Cloudinary SDK**

Run:
```bash
yarn add cloudinary
```

**Step 2: Write the failing test**

Create `src/uploads/uploads.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UploadsService } from './uploads.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

// Mock the cloudinary module
jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
    },
  },
}));

import { v2 as cloudinary } from 'cloudinary';

describe('UploadsService', () => {
  let service: UploadsService;

  const mockConfigService = {
    get: jest.fn().mockReturnValue({
      cloudName: 'test-cloud',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadImage', () => {
    it('should upload an image and return the URL', async () => {
      const mockFile: Express.Multer.File = {
        buffer: Buffer.from('fake-image'),
        mimetype: 'image/png',
        originalname: 'test.png',
        size: 1024,
        fieldname: 'file',
        encoding: '7bit',
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const mockResult = {
        secure_url: 'https://res.cloudinary.com/test/image/upload/v1/gym-management/avatars/abc123.png',
      };

      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (_options: any, callback: Function) => {
          callback(null, mockResult);
          return { end: jest.fn() };
        },
      );

      const result = await service.uploadImage(mockFile);
      expect(result).toEqual({ url: mockResult.secure_url });
    });

    it('should throw BadRequestException on upload failure', async () => {
      const mockFile: Express.Multer.File = {
        buffer: Buffer.from('fake-image'),
        mimetype: 'image/png',
        originalname: 'test.png',
        size: 1024,
        fieldname: 'file',
        encoding: '7bit',
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (_options: any, callback: Function) => {
          callback(new Error('Upload failed'), null);
          return { end: jest.fn() };
        },
      );

      await expect(service.uploadImage(mockFile)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=uploads`
Expected: FAIL — UploadsService doesn't exist.

**Step 4: Create UploadsService**

Create `src/uploads/uploads.service.ts`:

```typescript
import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import {
  CloudinaryConfig,
  getCloudinaryConfigName,
} from '../common/config/cloudinary.config';

@Injectable()
export class UploadsService implements OnModuleInit {
  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const config = this.configService.get<CloudinaryConfig>(
      getCloudinaryConfigName(),
    )!;
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
    });
  }

  async uploadImage(file: Express.Multer.File): Promise<{ url: string }> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'gym-management/avatars',
          resource_type: 'image',
        },
        (error, result) => {
          if (error || !result) {
            reject(new BadRequestException('Image upload failed'));
            return;
          }
          resolve({ url: result.secure_url });
        },
      );
      stream.end(file.buffer);
    });
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=uploads`
Expected: All tests pass.

**Step 6: Create UploadsController**

Create `src/uploads/uploads.controller.ts`:

```typescript
import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadsService } from './uploads.service';

@ApiTags('Uploads')
@ApiBearerAuth()
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', example: 'https://res.cloudinary.com/example/image/upload/v1/gym-management/avatars/abc123.jpg' },
      },
    },
  })
  uploadImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.uploadsService.uploadImage(file);
  }
}
```

**Step 7: Create UploadsModule**

Create `src/uploads/uploads.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { UploadsController } from './uploads.controller';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
```

**Step 8: Register in AppModule**

In `src/app.module.ts`, add:

```typescript
import { UploadsModule } from './uploads/uploads.module';
```

Add `UploadsModule` to the `imports` array.

**Step 9: Run full test suite**

Run: `yarn test`
Expected: All tests pass.

**Step 10: Commit**

```bash
git add package.json yarn.lock src/uploads/ src/app.module.ts
git commit -m "feat(uploads): add image upload endpoint with Cloudinary integration"
```

---

### Task 6: Update CLAUDE.md and env docs

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add uploads module to the Modules list**

In `CLAUDE.md`, add to the Modules section:

```
- `uploads/` — Image upload to Cloudinary (avatars), returns URL
```

**Step 2: Add new env vars to the Environment Variables section**

```
- `CLOUDINARY_CLOUD_NAME` — Cloudinary cloud name (optional in dev)
- `CLOUDINARY_API_KEY` — Cloudinary API key (optional in dev)
- `CLOUDINARY_API_SECRET` — Cloudinary API secret (optional in dev)
```

**Step 3: Add gender and displayPicture context**

Add a note about the `/me` endpoint in the Auth pattern section:

```
`GET /auth/me` and `PATCH /auth/me` available for any authenticated user to view/update their own profile (firstName, lastName, phone, gender, displayPicture). No role/email/status self-changes.
```

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with uploads module and /me endpoint"
```
