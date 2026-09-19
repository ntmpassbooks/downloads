import { z } from 'zod';

export const setBishiConfigSchema = z.object({
  monthlyAmount: z
    .number({
      required_error: 'मासिक बीसी रक्कम आवश्यक आहे (Monthly amount is required)',
      invalid_type_error: 'रक्कम संख्या स्वरूपात असावी (Amount must be a number)',
    })
    .int('रक्कम पूर्णांक असावी (Amount must be an integer)')
    .min(100, 'किमान बीसी रक्कम ₹१०० असावी (Minimum Bishi amount is ₹100)')
    .max(1000000, 'रक्कम कमाल मर्यादेपेक्षा जास्त आहे (Amount exceeds maximum limit)'),
  dueDay: z
    .number({
      required_error: 'देय दिवस आवश्यक आहे (Due day is required)',
      invalid_type_error: 'देय दिवस संख्या स्वरूपात असावा (Due day must be a number)',
    })
    .int('दिवस पूर्णांक असावा (Due day must be an integer)')
    .min(1, 'देय दिवस १ ते ३१ दरम्यान असावा (Due day must be between 1 and 31)')
    .max(31, 'देय दिवस १ ते ३१ दरम्यान असावा (Due day must be between 1 and 31)'),
});

export const generateBishiCycleSchema = z.object({
  monthYear: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'महिन्याचे स्वरूप YYYY-MM असे असावे (उदा. 2026-09)')
    .optional(),
});

export type SetBishiConfigInput = z.infer<typeof setBishiConfigSchema>;
export type GenerateBishiCycleInput = z.infer<typeof generateBishiCycleSchema>;
