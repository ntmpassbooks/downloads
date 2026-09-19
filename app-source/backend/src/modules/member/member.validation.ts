import { z } from 'zod';

export const createMemberSchema = z.object({
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'कृपया वैध १० अंकी मोबाईल नंबर प्रविष्ट करा (Valid 10-digit mobile number required)'),
  fullName: z
    .string()
    .trim()
    .min(2, 'नाव किमान २ अक्षरांचे असणे आवश्यक आहे (Name must be at least 2 characters)')
    .max(100, 'नाव १०० अक्षरांपेक्षा मोठे नसावे (Name cannot exceed 100 characters)'),
  initialPin: z
    .string()
    .regex(/^\d{4,6}$/, 'सुरक्षा पिन ४ ते ६ अंकी असावा (PIN must be 4-6 digits)')
    .optional()
    .default('1234'),
  role: z
    .enum(['MEMBER', 'TREASURER'], {
      errorMap: () => ({
        message: 'भूमिका केवळ सदस्य (MEMBER) किंवा खजिनदार (TREASURER) असू शकते (Role can only be MEMBER or TREASURER)',
      }),
    })
    .optional()
    .default('MEMBER'),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const memberListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  status: z.enum(['all', 'active', 'inactive']).optional().default('all'),
  search: z.string().trim().optional(),
});

export type MemberListQuery = z.infer<typeof memberListQuerySchema>;

export const updateMemberStatusSchema = z.object({
  isActive: z.boolean({
    required_error: 'स्थिती (isActive) देणे बंधनकारक आहे (isActive boolean is required)',
  }),
});

export type UpdateMemberStatusInput = z.infer<typeof updateMemberStatusSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(['TREASURER', 'MEMBER'], {
    errorMap: () => ({
      message: 'भूमिका केवळ खजिनदार (TREASURER) किंवा सदस्य (MEMBER) असू शकते (Role can only be TREASURER or MEMBER)',
    }),
  }),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
