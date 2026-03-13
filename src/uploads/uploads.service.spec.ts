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
        stream: null as unknown as Express.Multer.File['stream'],
        destination: '',
        filename: '',
        path: '',
      };

      const mockResult = {
        secure_url:
          'https://res.cloudinary.com/test/image/upload/v1/gym-management/avatars/abc123.png',
      };

      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (_options: unknown, callback: (...args: unknown[]) => void) => {
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
        stream: null as unknown as Express.Multer.File['stream'],
        destination: '',
        filename: '',
        path: '',
      };

      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (_options: unknown, callback: (...args: unknown[]) => void) => {
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
