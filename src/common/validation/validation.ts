import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException, FieldErrors } from '../errors/app.exception';

/** Flattens class-validator errors to `{ "path.to.field": "first message" }`. */
export function toFieldErrors(errors: ValidationError[], prefix = ''): FieldErrors {
  const fields: FieldErrors = {};
  for (const err of errors) {
    const path = prefix ? `${prefix}.${err.property}` : err.property;
    const first = err.constraints && Object.values(err.constraints)[0];
    if (first) fields[path] = first;
    if (err.children?.length) Object.assign(fields, toFieldErrors(err.children, path));
  }
  return fields;
}

export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => AppException.validation(toFieldErrors(errors)),
  });
}
