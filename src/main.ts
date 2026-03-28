import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.bootstrap';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
