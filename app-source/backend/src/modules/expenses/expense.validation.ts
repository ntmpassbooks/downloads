import { z } from 'zod';
import { EXPENSE_CATEGORIES } from './expense.types.js';

export const createExpenseSchema = z.object({
  amount: z
    .number({
      required_error: 'खर्चाची रक्कम आवश्यक आहे (Amount is required)',
      invalid_type_error: 'रक्कम संख्यात्मक असावी (Amount must be a number)',
    })
    .int('रक्कम पूर्णांक असावी (Amount must be an integer)')
    .positive('रक्कम शून्यपेक्षा जास्त असणे आवश्यक आहे (Amount must be positive)')
    .max(10_000_000, 'रक्कम मर्यादेत असावी (Amount exceeds allowed limit)'),

  category: z.enum(EXPENSE_CATEGORIES, {
    errorMap: () => ({
      message: 'अवैध खर्च वर्ग (Invalid expense category. Must be one of the authorized Marathi categories)',
    }),
  }),

  reason: z
    .string({
      required_error: 'खर्चाचे कारण आवश्यक आहे (Reason/description is required)',
    })
    .trim()
    .min(2, 'खर्चाचे कारण किमान २ अक्षरे असावे (Reason must be at least 2 characters)')
    .max(255, 'खर्चाचे कारण २५५ अक्षरांपेक्षा कमी असावे (Reason must not exceed 255 characters)'),

  expenseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, 'अवैध दिनांक स्वरूप (Invalid date format, expected YYYY-MM-DD)')
    .optional(),

  notes: z
    .string()
    .trim()
    .max(255, 'टीप २५५ अक्षरांपेक्षा कमी असावी (Notes must not exceed 255 characters)')
    .optional(),
});

export const expenseQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
});
