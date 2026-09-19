import { z } from 'zod';

export const monthlyStatementQuerySchema = z.object({
  monthYear: z
    .string({
      required_error: 'महिना व वर्ष आवश्यक आहे (Month and year is required)',
      invalid_type_error: 'अवैध महिना प्रकार (Invalid month type)',
    })
    .regex(
      /^\d{4}-(0[1-9]|1[0-2])$/,
      'अवैध महिना फॉरमॅट. कृपया YYYY-MM फॉरमॅट वापरा (Invalid month format. Must be YYYY-MM)'
    ),
});

export type MonthlyStatementQuery = z.infer<typeof monthlyStatementQuerySchema>;

export const auditExportQuerySchema = z.object({
  monthYear: z
    .string()
    .regex(
      /^\d{4}-(0[1-9]|1[0-2])$/,
      'अवैध महिना फॉरमॅट. कृपया YYYY-MM फॉरमॅट वापरा (Invalid month format. Must be YYYY-MM)'
    )
    .optional(),
  format: z.enum(['csv']).optional().default('csv'),
});

export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;
