import { Request, Response } from 'express';
import { MemberService } from './member.service.js';
import {
  CreateMemberInput,
  MemberListQuery,
  UpdateMemberStatusInput,
  UpdateMemberRoleInput,
} from './member.validation.js';

export function createMemberHandler(
  req: Request<{}, {}, CreateMemberInput>,
  res: Response
): void {
  // req.user is guaranteed by requireAuth and requireRole middleware
  const president = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const member = MemberService.createMember(president, req.body, ipAddress);

  res.status(201).json({
    success: true,
    message: 'सदस्य यशस्वीरीत्या जोडला गेला (Member added successfully)',
    data: member,
  });
}

export function listMembersHandler(req: Request, res: Response): void {
  const president = req.user!;
  const query = req.query as unknown as MemberListQuery;
  const result = MemberService.listMembers(president.organizationId, query);

  res.status(200).json({
    success: true,
    data: result.members,
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  });
}

export function getMemberHandler(req: Request<{ memberId: string }>, res: Response): void {
  const president = req.user!;
  const member = MemberService.getMemberById(president.organizationId, req.params.memberId);

  res.status(200).json({
    success: true,
    data: member,
  });
}

export function updateMemberStatusHandler(
  req: Request<{ memberId: string }, {}, UpdateMemberStatusInput>,
  res: Response
): void {
  const president = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const member = MemberService.updateMemberStatus(
    president,
    req.params.memberId,
    req.body.isActive,
    ipAddress
  );

  res.status(200).json({
    success: true,
    message: req.body.isActive
      ? 'सदस्य यशस्वीरीत्या सक्रिय केला (Member activated successfully)'
      : 'सदस्य यशस्वीरीत्या निष्क्रिय केला (Member deactivated successfully)',
    data: member,
  });
}

export function updateMemberRoleHandler(
  req: Request<{ memberId: string }, {}, UpdateMemberRoleInput>,
  res: Response
): void {
  const president = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const member = MemberService.updateMemberRole(
    president,
    req.params.memberId,
    req.body.role,
    ipAddress
  );

  res.status(200).json({
    success: true,
    message:
      member.role === 'TREASURER'
        ? 'खजिनदार नियुक्ती यशस्वीरीत्या पूर्ण झाली (Treasurer assigned successfully)'
        : 'भूमिका यशस्वीरीत्या बदलली गेली (Role updated successfully)',
    data: member,
  });
}

export function deleteMemberHandler(req: Request<{ memberId: string }>, res: Response): void {
  const president = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const result = MemberService.deleteMember(president, req.params.memberId, ipAddress);

  res.status(200).json({
    success: true,
    message: result.message,
    data: result,
  });
}

export function getMemberPinHandler(req: Request<{ memberId: string }>, res: Response): void {
  const president = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const result = MemberService.getMemberPin(president, req.params.memberId, ipAddress);

  res.status(200).json({
    success: true,
    data: result,
  });
}

