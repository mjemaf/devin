import { ValidationError } from 'class-validator';
import { ApiException } from './api.exception';

interface FlatError {
  path: string;
  message: string;
}

function flatten(errors: ValidationError[], parent = ''): FlatError[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ path, message }));
    return [...own, ...flatten(error.children ?? [], path)];
  });
}

/**
 * Turns class-validator failures into the documented error envelope so callers
 * learn which request parameter was rejected.
 */
export function validationExceptionFactory(errors: ValidationError[]): ApiException {
  const [first] = flatten(errors);
  if (!first) {
    return ApiException.validation('Request payload failed validation');
  }
  return ApiException.validation(first.message, 'invalid_request_parameter', first.path);
}
