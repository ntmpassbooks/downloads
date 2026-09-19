import { Request, Response } from 'express';
import { OrganizationService } from './organization.service.js';

export function getCurrentOrganization(req: Request, res: Response): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'अनधिकृत प्रवेश (Unauthorized)' });
    return;
  }

  const organization = OrganizationService.getById(req.user.organizationId);
  if (!organization) {
    res.status(404).json({ success: false, error: 'मंडळाची माहिती सापडली नाही (Organization not found)' });
    return;
  }

  res.status(200).json({
    success: true,
    data: organization,
  });
}

export function getOrganizationById(req: Request, res: Response): void {
  const { orgId } = req.params;
  const organization = OrganizationService.getById(orgId);

  if (!organization) {
    res.status(404).json({ success: false, error: 'मंडळाची माहिती सापडली नाही (Organization not found)' });
    return;
  }

  res.status(200).json({
    success: true,
    data: organization,
  });
}

export function permanentDeleteMandalHandler(req: Request, res: Response): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'अनधिकृत प्रवेश (Unauthorized)' });
    return;
  }

  const { pin } = req.body;
  const result = OrganizationService.permanentDeleteMandal(req.user, pin, req.ip);

  res.status(200).json(result);
}
