import { z } from 'zod';
import { AppError } from '../errors/app-error';
import {
  formatZodPath,
  toErrorDetails,
  ZodValidationPipe,
} from './zod-validation.pipe';

const probeSchema = z
  .object({
    name: z.string().min(1).max(50),
    age: z.number().int().min(0),
  })
  .strict();

describe('formatZodPath', () => {
  it('formats the root as (body)', () => {
    expect(formatZodPath([])).toBe('(body)');
  });

  it('formats nested and indexed paths in DTO notation', () => {
    expect(formatZodPath(['roles', 3, 'name'])).toBe('roles[3].name');
  });
});

describe('toErrorDetails', () => {
  it('expands unrecognized keys to one entry per property', () => {
    expect(
      toErrorDetails([
        { code: 'unrecognized_keys', path: [], keys: ['extra', 'other'] },
      ]),
    ).toEqual([
      { path: 'extra', reason: 'unknown_property' },
      { path: 'other', reason: 'unknown_property' },
    ]);
  });

  it('maps invalid types to stable expected_* reasons', () => {
    expect(
      toErrorDetails([
        { code: 'invalid_type', path: ['age'], expected: 'number' },
      ]),
    ).toEqual([{ path: 'age', reason: 'expected_number' }]);
  });
});

describe('ZodValidationPipe', () => {
  it('passes valid payloads through untouched', () => {
    const pipe = new ZodValidationPipe(probeSchema);
    expect(pipe.transform({ name: 'billing', age: 3 })).toEqual({
      name: 'billing',
      age: 3,
    });
  });

  it('rejects unknown properties without reaching the handler', () => {
    const pipe = new ZodValidationPipe(probeSchema);
    let thrown: unknown;
    try {
      pipe.transform({ name: 'billing', age: 3, extra: true });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    const appError = thrown as AppError;
    expect(appError.code).toBe('validation_failed');
    expect(appError.status).toBe(400);
    expect(appError.details).toContainEqual({
      path: 'extra',
      reason: 'unknown_property',
    });
  });

  it('rejects incorrect primitive types without implicit coercion', () => {
    const pipe = new ZodValidationPipe(probeSchema);
    let thrown: unknown;
    try {
      // A numeric string must not coerce to a number at the transport layer.
      pipe.transform({ name: 'billing', age: '3' });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).details).toContainEqual({
      path: 'age',
      reason: 'expected_number',
    });
  });

  it('never echoes input values in details', () => {
    const pipe = new ZodValidationPipe(probeSchema);
    let thrown: unknown;
    try {
      pipe.transform({ name: 'billing', age: 3, apiKey: 'ppk_live-secret' });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(JSON.stringify((thrown as AppError).details)).not.toContain(
      'ppk_live-secret',
    );
  });
});
