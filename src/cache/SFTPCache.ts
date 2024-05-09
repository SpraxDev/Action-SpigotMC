import Path from 'node:path';

import Ssh2SftpClient from 'ssh2-sftp-client';

export default class SFTPCache {
  private static readonly CACHE_DIR = 'SpraxDev_Action-SpigotMC-Cache';

  private readonly sftpClient = new Ssh2SftpClient();
  private readonly initPromise: Promise<void>;

  constructor(host: string, port: number, username: string, privateKey: string) {
    this.initPromise = this.init(host, port, username, privateKey);
  }

  async shutdown(): Promise<void> {
    await this.ensureInit();
    await this.sftpClient.end();
  }

  async getSizeOfCacheForVersion(version: string): Promise<number | null> {
    await this.ensureInit();

    const remotePath = SFTPCache.constructRemoteCacheFilePath(version);
    if (await this.sftpClient.exists(remotePath) !== '-') {
      return null;
    }

    const stat = await this.sftpClient.stat(remotePath);
    return stat.size;
  }

  async fetchCacheForVersion(version: string, destFilePath: string): Promise<boolean> {
    await this.ensureInit();

    const remotePath = SFTPCache.constructRemoteCacheFilePath(version);
    if (await this.sftpClient.exists(remotePath) === '-') {
      await this.sftpClient.get(remotePath, destFilePath);
      return true;
    }

    return false;
  }

  async uploadCacheForVersion(version: string, filePath: string): Promise<void> {
    await this.ensureInit();

    const remotePath = SFTPCache.constructRemoteCacheFilePath(version);
    await this.sftpClient.mkdir(Path.dirname(remotePath), true);
    await this.sftpClient.put(filePath, remotePath);
  }

  private async init(host: string, port: number, username: string, privateKey: string): Promise<void> {
    await this.sftpClient.connect({
      host,
      port,
      username,
      privateKey
    });
  }

  private async ensureInit(): Promise<void> {
    await this.initPromise;
  }

  private static constructRemoteCacheFilePath(version: string): string {
    return Path.join(SFTPCache.CACHE_DIR, `${version}.tar.gz`);
  }
}
