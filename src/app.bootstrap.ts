import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function configureApp(
  app: INestApplication,
  options?: { enableDocs?: boolean },
) {
  const uploadsPath = join(process.cwd(), 'uploads');
  const frontendOrigin = process.env.FRONTEND_ORIGIN?.split(',').map((origin) =>
    origin.trim(),
  ) ?? ['http://localhost:3000', 'http://localhost:3001'];

  mkdirSync(uploadsPath, { recursive: true });
  app.enableCors({
    origin: frontendOrigin,
    credentials: true,
  });
  app.use(cookieParser());
  app.use(
    helmet({
      crossOriginResourcePolicy: {
        policy: 'cross-origin',
      },
    }),
  );
  app.use('/uploads', express.static(uploadsPath));
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'v',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );

  if (options?.enableDocs ?? true) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Lesenpad API')
      .setDescription(
        'Backend API for the Lesenpad serialized publishing platform.',
      )
      .setVersion('1.0.0')
      .addCookieAuth('lesenpad_session')
      .build();

    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }
}
