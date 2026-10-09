import { z } from 'zod';

/**
 * Validation schema for requesting a release download authorization token.
 * POST /api/release/download-token
 */
export const downloadTokenSchema = z.object({
  releaseVersion: z
    .string()
    .min(1, 'आवृत्ती क्रमांक आवश्यक आहे (Release version is required)')
    .max(32, 'आवृत्ती क्रमांक ३२ वर्णांपेक्षा जास्त असू नये (Version string cannot exceed 32 characters)')
    .regex(/^[a-zA-Z0-9.\-_+]+$/, 'अवैध आवृत्ती स्वरूप (Invalid version format: only alphanumeric, dots, dashes allowed)'),
});

/**
 * Validation schema for retrieving ephemeral release key.
 * POST /api/release/key
 */
export const releaseKeySchema = z.object({
  downloadToken: z
    .string()
    .min(16, 'डाउनलोड टोकन आवश्यक आहे (Valid download token is required)')
    .max(128, 'टोकन खूप मोठे आहे (Download token exceeds maximum length)'),
  releaseVersion: z
    .string()
    .min(1, 'आवृत्ती क्रमांक आवश्यक आहे (Release version is required)')
    .max(32, 'आवृत्ती क्रमांक ३२ वर्णांपेक्षा जास्त असू नये (Version string cannot exceed 32 characters)')
    .regex(/^[a-zA-Z0-9.\-_+]+$/, 'अवैध आवृत्ती स्वरूप (Invalid version format)'),
});
