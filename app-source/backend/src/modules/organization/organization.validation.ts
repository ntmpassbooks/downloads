import { z } from 'zod';

export const permanentDeleteMandalSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'पिन ४ ते ६ अंकी असावा (PIN must be 4-6 digits)'),
  confirmed: z.literal(true, {
    errorMap: () => ({ message: 'पुष्टीकरण आवश्यक आहे (Explicit confirmation required)' }),
  }),
  confirmationPhrase: z.literal('मंडळ कायमचे हटवा', {
    errorMap: () => ({ message: 'कृपया अचूक पुष्टीकरण वाक्य "मंडळ कायमचे हटवा" टाईप करा (Confirmation phrase mismatch)' }),
  }),
});

export type PermanentDeleteMandalInput = z.infer<typeof permanentDeleteMandalSchema>;
