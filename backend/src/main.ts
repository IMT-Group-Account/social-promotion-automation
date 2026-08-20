import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (process.env.NODE_ENV === 'production' && origins.length === 0) {
    throw new Error('CORS_ORIGINS must contain the Vercel frontend origin in production.');
  }
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
