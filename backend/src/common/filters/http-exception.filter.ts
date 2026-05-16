import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';

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

    // P1-F6: pull both message + machine-readable `code` out of the exception
    // response when the thrower passed `throw new HttpException({ code, message }, status)`.
    // Pre-fix, frontends had to do `message.includes('password')` — fragile and
    // i18n-hostile. `code` lives in the response envelope so clients can switch
    // cleanly. Missing code is fine; the field is optional.
    const exRes: any = exception instanceof HttpException ? exception.getResponse() : null;
    const message = exception instanceof HttpException
      ? (exRes?.message ?? exception.message)
      : 'Internal server error';
    const code = exRes && typeof exRes === 'object' ? exRes.code : undefined;

    // Non-HttpException = unexpected error. Log full stack + report to Sentry.
    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `[${request.method} ${request.url}] ${(exception as Error)?.message ?? exception}`,
        (exception as Error)?.stack,
      );
      Sentry.captureException(exception);
    }

    const body: any = {
      ok: false,
      statusCode: status,
      message: Array.isArray(message) ? message[0] : message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    if (code) body.code = code;
    response.status(status).json(body);
  }
}
