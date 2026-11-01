import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createValidationPipe } from './common/validation/validation';
import { Env } from './config/env';

/** HTTP-level setup shared by main.ts and the wiring tests. */
export function configureApp(app: NestExpressApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.use(helmet({ hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false }));
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['Retry-After'],
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  return { config, isProd };
}
