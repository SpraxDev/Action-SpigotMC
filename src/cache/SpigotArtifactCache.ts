import Fs from 'node:fs';
import Path from 'node:path';
import {prettifyFileSize} from '../utils';
import SFTPCache from './SFTPCache';
import SpigotArtifactArchiver from './SpigotArtifactArchiver';

export default class SpigotArtifactCache {
  private readonly artifactArchiver = new SpigotArtifactArchiver();
  private readonly sftpCache: SFTPCache | null;

  constructor(host: string, port: number, username: string, privateKey: string) {
    if (host === '') {
      this.sftpCache = null;
    } else {
      this.sftpCache = new SFTPCache(host, port, username, privateKey);
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
        logInfo(`Downloading cache for version ${version} from SFTP-Server (${prettifyFileSize(cacheFileSize)})...`);
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

      logInfo(`Uploading cache for version ${version} to SFTP-Server (${prettifyFileSize((await Fs.promises.stat(cacheTmpFile)).size)})...`);
      await this.sftpCache.uploadCacheForVersion(version, cacheTmpFile);
      return true;
    } catch (err) {
      logError(`Failed to upload cache to SFTP-Server (version=${version}): ${err?.toString()}`);
      return false;
    } finally {
      await Fs.promises.rm(cacheTmpFile, {force: true});
    }
  }
}
