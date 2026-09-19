import crypto from 'node:crypto';
import { env } from '../../config/env.js';

export interface EncryptedPinData {
  encryptedPin: string;
  pinIv: string;
  pinAuthTag: string;
  pinKeyVersion: number;
}

export class PinEncryptionService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly CURRENT_KEY_VERSION = 1;

  /**
   * Derives a 32-byte (256-bit) encryption key from the environment PIN_ENCRYPTION_KEY.
   */
  private static getEncryptionKey(): Buffer {
    return crypto.createHash('sha256').update(env.PIN_ENCRYPTION_KEY).digest();
  }

  /**
   * Encrypts a plaintext PIN using AES-256-GCM.
   * Generates a fresh cryptographically random 12-byte IV per encryption
   * and produces a 16-byte authentication tag to guarantee integrity.
   */
  public static encryptPin(pin: string): EncryptedPinData {
    if (!pin || typeof pin !== 'string') {
      throw new Error('PIN must be a non-empty string');
    }

    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    let encrypted = cipher.update(pin, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return {
      encryptedPin: encrypted,
      pinIv: iv.toString('hex'),
      pinAuthTag: authTag,
      pinKeyVersion: this.CURRENT_KEY_VERSION,
    };
  }

  /**
   * Decrypts an AES-256-GCM encrypted PIN with authentication tag verification.
   * Throws an error if ciphertext or tag was tampered with or corrupted.
   */
  public static decryptPin(encryptedPin: string, pinIv: string, pinAuthTag: string): string {
    if (!encryptedPin || !pinIv || !pinAuthTag) {
      throw new Error('Missing encrypted PIN data or parameters');
    }

    const key = this.getEncryptionKey();
    const iv = Buffer.from(pinIv, 'hex');
    const authTag = Buffer.from(pinAuthTag, 'hex');

    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedPin, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
