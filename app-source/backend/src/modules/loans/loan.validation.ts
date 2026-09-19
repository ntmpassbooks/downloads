import { z } from 'zod';

export const createLoanSchema = z.object({
  memberId: z
    .string({
      required_error: 'सदस्य आयडी आवश्यक आहे (Member ID is required)',
    })
    .min(1, 'सदस्य आयडी रिक्त असू शकत नाही (Member ID cannot be empty)'),
  amount: z
    .number({
      required_error: 'कर्ज रक्कम आवश्यक आहे (Loan amount is required)',
      invalid_type_error: 'कर्ज रक्कम संख्या असावी (Loan amount must be a number)',
    })
    .int('कर्ज रक्कम पूर्णांक असावी (Loan amount must be an integer)')
    .positive('कर्ज रक्कम शून्य किंवा धन असावी (Loan amount must be strictly positive)'),
  loanDate: z.string().optional(),
  notes: z
    .string()
    .max(250, 'टीप कमाल २५० अक्षरांची असू शकते (Notes maximum 250 characters)')
    .optional(),
});

export type CreateLoanInput = z.infer<typeof createLoanSchema>;

export const recordLoanRepaymentSchema = z.object({
  amount: z
    .number({
      required_error: 'परतफेड रक्कम आवश्यक आहे (Repayment amount is required)',
      invalid_type_error: 'परतफेड रक्कम संख्या असावी (Repayment amount must be a number)',
    })
    .int('परतफेड रक्कम पूर्णांक असावी (Repayment amount must be an integer)')
    .positive('परतफेड रक्कम धन असावी (Repayment amount must be strictly positive)'),
  notes: z
    .string()
    .max(250, 'टीप कमाल २५० अक्षरांची असू शकते (Notes maximum 250 characters)')
    .optional(),
});

export type RecordLoanRepaymentInput = z.infer<typeof recordLoanRepaymentSchema>;
