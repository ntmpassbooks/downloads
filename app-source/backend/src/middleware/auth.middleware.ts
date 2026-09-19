import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../modules/auth/auth.service.js';
import { AuthenticatedUser } from '../types/roles.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionToken?: string;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    let token: string | undefined;

    // 1. Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    // 2. Fallback to cookies if token not in header
    if (!token && req.cookies?.ntm_session) {
      token = req.cookies.ntm_session;
    }

    if (!token) {
      next();
      return;
    }

    const user = AuthService.validateSession(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
    }

    next();
  } catch (error) {
    next(error);
  }
}
