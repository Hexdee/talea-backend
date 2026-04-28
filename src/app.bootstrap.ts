import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function configureApp(
  app: INestApplication,
  options?: { enableDocs?: boolean },
) {
  const uploadsPath = join(process.cwd(), 'uploads');
  const frontendOrigin = process.env.FRONTEND_ORIGIN?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => Boolean(origin)) ?? [
    'http://localhost:3000',
    'http://localhost:3001',
  ];
  const allowedOrigins = new Set(frontendOrigin);

  mkdirSync(uploadsPath, { recursive: true });
  app.enableCors({
    origin: frontendOrigin,
    credentials: true,
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      request.method === 'GET' ||
      request.method === 'HEAD' ||
      request.method === 'OPTIONS'
    ) {
      return next();
    }

    const origin = request.headers.origin;
    if (!origin || allowedOrigins.has(origin)) {
      return next();
    }

    response.status(403).json({
      statusCode: 403,
      message: 'Forbidden origin.',
    });
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

  if (options?.enableDocs ?? process.env.NODE_ENV !== 'production') {
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
