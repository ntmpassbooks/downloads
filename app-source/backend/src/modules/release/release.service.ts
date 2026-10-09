import crypto from 'node:crypto';
import { env } from '../../config/env.js';

export interface TokenEntry {
  releaseVersion: string;
  clientIp: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface DownloadTokenResult {
  downloadToken: string;
  expiresInSeconds: number;
}

export interface ReleaseKeyResult {
  releaseKey: string;
  algorithm: 'AES-256-GCM';
  keyId: string;
  expiresInSeconds: number;
}

export interface EncryptedReleasePackage {
  encryptedBuffer: Buffer;
  iv: string;
  authTag: string;
  sha256: string;
  packageSize: number;
}

export class ReleaseService {
  public static readonly ALGORITHM = 'aes-256-gcm';
  public static readonly TOKEN_EXPIRY_MS = 60 * 1000; // 60 seconds TTL
  public static readonly RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
  public static readonly DEFAULT_RATE_LIMIT_MAX = 5; // Max 5 token requests per minute per IP

  private static tokenStore = new Map<string, TokenEntry>();
  private static ipRateLimits = new Map<string, RateLimitEntry>();
  private static rateLimitMax = ReleaseService.DEFAULT_RATE_LIMIT_MAX;

  /**
   * Resets in-memory token store and rate-limits (used in test fixtures).
   */
  public static resetStore(): void {
    this.tokenStore.clear();
    this.ipRateLimits.clear();
    this.rateLimitMax = this.DEFAULT_RATE_LIMIT_MAX;
  }

  /**
   * Sets custom rate limit max for testing.
   */
  public static setRateLimitMax(max: number): void {
    this.rateLimitMax = max;
  }

  /**
   * Periodically prunes expired tokens from memory to avoid resource growth.
   */
  public static pruneExpiredTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokenStore.entries()) {
      if (now > entry.expiresAt + 60_000) {
        this.tokenStore.delete(token);
      }
    }
    for (const [ip, entry] of this.ipRateLimits.entries()) {
      if (now > entry.resetAt) {
        this.ipRateLimits.delete(ip);
      }
    }
  }

  /**
   * Cryptographically derives a 32-byte (256-bit) release key for a given release version.
   * Utilizes HMAC-SHA256 keyed with the backend-only master release key.
   * Master key is never returned or leaked to clients.
   */
  public static deriveReleaseKey(releaseVersion: string): Buffer {
    if (!releaseVersion || typeof releaseVersion !== 'string') {
      throw new Error('अवैध आवृत्ती क्रमांक (Invalid release version format)');
    }
    const cleanVersion = releaseVersion.trim().toLowerCase();
    const masterKey = env.RELEASE_MASTER_KEY;
    return crypto
      .createHmac('sha256', masterKey)
      .update(`ntm-passbook-release:${cleanVersion}`)
      .digest();
  }

  /**
   * Returns derived release key as 64-character lowercase hex string.
   */
  public static deriveReleaseKeyHex(releaseVersion: string): string {
    return this.deriveReleaseKey(releaseVersion).toString('hex');
  }

  /**
   * Issues a short-lived, single-use, rate-limited release download authorization token.
   * Throws Error with message 'RATE_LIMIT_EXCEEDED' when the IP limit is reached.
   */
  public static issueDownloadToken(releaseVersion: string, clientIp: string): DownloadTokenResult {
    this.pruneExpiredTokens();

    const now = Date.now();
    const ip = clientIp || 'unknown';

    // Rate limiting check
    let rate = this.ipRateLimits.get(ip);
    if (!rate || now > rate.resetAt) {
      rate = { count: 0, resetAt: now + this.RATE_LIMIT_WINDOW_MS };
      this.ipRateLimits.set(ip, rate);
    }

    if (rate.count >= this.rateLimitMax) {
      const error = new Error('RATE_LIMIT_EXCEEDED');
      (error as any).status = 429;
      throw error;
    }

    rate.count += 1;

    // Generate 32 bytes cryptographically random hex token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = now + this.TOKEN_EXPIRY_MS;

    this.tokenStore.set(token, {
      releaseVersion: releaseVersion.trim(),
      clientIp: ip,
      createdAt: now,
      expiresAt,
      used: false,
    });

    return {
      downloadToken: token,
      expiresInSeconds: Math.floor(this.TOKEN_EXPIRY_MS / 1000),
    };
  }

  /**
   * Validates and single-use consumes a download token, delivering the ephemeral release key.
   * Rejects if token is missing, expired, already consumed (replay attack), or version mismatched.
   */
  public static consumeKey(downloadToken: string, releaseVersion: string): ReleaseKeyResult {
    this.pruneExpiredTokens();

    if (!downloadToken || typeof downloadToken !== 'string') {
      const err = new Error('INVALID_TOKEN');
      (err as any).status = 401;
      throw err;
    }

    const entry = this.tokenStore.get(downloadToken);
    if (!entry) {
      const err = new Error('INVALID_TOKEN');
      (err as any).status = 401;
      throw err;
    }

    const now = Date.now();

    // Replay attack defense: single-use check
    if (entry.used) {
      const err = new Error('TOKEN_ALREADY_USED');
      (err as any).status = 403;
      throw err;
    }

    // Expiry check
    if (now > entry.expiresAt) {
      const err = new Error('TOKEN_EXPIRED');
      (err as any).status = 401;
      throw err;
    }

    // Version mismatch check
    if (entry.releaseVersion !== releaseVersion.trim()) {
      const err = new Error('VERSION_MISMATCH');
      (err as any).status = 400;
      throw err;
    }

    // Mark as consumed immediately (Atomic replay protection)
    entry.used = true;

    const releaseKeyHex = this.deriveReleaseKeyHex(releaseVersion);

    return {
      releaseKey: releaseKeyHex,
      algorithm: 'AES-256-GCM',
      keyId: `k_${releaseVersion.trim()}`,
      expiresInSeconds: Math.floor(this.TOKEN_EXPIRY_MS / 1000),
    };
  }

  /**
   * Encrypts a release artifact buffer into standard AES-256-GCM AEAD package format:
   * [12 bytes IV] || [Ciphertext (N bytes)] || [16 bytes Authentication Tag]
   * Compatible directly with browser Web Crypto SubtleCrypto.decrypt.
   */
  public static encryptReleaseArtifact(
    plaintextBuffer: Buffer,
    releaseVersion: string
  ): EncryptedReleasePackage {
    if (!plaintextBuffer || plaintextBuffer.length === 0) {
      throw new Error('Plaintext artifact buffer cannot be empty');
    }

    const key = this.deriveReleaseKey(releaseVersion);
    const iv = crypto.randomBytes(12); // Standard 96-bit GCM Nonce
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag(); // Standard 128-bit tag

    // AEAD Concatenation: IV (12B) || Ciphertext || AuthTag (16B)
    const encryptedBuffer = Buffer.concat([iv, ciphertext, authTag]);

    const sha256 = crypto
      .createHash('sha256')
      .update(plaintextBuffer)
      .digest('hex')
      .toUpperCase();

    return {
      encryptedBuffer,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      sha256,
      packageSize: encryptedBuffer.length,
    };
  }

  /**
   * Decrypts an AES-256-GCM AEAD package format buffer:
   * Extracts IV (first 12 bytes), AuthTag (last 16 bytes), Ciphertext (middle bytes).
   * Verifies authenticated tag integrity; throws on any tampering or corrupt data.
   */
  public static decryptReleaseArtifact(
    packagedBuffer: Buffer,
    releaseVersion: string
  ): Buffer {
    if (!packagedBuffer || packagedBuffer.length < 28) {
      throw new Error('अवैध एन्क्रिप्टेड पॅकेज आकार (Encrypted package buffer too short: minimum 28 bytes required)');
    }

    const iv = packagedBuffer.subarray(0, 12);
    const authTag = packagedBuffer.subarray(packagedBuffer.length - 16);
    const ciphertext = packagedBuffer.subarray(12, packagedBuffer.length - 16);

    const key = this.deriveReleaseKey(releaseVersion);
    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted;
  }
}
