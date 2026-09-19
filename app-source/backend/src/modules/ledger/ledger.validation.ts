import { z } from 'zod';

export const recordCashPaymentSchema = z.object({
  amount: z
    .number({
      required_error: 'रक्कम आवश्यक आहे (Amount is required)',
      invalid_type_error: 'रक्कम संख्या असावी (Amount must be a number)',
    })
    .int('रक्कम पूर्णांक असावी (Amount must be an integer)')
    .positive('रक्कम धन असावी (Amount must be positive)'),
  notes: z
    .string()
    .max(250, 'टीप कमाल २५० अक्षरांची असू शकते (Notes maximum 250 characters)')
    .optional(),
});

export type RecordCashPaymentInput = z.infer<typeof recordCashPaymentSchema>;

export const recordVarganiContributionSchema = z.object({
  memberId: z
    .string()
    .min(1, 'सदस्य आयडी आवश्यक आहे (Member ID is required)')
    .optional(),
  bishiRecordId: z
    .string()
    .min(1, 'मासिक बीसी नोंद आयडी आवश्यक आहे (Bishi Record ID is required)')
    .optional(),
  amount: z
    .number({
      required_error: 'रक्कम आवश्यक आहे (Amount is required)',
      invalid_type_error: 'रक्कम संख्या असावी (Amount must be a number)',
    })
    .int('रक्कम पूर्णांक असावी (Amount must be an integer)')
    .positive('रक्कम शून्य किंवा ऋण असू शकत नाही (Amount must be positive)'),
  paymentMethod: z
    .enum(['CASH'], {
      invalid_type_error: 'केवळ रोख भरणा (CASH) पद्धत स्वीकारली जाते',
    })
    .default('CASH'),
  notes: z
    .string()
    .max(500, 'टीप कमाल ५०० अक्षरांची असू शकते (Notes maximum 500 characters)')
    .optional(),
  contributorName: z
    .string()
    .max(100, 'नाव कमाल १०० अक्षरांचे असू शकते (Name maximum 100 characters)')
    .optional(),
});

export type RecordVarganiContributionInput = z.infer<typeof recordVarganiContributionSchema>;
