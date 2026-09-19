import { Request, Response, NextFunction } from 'express';
import { Role } from '../types/roles.js';

/**
 * Requires the user to be authenticated with a valid session.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'कृपया आधी लॉग इन करा (Authentication required)',
    });
    return;
  }
  next();
}

/**
 * Server-side Role-Based Access Control (RBAC).
 * Enforces that the user has one of the required roles.
 */
export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'कृपया आधी लॉग इन करा (Authentication required)',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: 'या क्रियेसाठी आपणास अधिकार नाही (Access forbidden for role: ' + req.user.role + ')',
      });
      return;
    }

    next();
  };
}

/**
 * Multi-tenant organization isolation guard.
 * Prevents Insecure Direct Object References (IDOR) across different mandals.
 */
export function requireOrganization(
  getOrgId: (req: Request) => string | undefined = (req) =>
    req.params.orgId || req.body?.organizationId || (req.query.orgId as string)
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'कृपया आधी लॉग इन करा (Authentication required)',
      });
      return;
    }

    const targetOrgId = getOrgId(req);
    if (targetOrgId && targetOrgId !== req.user.organizationId) {
      res.status(403).json({
        success: false,
        error: 'सुरक्षा उल्लंघन: आपण केवळ स्वतःच्या मंडळाची माहिती पाहू शकता (Access denied: cross-organization access forbidden)',
      });
      return;
    }

    next();
  };
}
