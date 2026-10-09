import { Request, Response, NextFunction } from 'express';
import { ReleaseService } from './release.service.js';

/**
 * POST /api/release/download-token
 * Issues a short-lived, single-use, rate-limited release authorization token.
 */
export function issueDownloadTokenHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const { releaseVersion } = req.body;
    const clientIp = (req.ip || req.socket.remoteAddress || 'unknown') as string;

    const result = ReleaseService.issueDownloadToken(releaseVersion, clientIp);

    res.status(200).json({
      success: true,
      downloadToken: result.downloadToken,
      expiresInSeconds: result.expiresInSeconds,
      releaseVersion,
    });
  } catch (error: any) {
    if (error?.status === 429 || error?.message === 'RATE_LIMIT_EXCEEDED') {
      res.status(429).json({
        success: false,
        error: 'अतिशय जास्त डाउनलोड टोकन विनंत्या. कृपया १ मिनिटानंतर पुन्हा प्रयत्न करा. (Too many token requests. Please try again after 1 minute.)',
      });
      return;
    }
    next(error);
  }
}

/**
 * POST /api/release/key
 * Validates and atomically consumes a download token, delivering the ephemeral release key.
 * Strictly defends against replay attacks and expired tokens.
 */
export function getReleaseKeyHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const { downloadToken, releaseVersion } = req.body;

    const result = ReleaseService.consumeKey(downloadToken, releaseVersion);

    res.status(200).json({
      success: true,
      releaseVersion,
      releaseKey: result.releaseKey,
      algorithm: result.algorithm,
      keyId: result.keyId,
      expiresInSeconds: result.expiresInSeconds,
    });
  } catch (error: any) {
    if (error?.message === 'TOKEN_ALREADY_USED') {
      res.status(403).json({
        success: false,
        error: 'हा डाउनलोड टोकन आधीच वापरला गेला आहे. रीप्ले अटॅक टाळण्यासाठी टोकन रद्द केले आहे. (Token already consumed. Replay prevented.)',
      });
      return;
    }

    if (error?.message === 'TOKEN_EXPIRED') {
      res.status(401).json({
        success: false,
        error: 'डाउनलोड टोकनची मुदत संपली आहे. कृपया नवीन टोकन मिळवा. (Download token has expired.)',
      });
      return;
    }

    if (error?.message === 'INVALID_TOKEN') {
      res.status(401).json({
        success: false,
        error: 'अवैध किंवा सापडला नसलेला डाउनलोड टोकन. (Invalid download token.)',
      });
      return;
    }

    if (error?.message === 'VERSION_MISMATCH') {
      res.status(400).json({
        success: false,
        error: 'आवृत्ती क्रमांक जुळत नाही. (Release version mismatch with issued token.)',
      });
      return;
    }

    next(error);
  }
}
