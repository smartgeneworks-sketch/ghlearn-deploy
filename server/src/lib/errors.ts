import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { logger } from './logger.js';
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const badRequest = (m: string, d?: unknown) => new AppError(400, 'BAD_REQUEST', m, d);
export const unauthorized = (m = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', m);
export const forbidden = (m = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m: string) => new AppError(409, 'CONFLICT', m);
export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Route not found'));
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req as any).id as string | undefined;
  let e: AppError;
  if (err instanceof AppError) e = err;
  else if (err instanceof ZodError) e = new AppError(422, 'VALIDATION_ERROR', 'Invalid input', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  else if (err instanceof mongoose.Error.CastError) e = badRequest('Invalid identifier');
  else if (err?.aiLimit) e = new AppError(err.code === 'FEATURE_DISABLED' ? 403 : err.code === 'INPUT_TOO_LARGE' ? 413 : 429, err.code, err.message);
  else if (err?.code === 11000) e = conflict('A record with these details already exists');
  else if (err?.type === 'entity.too.large') e = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request too large');
  else if (err?.type === 'entity.parse.failed') e = badRequest('Malformed JSON');
  else { logger.error({ err, requestId }, 'unhandled error'); e = new AppError(500, 'INTERNAL', 'Something went wrong'); }
  res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details, requestId } });
};
