import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';

export class AppError extends Error {
  public statusCode: number;
  public details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function errorHandler(
  err: Error | AppError | ZodError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: 'अवैध माहिती प्रविष्ट केली आहे (Invalid input)',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Handle Custom Application Errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      details: err.details,
    });
    return;
  }

  // Handle Unhandled Internal Server Errors
  const isDev = env.NODE_ENV === 'development';
  console.error('Unhandled Server Error:', err);

  res.status(500).json({
    success: false,
    error: 'सर्व्हर त्रुटी निर्माण झाली. कृपया थोड्या वेळाने प्रयत्न करा. (Internal server error)',
    ...(isDev ? { stack: err.stack, raw: err.message } : {}),
  });
}
