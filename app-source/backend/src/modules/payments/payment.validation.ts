import { z } from 'zod';

export const upsertPaymentConfigSchema = z
  .object({
    bank: z
      .string({ required_error: 'बँक निवडणे आवश्यक आहे (Bank selection required)' })
      .trim()
      .toUpperCase(),
    accountName: z
      .string({ required_error: 'खातेदार / मंडळाचे नाव आवश्यक आहे (Account name required)' })
      .min(2, 'खातेदाराचे नाव किमान २ अक्षरांचे असावे')
      .max(100, 'खातेदाराचे नाव कमाल १०० अक्षरांचे असावे')
      .trim(),
    accountType: z.enum(['CURRENT', 'SAVINGS'], {
      required_error: 'खात्याचा प्रकार (चालू खाते किंवा बचत खाते) निवडणे अनिवार्य आहे (Account Type is required)',
      invalid_type_error: 'अवैध खाते प्रकार. केवळ चालू खाते (CURRENT) किंवा बचत खाते (SAVINGS) निवडता येईल',
    }),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{9,18}$/, 'खाते क्रमांक ९ ते १८ अंकी असावा (Account number must be 9-18 digits)')
      .optional()
      .nullable(),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'अवैध आयएफएससी कोड स्वरूप (उदा. SBIN0001234, ICIC0000001)')
      .optional()
      .nullable(),
    branch: z.string().max(100, 'शाखेचे नाव कमाल १०० अक्षरांचे असावे').trim().optional().nullable(),
    upiId: z
      .string()
      .trim()
      .regex(/^[\w.-]+@[\w.-]+$/, 'अवैध UPI आयडी स्वरूप (उदा. mandal@sbi किंवा mandal@icici)')
      .optional()
      .nullable(),
    merchantId: z
      .string()
      .max(100, 'मर्चंट किंवा कॉर्पोरेट आयडी कमाल १०० अक्षरांचे असावे')
      .trim()
      .optional()
      .nullable(),
    apiSecret: z
      .string()
      .min(8, 'बँक API सिक्रेट की किमान ८ अक्षरांची असावी')
      .max(255)
      .trim()
      .optional()
      .nullable(),
    notes: z.string().max(255).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    // Explicit rejection of Bank of India (BOI)
    if (
      data.bank === 'BOI' ||
      data.bank === 'BANK OF INDIA' ||
      data.bank.includes('BANKOFINDIA')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bank'],
        message: 'Bank of India (BOI) या प्रणालीमध्ये समर्थित नाही. कृपया SBI, ICICI, Axis, AU किंवा Kotak बँक निवडा.',
      });
      return;
    }

    const validBanks = ['SBI', 'ICICI', 'AXIS', 'AU', 'KOTAK', 'MOCK'];
    if (!validBanks.includes(data.bank)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bank'],
        message: `असमर्थित बँक निवडली (${data.bank}). केवळ SBI, ICICI, Axis, AU Small Finance आणि Kotak Mahindra बँक समर्थित आहेत.`,
      });
    }
  });

export const updatePaymentConfigStatusSchema = z.object({
  status: z.enum(['NOT_CONFIGURED', 'PENDING', 'ACTIVE', 'DISABLED'], {
    errorMap: () => ({ message: 'अवैध स्थिती निवडली (Invalid payment status)' }),
  }),
});

export const createPaymentOrderSchema = z.object({
  bishiRecordId: z
    .string({ required_error: 'मासिक बीसी नोंद आयडी आवश्यक आहे (bishiRecordId required)' })
    .uuid('अवैध बीसी नोंद आयडी स्वरूप (Invalid UUID)'),
});

export const verifyPaymentSchema = z.object({
  orderId: z
    .string({ required_error: 'ऑर्डर आयडी आवश्यक आहे (orderId required)' })
    .uuid('अवैध ऑर्डर आयडी स्वरूप (Invalid UUID)'),
  providerPaymentId: z
    .string({ required_error: 'पेमेंट आयडी आवश्यक आहे (providerPaymentId required)' })
    .min(4, 'अवैध पेमेंट आयडी'),
  providerSignature: z
    .string({ required_error: 'पडताळणी स्वाक्षरी आवश्यक आहे (providerSignature required)' })
    .min(8, 'अवैध स्वाक्षरी (Invalid signature)'),
});

export type UpsertPaymentConfigInput = z.infer<typeof upsertPaymentConfigSchema>;
export type UpdatePaymentConfigStatusInput = z.infer<typeof updatePaymentConfigStatusSchema>;
export type CreatePaymentOrderInput = z.infer<typeof createPaymentOrderSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
