import { Request, Response } from 'express';
import { BishiService } from './bishi.service.js';
import { SetBishiConfigInput, GenerateBishiCycleInput } from './bishi.validation.js';
import { ROLES } from '../../types/roles.js';

export function setMemberBishiConfigHandler(
  req: Request<{ memberId: string }, {}, SetBishiConfigInput>,
  res: Response
): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';
  const { memberId } = req.params;
  const { monthlyAmount, dueDay } = req.body;

  const config = BishiService.setMemberBishiConfig(
    actor.organizationId,
    memberId,
    monthlyAmount,
    dueDay,
    actor.id,
    ipAddress
  );

  res.status(200).json({
    success: true,
    message: 'मासिक बीसी रचना यशस्वीरीत्या जतन केली (Bishi configuration saved successfully)',
    data: config,
  });
}

export function getMemberBishiConfigHandler(
  req: Request<{ memberId: string }>,
  res: Response
): void {
  const actor = req.user!;
  const { memberId } = req.params;

  // Authorization check: President/Treasurer can view any member in their org.
  // Regular Member can ONLY view their own config.
  if (actor.role === ROLES.MEMBER && actor.id !== memberId) {
    res.status(403).json({
      success: false,
      error: 'तुम्हाला इतर सदस्यांची बीसी पाहण्याची परवानगी नाही (Cannot view other member Bishi details)',
    });
    return;
  }

  const config = BishiService.getMemberBishiConfig(actor.organizationId, memberId);

  res.status(200).json({
    success: true,
    data: config, // Will be null if unconfigured - ZERO default amount
  });
}

export function generateCycleHandler(
  req: Request<{}, {}, GenerateBishiCycleInput>,
  res: Response
): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';
  const { monthYear } = req.body;

  const summary = BishiService.generateMonthlyCycle(
    actor.organizationId,
    monthYear,
    actor.id,
    ipAddress
  );

  res.status(200).json({
    success: true,
    message: `मासिक बीसी चक्र पूर्ण झाले: ${summary.generatedCount} नवीन नोंदी तयार, ${summary.skippedCount} वगळल्या (Cycle completed)`,
    data: summary,
  });
}

export function getMemberBishiRecordsHandler(
  req: Request<{ memberId: string }>,
  res: Response
): void {
  const actor = req.user!;
  const { memberId } = req.params;

  // Authorization check: President/Treasurer can view any member in their org.
  // Regular Member can ONLY view their own records.
  if (actor.role === ROLES.MEMBER && actor.id !== memberId) {
    res.status(403).json({
      success: false,
      error: 'तुम्हाला इतर सदस्यांच्या नोंदी पाहण्याची परवानगी नाही (Cannot view other member records)',
    });
    return;
  }

  const records = BishiService.getMemberBishiRecords(actor.organizationId, memberId);

  res.status(200).json({
    success: true,
    data: records,
  });
}

export function getOrganizationBishiOverviewHandler(
  req: Request<{}, {}, {}, { monthYear?: string }>,
  res: Response
): void {
  const actor = req.user!;
  const { monthYear } = req.query;

  const overview = BishiService.getOrganizationBishiOverview(
    actor.organizationId,
    monthYear
  );

  res.status(200).json({
    success: true,
    data: overview,
  });
}

export function deleteBishiRecordHandler(
  req: Request<{ recordId: string }>,
  res: Response
): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const result = BishiService.deleteBishiRecord(
    actor.organizationId,
    req.params.recordId,
    actor,
    ipAddress
  );

  res.status(200).json({
    success: true,
    message: result.message,
    data: result,
  });
}
