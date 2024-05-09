import ChildProcess from 'node:child_process';
import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';

import Ssh2SftpClient from 'ssh2-sftp-client';

export default class SFTPCache {
  private static readonly CACHE_DIR = 'SpraxDev_Action-SpigotMC-Cache';

  private readonly host: string;
  private readonly port: number;
  private readonly username: string;
  private readonly privateKey: string;

  private readonly sftpClient = new Ssh2SftpClient();
  private readonly initPromise: Promise<void>;

  constructor(host: string, port: number, username: string, privateKey: string) {
    this.host = host;
    this.port = port;
    this.username = username;
    this.privateKey = privateKey;

    this.initPromise = this.init();
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
      await this.downloadSftpFile(remotePath, destFilePath);
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

  private async init(): Promise<void> {
    await this.sftpClient.connect({
      host: this.host,
      port: this.port,
      username: this.username,
      privateKey: this.privateKey
    });
  }

  private async ensureInit(): Promise<void> {
    await this.initPromise;
  }


  private async downloadSftpFile(remotePath: string, destFilePath: string): Promise<void> {
    if (!await this.doesScpBinaryExist()) {
      await this.sftpClient.get(remotePath, destFilePath);
      return;
    }

    const privateKeyTmpPath = await Fs.promises.mkdtemp(Path.join(Os.tmpdir(), '/'));
    try {
      await Fs.promises.writeFile(Path.join(privateKeyTmpPath, 'id'), this.privateKey + '\n', {mode: 0o600});
      await new Promise<void>((resolve, reject) => {
        const scpCommandArgs = [
          '-B', // batch mode (prevents asking for passwords or passphrases)
          '-i', Path.join(privateKeyTmpPath, 'id'),
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'UserKnownHostsFile=/dev/null',
          this.constructScpRemoteUrl(remotePath),
          Path.resolve(destFilePath)
        ];
        const process = ChildProcess.spawn('scp', scpCommandArgs, {stdio: 'inherit'});
        process.on('error', reject);
        process.on('exit', code => code === 0 ? resolve() : reject(new Error(`Exit code: ${code}`)));
      });
    } finally {
      await Fs.promises.rm(privateKeyTmpPath, {recursive: true, force: true});
    }
  }

  private async doesScpBinaryExist(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = ChildProcess.spawn('scp', ['-B'], {timeout: 5000, stdio: 'ignore'});
      process.on('error', () => resolve(false));
      process.on('exit', code => resolve(code === 1));
    });
  }

  private constructScpRemoteUrl(remotePath: string): string {
    const url = new URL('scp://');
    url.host = this.host;
    url.port = this.port.toString();
    url.pathname = remotePath;
    url.username = this.username;

    return url.toString();
  }

  private static constructRemoteCacheFilePath(version: string): string {
    return Path.join(SFTPCache.CACHE_DIR, `${version}.tar.gz`);
  }
}
