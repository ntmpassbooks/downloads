import { Request, Response } from 'express';
import { VersionService } from './version.service.js';

/**
 * GET /api/app/version
 * Public endpoint to retrieve application version metadata and check for updates.
 * Accepts optional query param `currentVersion` or `clientVersion`.
 */
export function getAppVersionHandler(req: Request, res: Response): void {
  const clientVersion = (req.query.currentVersion || req.query.clientVersion || '') as string;
  const versionInfo = VersionService.getVersionMetadata(clientVersion || undefined);

  res.status(200).json(versionInfo);
}
