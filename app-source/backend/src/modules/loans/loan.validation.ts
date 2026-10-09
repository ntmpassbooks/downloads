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
  interestRate: z
    .number({
      invalid_type_error: 'व्याज दर संख्या असावी (Interest rate must be a number)',
    })
    .min(0, 'व्याज दर ० किंवा अधिक असावा (Interest rate must be non-negative)')
    .default(0),
  interestType: z
    .enum(['FLAT', 'REDUCING_BALANCE'])
    .default('FLAT'),
  ratePeriod: z
    .enum(['MONTHLY', 'ANNUAL'])
    .default('ANNUAL'),
  tenureMonths: z
    .number({
      invalid_type_error: 'कर्ज कालावधी संख्या असावी (Tenure must be a number)',
    })
    .int('कर्ज कालावधी पूर्णांक असावी (Tenure must be an integer)')
    .min(1, 'कर्ज कालावधी किमान १ महिना असावा (Tenure must be at least 1 month)')
    .max(120, 'कर्ज कालावधी कमाल १२० महिने (१० वर्षे) असावा (Tenure maximum 120 months)')
    .default(1),
  firstDueDate: z.string().optional(),
  loanDate: z.string().optional(),
  notes: z
    .string()
    .max(250, 'टीप कमाल २५० अक्षरांची असू शकते (Notes maximum 250 characters)')
    .optional(),
});

export type CreateLoanInput = z.infer<typeof createLoanSchema>;

export const calculateLoanPreviewSchema = z.object({
  principal: z
    .number({
      required_error: 'मुद्दल रक्कम आवश्यक आहे (Principal is required)',
      invalid_type_error: 'मुद्दल रक्कम संख्या असावी (Principal must be a number)',
    })
    .int('मुद्दल रक्कम पूर्णांक असावी (Principal must be an integer)')
    .positive('मुद्दल रक्कम धन असावी (Principal must be strictly positive)'),
  interestRate: z
    .number({
      invalid_type_error: 'व्याज दर संख्या असावी (Interest rate must be a number)',
    })
    .min(0, 'व्याज दर ० किंवा अधिक असावा (Interest rate must be non-negative)')
    .default(0),
  interestType: z
    .enum(['FLAT', 'REDUCING_BALANCE'])
    .default('FLAT'),
  ratePeriod: z
    .enum(['MONTHLY', 'ANNUAL'])
    .default('ANNUAL'),
  tenureMonths: z
    .number({
      invalid_type_error: 'कालावधी संख्या असावी (Tenure must be a number)',
    })
    .int('कालावधी पूर्णांक असावी (Tenure must be an integer)')
    .min(1, 'कालावधी किमान १ महिना असावा (Tenure must be at least 1 month)')
    .max(120, 'कालावधी कमाल १२० महिने असावा (Tenure maximum 120 months)')
    .default(1),
  firstDueDate: z.string().optional(),
});

export type CalculateLoanPreviewInput = z.infer<typeof calculateLoanPreviewSchema>;

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
