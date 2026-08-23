import type { ValidationPipeOptions } from '@nestjs/common';

export const globalValidationPipeOptions: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};
