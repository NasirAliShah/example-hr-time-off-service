import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { Logger } from 'winston';
import { getLogger } from './common/logger';
import rateLimit from 'express-rate-limit';
import { Request } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger: Logger = getLogger('Bootstrap');

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many authentication attempts, please try again later.',
    skip: (req: Request) => !req.path.includes('auth'),
  });

  app.use(limiter);
  app.use(authLimiter);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.info(`Time-Off Microservice running on port ${port}`);
}

bootstrap().catch((error) => {
  const logger: Logger = getLogger('Bootstrap');
  logger.error('Failed to start application', { error });
  process.exit(1);
});
