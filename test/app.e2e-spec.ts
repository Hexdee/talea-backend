import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from './../src/app.bootstrap';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, { enableDocs: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/v1/health (GET)', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const response = await request(server).get('/v1/health').expect(200);
    const body = response.body as { service: string; status: string };

    expect(body.status).toBe('ok');
    expect(body.service).toBe('talea-backend');
  });
});
