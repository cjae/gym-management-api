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
