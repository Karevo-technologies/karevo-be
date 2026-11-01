import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const { config, isProd } = configureApp(app);
  app.enableShutdownHooks();

  if (!isProd) {
    const doc = new DocumentBuilder()
      .setTitle('Karevo Users API')
      .setDescription('Backend for the Karevo users dashboard. Stubbed endpoints return 501 NOT_IMPLEMENTED.')
      .setVersion('1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
