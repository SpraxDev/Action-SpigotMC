import Fs from 'node:fs';
import Path from 'node:path';
import SFTPCache from './SFTPCache';
import SpigotArtifactArchiver from './SpigotArtifactArchiver';

export default class SpigotArtifactCache {
  private readonly artifactArchiver = new SpigotArtifactArchiver();
  private readonly sftpCache: SFTPCache | null;

  constructor(host: string, port: number, username: string, privateKey: string, expectedHostKey: string | null) {
    if (host === '') {
      this.sftpCache = null;
    } else {
      this.sftpCache = new SFTPCache(host, port, username, privateKey, expectedHostKey);
    }
  }

  async shutdown(): Promise<void> {
    await this.sftpCache?.shutdown();
  }

  isSftpAvailable(): boolean {
    return this.sftpCache != null;
  }

  async fetchAndExtractCacheForVersionIfExists(version: string, tmpDir: string, logInfo: (msg: string) => void, logError: (msg: string) => void): Promise<boolean> {
    if (this.sftpCache == null) {
      throw new Error('Cache is not available');
    }

    const cacheTmpFile = Path.join(tmpDir, `cache-${version}`);
    try {
      const cacheFileSize = await this.sftpCache.getSizeOfCacheForVersion(version);
      if (cacheFileSize !== null) {
        logInfo(`Downloading cache for version ${version} from SFTP-Server (${SpigotArtifactCache.prettifyFileSize(cacheFileSize)})...`);
      }

      if (await this.sftpCache.fetchCacheForVersion(version, cacheTmpFile)) {
        await this.artifactArchiver.extractCacheArchive(cacheTmpFile);
        return true;
      }
    } catch (err) {
      logError(`Failed to fetch cache from SFTP-Server (version=${version}): ${err?.toString()}`);
    } finally {
      await Fs.promises.rm(cacheTmpFile, {force: true});
    }

    return false;
  }

  async createAndUploadCacheForVersion(version: string, tmpDir: string, logInfo: (msg: string) => void, logError: (msg: string) => void): Promise<boolean> {
    if (this.sftpCache == null) {
      throw new Error('Cache is not available');
    }

    const cacheTmpFile = Path.join(tmpDir, `cache-${version}`);
    try {
      await this.artifactArchiver.createCacheArchiveForVersion(version, cacheTmpFile);

      logInfo(`Uploading cache for version ${version} to SFTP-Server (${SpigotArtifactCache.prettifyFileSize((await Fs.promises.stat(cacheTmpFile)).size)})...`);
      await this.sftpCache.uploadCacheForVersion(version, cacheTmpFile);
      return true;
    } catch (err) {
      logError(`Failed to upload cache to SFTP-Server (version=${version}): ${err?.toString()}`);
      return false;
    } finally {
      await Fs.promises.rm(cacheTmpFile, {force: true});
    }
  }

  private static prettifyFileSize(bytes: number): string {
    if (bytes < 0 || !Number.isFinite(bytes)) {
      throw new Error('The given bytes need to be a positive number');
    }

    const base = 1024;
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];

    let i = Math.floor(Math.log(bytes) / Math.log(base));
    if (i < 0) {
      i = 0;
    } else if (i >= units.length) {
      i = units.length - 1;
    }

    return (bytes / Math.pow(base, i)).toFixed(i > 0 ? 2 : 0) + ' ' + units[i];
  }
}
