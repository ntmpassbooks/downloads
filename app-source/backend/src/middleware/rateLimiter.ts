import rateLimit from 'express-rate-limit';

// Rate limiter for login endpoints: max 10 attempts per 15 minutes per IP
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: 'अनेक अयशस्वी प्रयत्न झाले आहेत. कृपया १५ मिनिटांनंतर पुन्हा प्रयत्न करा. (Too many login attempts. Please try again later.)',
  },
});

// General API rate limiter: max 300 requests per 15 minutes
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: 'अतिशय जास्त विनंत्या पाठवल्या गेल्या आहेत. कृपया थोड्या वेळाने प्रयत्न करा. (Too many requests.)',
  },
});

// Dedicated rate limiter for secure PIN viewing: max 10 requests per 15 minutes per IP
export const pinViewRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: 'अतिशय जास्त पिन तपासणीचे प्रयत्न झाले आहेत. कृपया १५ मिनिटांनंतर पुन्हा प्रयत्न करा. (Too many PIN view attempts. Please try again later.)',
  },
});

