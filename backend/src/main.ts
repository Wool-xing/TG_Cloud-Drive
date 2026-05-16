import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { validateEnvOrExit } from './common/env-validator';

async function bootstrap() {
  validateEnvOrExit();

  const app = await NestFactory.create(AppModule, {
    cors: false,
    rawBody: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const frontendUrl = configService.get<string>('APP_URL', 'http://localhost:5173');
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());

  // Production: strict allow-list (APP_URL only). The pre-v4 regex /localhost:\d+$/ matched
  // hostile origins like `https://evil.com.localhost:1234` due to missing `^http:` anchor and
  // would let any local app abuse credentials=true. Dev: keep localhost convenience but
  // anchor strictly to `http://localhost:<port>`.
  const corsOrigins: (string | RegExp)[] = isProduction
    ? [frontendUrl]
    : [frontendUrl, /^http:\/\/localhost:\d+$/];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  app.setGlobalPrefix('api');

  // Swagger only mounted in non-production. In production it would expose the full
  // API surface (including admin endpoints + bearer auth scheme) to anyone — a free
  // attack map. validateEnvOrExit() guarantees NODE_ENV is set. isProduction is
  // defined once near the top of bootstrap() — reused here.
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('TG云盘 API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend running on http://localhost:${port}${isProduction ? '' : ' (Swagger at /api/docs)'}`);
}
bootstrap();
