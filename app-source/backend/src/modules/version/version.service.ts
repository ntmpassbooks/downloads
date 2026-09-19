/**
 * NTM Passbook — Application Version & Update Service
 *
 * Provides authoritative version metadata, semantic version comparison,
 * and security-hardened update discovery for NTM Passbook clients.
 * Zero fake versions: defaults to the actual current build version (1.0.0).
 */

export interface AppVersionInfo {
  success: boolean;
  currentVersion: string;
  latestVersion: string;
  minimumSupportedVersion: string;
  versionCode: number;
  updateRequired: boolean;
  isMandatory: boolean;
  downloadPageUrl: string;
  releaseNotes: string;
  updateMessage: string;
}

export class VersionService {
  public static readonly CURRENT_VERSION = '1.0.0';
  public static readonly CURRENT_VERSION_CODE = 1;
  public static readonly OFFICIAL_DOWNLOAD_URL = 'https://ntmpassbooks.github.io/downloads/';

  /**
   * Compares two semantic version strings (e.g., '1.0.0', '1.0.1', '1.1.0', '2.0.0').
   * Returns:
   *  -1 if v1 < v2
   *   0 if v1 === v2
   *   1 if v1 > v2
   * Throws Error if either version string is malformed or invalid.
   */
  public static compareVersions(v1: string, v2: string): number {
    if (typeof v1 !== 'string' || typeof v2 !== 'string') {
      throw new Error('अवैध आवृत्ती क्रमांक (Invalid version format)');
    }

    const clean1 = v1.trim().replace(/^v/i, '');
    const clean2 = v2.trim().replace(/^v/i, '');

    // Strict semantic version pattern: major.minor.patch (with optional prerelease)
    const semverRegex = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
    if (!semverRegex.test(clean1) || !semverRegex.test(clean2)) {
      throw new Error('अवैध आवृत्ती क्रमांक (Invalid version format: expected X.Y.Z)');
    }

    const parseSegments = (v: string): [number, number, number] => {
      const core = v.split('-')[0];
      const parts = core.split('.').map((p) => {
        const num = parseInt(p, 10);
        if (isNaN(num) || num < 0) {
          throw new Error('अवैध आवृत्ती क्रमांक (Invalid version segment)');
        }
        return num;
      });
      return [parts[0], parts[1], parts[2]];
    };

    const [major1, minor1, patch1] = parseSegments(clean1);
    const [major2, minor2, patch2] = parseSegments(clean2);

    if (major1 !== major2) return major1 > major2 ? 1 : -1;
    if (minor1 !== minor2) return minor1 > minor2 ? 1 : -1;
    if (patch1 !== patch2) return patch1 > patch2 ? 1 : -1;

    return 0;
  }

  /**
   * Sanitizes and validates a download URL to prevent malicious redirects, javascript: schemes, or XSS.
   */
  public static sanitizeDownloadUrl(url: string): string {
    if (!url || typeof url !== 'string') {
      return VersionService.OFFICIAL_DOWNLOAD_URL;
    }

    const trimmed = url.trim();

    // Allow relative trusted paths
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
      return trimmed;
    }

    try {
      const parsed = new URL(trimmed);
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        parsed.hostname === 'ntmpassbooks.github.io'
      ) {
        return parsed.toString();
      }
    } catch {
      // Invalid URL syntax
    }

    // Default fallback to official trusted download site
    return VersionService.OFFICIAL_DOWNLOAD_URL;
  }

  /**
   * Returns authoritative application version metadata and determines if an update
   * is required or recommended for the requesting client.
   */
  public static getVersionMetadata(clientVersion?: string): AppVersionInfo {
    const latestVersion = process.env.APP_LATEST_VERSION || VersionService.CURRENT_VERSION;
    const minimumSupportedVersion =
      process.env.APP_MIN_SUPPORTED_VERSION || VersionService.CURRENT_VERSION;
    const downloadPageUrl = VersionService.sanitizeDownloadUrl(
      process.env.APP_DOWNLOAD_URL || VersionService.OFFICIAL_DOWNLOAD_URL
    );
    const releaseNotes =
      process.env.APP_RELEASE_NOTES ||
      'सुरक्षा व कार्यक्षमता सुधारणा (Security and performance updates)';
    const updateMessage = 'NTM Passbook ची नवीन आवृत्ती उपलब्ध आहे.';

    let updateRequired = false;
    let isMandatory = false;

    if (clientVersion && typeof clientVersion === 'string') {
      try {
        // If client version is lower than latest version, update is available
        updateRequired = VersionService.compareVersions(clientVersion, latestVersion) < 0;

        // If client version is lower than minimum supported version, update is mandatory
        isMandatory = VersionService.compareVersions(clientVersion, minimumSupportedVersion) < 0;
      } catch {
        // In case of malformed client version, do NOT force mandatory lock
        updateRequired = false;
        isMandatory = false;
      }
    }

    return {
      success: true,
      currentVersion: VersionService.CURRENT_VERSION,
      latestVersion,
      minimumSupportedVersion,
      versionCode: VersionService.CURRENT_VERSION_CODE,
      updateRequired,
      isMandatory,
      downloadPageUrl,
      releaseNotes,
      updateMessage,
    };
  }
}
