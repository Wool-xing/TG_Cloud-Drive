import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? (exception.getResponse() as any)?.message || exception.message
      : 'Internal server error';

    // Non-HttpException = unexpected error. Log full stack so operators can
    // diagnose 500s without re-deploying with extra instrumentation.
    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `[${request.method} ${request.url}] ${(exception as Error)?.message ?? exception}`,
        (exception as Error)?.stack,
      );
    }

    response.status(status).json({
      ok: false,
      statusCode: status,
      message: Array.isArray(message) ? message[0] : message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
