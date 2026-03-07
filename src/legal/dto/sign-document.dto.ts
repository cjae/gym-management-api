import { IsString } from 'class-validator';

export class SignDocumentDto {
  @IsString()
  documentId: string;

  @IsString()
  signatureData: string; // base64 encoded signature image
}
