import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { AppException, FieldErrors } from './app.exception';
import { ErrorCode } from './error-codes';

interface ErrorBody {
  error: { code: ErrorCode; message: string; fields?: FieldErrors };
}

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  423: ErrorCode.ACCOUNT_LOCKED,
  429: ErrorCode.RATE_LIMITED,
  501: ErrorCode.NOT_IMPLEMENTED,
};

/**
 * Renders every error as `{ error: { code, message, fields? } }` (spec:
 * "Errors, validation & security"). Unknown errors never leak details.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toBody(exception);
    if (status >= 500 && status !== HttpStatus.NOT_IMPLEMENTED) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json(body);
  }

  private toBody(exception: unknown): [number, ErrorBody] {
    if (exception instanceof AppException) {
      return [
        exception.getStatus(),
        { error: { code: exception.code, message: exception.message, fields: exception.fields } },
      ];
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_CODES[status] ?? ErrorCode.INTERNAL_ERROR;
      const message =
        status === HttpStatus.TOO_MANY_REQUESTS ? 'Too many requests. Try again later.' : exception.message;
      return [status, { error: { code, message } }];
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return [409, { error: { code: ErrorCode.CONFLICT, message: 'This resource already exists.' } }];
      }
      if (exception.code === 'P2025') {
        return [404, { error: { code: ErrorCode.NOT_FOUND, message: 'Resource not found.' } }];
      }
    }

    return [500, { error: { code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong.' } }];
  }
}
