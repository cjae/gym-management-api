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
