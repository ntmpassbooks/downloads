import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { AuthService } from './auth.service.js';
import { OrganizationService } from '../organization/organization.service.js';
import { LoginInput, ChangePinInput, RegisterPresidentInput } from './auth.validation.js';
import { FirebaseTokenService } from './firebase_token.service.js';

interface UserRecord {
  id: string;
  organization_id: string;
  phone: string;
  full_name: string;
  role: 'PRESIDENT' | 'TREASURER' | 'MEMBER';
  pin_hash: string;
  pin_salt: string;
  is_active: number;
}

export async function login(
  req: Request<{}, {}, LoginInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { phone, pin } = req.body;
    const db = getDatabase();

    const user = db
      .prepare(
        'SELECT id, organization_id, phone, full_name, role, pin_hash, pin_salt, is_active FROM users WHERE phone = ?'
      )
      .get(phone) as UserRecord | undefined;

    // Unified error response to prevent user enumeration
    if (!user || user.is_active !== 1) {
      res.status(401).json({
        success: false,
        error: 'मोबाईल नंबर किंवा पिन चुकीचा आहे (Invalid credentials)',
      });
      return;
    }

    const isValidPin = AuthService.verifyPin(pin, user.pin_hash, user.pin_salt);
    if (!isValidPin) {
      // Audit failed attempt
      const auditId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(auditId, user.organization_id, user.id, 'LOGIN_FAILED', 'Invalid PIN provided', req.ip || null);

      res.status(401).json({
        success: false,
        error: 'मोबाईल नंबर किंवा पिन चुकीचा आहे (Invalid credentials)',
      });
      return;
    }

    // Create persistent session
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';
    const userAgent = req.headers['user-agent'] || '';
    const { rawToken, expiresAt } = AuthService.createSession(user.id, ipAddress, userAgent);

    // Record audit log
    const auditId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(auditId, user.organization_id, user.id, 'LOGIN_SUCCESS', 'Successful session creation', ipAddress);

    // Fetch organization
    const org = OrganizationService.getById(user.organization_id);

    // Set secure cookie for preview browser compatibility
    res.cookie('ntm_session', rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const responsePayload: Record<string, any> = {
      success: true,
      token: rawToken,
      expiresAt,
      user: {
        id: user.id,
        organizationId: user.organization_id,
        phone: user.phone,
        fullName: user.full_name,
        role: user.role,
      },
      organization: org,
    };

    try {
      const firebaseToken = await FirebaseTokenService.createCustomToken({
        id: user.id,
        role: user.role,
        organizationId: user.organization_id,
        phone: user.phone,
      });
      if (firebaseToken) {
        responsePayload.firebaseToken = firebaseToken;
      }
    } catch {
      // Non-blocking degradation
    }

    res.status(200).json(responsePayload);
  } catch (error) {
    next(error);
  }
}

export function logout(req: Request, res: Response): void {
  if (req.sessionToken) {
    AuthService.invalidateSession(req.sessionToken);
  }

  if (req.user) {
    const db = getDatabase();
    const auditId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(auditId, req.user.organizationId, req.user.id, 'LOGOUT', 'User logged out', req.ip || null);
  }

  res.clearCookie('ntm_session');
  res.status(200).json({
    success: true,
    message: 'यशस्वीरीत्या लॉग आउट केले (Logged out successfully)',
  });
}

export async function getCurrentUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'कृपया आधी लॉग इन करा (Authentication required)',
      });
      return;
    }

    const org = OrganizationService.getById(req.user.organizationId);

    // Fetch created_at and updated_at for complete profile view
    const db = getDatabase();
    const fullUser = db
      .prepare('SELECT created_at, updated_at FROM users WHERE id = ?')
      .get(req.user.id) as { created_at: string; updated_at: string } | undefined;

    const responsePayload: Record<string, any> = {
      success: true,
      user: {
        ...req.user,
        createdAt: fullUser?.created_at,
        updatedAt: fullUser?.updated_at,
      },
      organization: org,
    };

    try {
      const firebaseToken = await FirebaseTokenService.createCustomToken({
        id: req.user.id,
        role: req.user.role,
        organizationId: req.user.organizationId,
        phone: req.user.phone,
      });
      if (firebaseToken) {
        responsePayload.firebaseToken = firebaseToken;
      }
    } catch {
      // Non-blocking degradation
    }

    res.status(200).json(responsePayload);
  } catch (error) {
    next(error);
  }
}

export function changePinHandler(
  req: Request<{}, {}, ChangePinInput>,
  res: Response
): void {
  const user = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const { rotatedToken, expiresAt } = AuthService.changePin(
    user.id,
    req.body.currentPin,
    req.body.newPin,
    ipAddress
  );

  // Set rotated cookie
  res.cookie('ntm_session', rotatedToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.status(200).json({
    success: true,
    message: 'सुरक्षा पिन यशस्वीरीत्या बदलला गेला (PIN changed successfully)',
    token: rotatedToken,
    expiresAt,
  });
}

export function getRegistrationStatus(req: Request, res: Response): void {
  const { mandalName, phone } = req.query as { mandalName?: string; phone?: string };
  const status = AuthService.isRegistrationOpen(mandalName, phone);
  res.status(200).json({
    success: true,
    registrationOpen: status.isOpen,
    reason: status.reason,
  });
}

export async function registerPresidentHandler(
  req: Request<{}, {}, RegisterPresidentInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';
    const userAgent = req.headers['user-agent'] || '';

    const { rawToken, expiresAt, user, organization } = AuthService.registerPresident(
      req.body,
      ipAddress,
      userAgent
    );

    // Set secure cookie
    res.cookie('ntm_session', rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const responsePayload: Record<string, any> = {
      success: true,
      message: 'मंडळ व अध्यक्ष नोंदणी यशस्वीपणे पूर्ण झाली (President and Mandal registered successfully)',
      token: rawToken,
      expiresAt,
      user: {
        id: user.id,
        organizationId: user.organizationId,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
      },
      organization,
    };

    try {
      const firebaseToken = await FirebaseTokenService.createCustomToken({
        id: user.id,
        role: user.role,
        organizationId: user.organizationId,
        phone: user.phone,
      });
      if (firebaseToken) {
        responsePayload.firebaseToken = firebaseToken;
      }
    } catch {
      // Non-blocking degradation
    }

    res.status(201).json(responsePayload);
  } catch (error) {
    next(error);
  }
}

export function getMyPinHandler(req: Request, res: Response): void {
  const president = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const result = AuthService.getPresidentOwnPin(president, ipAddress);

  res.status(200).json({
    success: true,
    data: result,
  });
}

