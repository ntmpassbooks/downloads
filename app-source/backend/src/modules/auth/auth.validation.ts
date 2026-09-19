import { z } from 'zod';

export const loginSchema = z.object({
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'कृपया वैध १० अंकी मोबाईल नंबर प्रविष्ट करा (Valid 10-digit mobile number required)'),
  pin: z
    .string()
    .regex(/^\d{4,6}$/, 'कृपया ४ ते ६ अंकी पिन प्रविष्ट करा (4-6 digit numeric PIN required)'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePinSchema = z
  .object({
    currentPin: z
      .string({ required_error: 'सध्याचा PIN आवश्यक आहे (Current PIN is required)' })
      .regex(/^\d{4,6}$/, 'सध्याचा PIN ४ ते ६ अंकी असावा (Current PIN must be 4-6 digits)'),
    newPin: z
      .string({ required_error: 'नवीन PIN आवश्यक आहे (New PIN is required)' })
      .regex(/^\d{4,6}$/, 'नवीन PIN ४ ते ६ अंकी असावा (New PIN must be 4-6 digits)'),
  })
  .refine((data) => data.currentPin !== data.newPin, {
    message: 'नवीन PIN सध्याच्या PIN पेक्षा वेगळा असावा (New PIN must be different from current PIN)',
    path: ['newPin'],
  });

export type ChangePinInput = z.infer<typeof changePinSchema>;

export const registerPresidentSchema = z
  .object({
    mandalName: z
      .string({ required_error: 'मंडळाचे नाव आवश्यक आहे (Mandal name is required)' })
      .trim()
      .min(3, 'मंडळाचे नाव किमान ३ अक्षरांचे असावे (Mandal name must be at least 3 characters)')
      .max(100, 'मंडळाचे नाव १०० अक्षरांपेक्षा जास्त नसावे'),
    fullName: z
      .string({ required_error: 'अध्यक्षांचे पूर्ण नाव आवश्यक आहे (Full name is required)' })
      .trim()
      .min(2, 'अध्यक्षांचे पूर्ण नाव किमान २ अक्षरांचे असावे (Full name must be at least 2 characters)')
      .max(100, 'नाव १०० अक्षरांपेक्षा जास्त नसावे'),
    phone: z
      .string({ required_error: 'मोबाईल नंबर आवश्यक आहे (Mobile number is required)' })
      .regex(/^[6-9]\d{9}$/, 'कृपया वैध १० अंकी मोबाईल नंबर प्रविष्ट करा (Valid 10-digit mobile number required)'),
    pin: z
      .string({ required_error: 'सुरक्षा PIN आवश्यक आहे (PIN is required)' })
      .regex(/^\d{4,6}$/, 'सुरक्षा PIN ४ ते ६ अंकी असावा (PIN must be 4-6 digits)'),
    confirmPin: z
      .string({ required_error: 'PIN पुन्हा प्रविष्ट करणे आवश्यक आहे (Confirm PIN is required)' }),
    registrationNumber: z
      .string()
      .trim()
      .max(50)
      .optional(),
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: 'दोन्ही PIN समान असणे आवश्यक आहे (PIN and Confirm PIN must match)',
    path: ['confirmPin'],
  });

export type RegisterPresidentInput = z.infer<typeof registerPresidentSchema>;

