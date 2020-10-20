import { spawn as spawnProcess } from 'child_process';
import { createWriteStream, mkdirSync, readFileSync, rmSync, WriteStream } from 'fs';
import { join as joinPath } from 'path';
import { get as httpGet } from 'http';
import { get as httpsGet } from 'https';
import { tmpdir } from 'os';

const packageJson = JSON.parse(readFileSync(joinPath(__dirname, '..', 'package.json'), 'utf-8'));
const userAgent = `${packageJson.name || 'Action-SpigotMC'}/${packageJson.version || 'UNKNOWN_VERSION'} (+${packageJson.homepage || 'https://github.com/SpraxDev/'})`;

export function fixArgArr(arr: string[]): string[] {
  const result: string[] = [];

  for (const element of arr) {
    const newValue = element.trim();

    if (newValue) {
      result.push(newValue);
    }
  }

  return result;
}

export async function runCmd(cmd: string, args: string[], workingDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawnProcess(cmd, args, { /* shell: true, */ cwd: workingDir });

    process.stdin.on('data', (data) => {
      console.log(data.toString('utf-8'));
    });
    process.stderr.on('data', (data) => {
      console.error(data.toString('utf-8'));
    });

    process.on('close', (code) => {
      if (code != 0) return reject({ err: new Error(`process exited with code ${code}`), cmd, workingDir });

      resolve();
    });
  });
}

export async function downloadFile(url: string, dest: string): Promise<void> {
  const getURL = url.toLowerCase().startsWith('http://') ? httpGet : httpsGet;

  return new Promise((resolve, reject) => {
    let writeStream: WriteStream | null = null;

    const done = function (err: boolean) {
      if (writeStream) {
        writeStream.close();
        writeStream = null;

        if (err) {
          rmSync(dest, { recursive: true, force: true });
        }
      }
    };

    // TODO
    getURL(url, {
      headers: {
        'User-Agent': userAgent
      }
    }, (httpRes) => {
      if (httpRes.statusCode != 200) {
        done(true);

        return reject(new Error(`Server responded with ${httpRes.statusCode}`));
      }

      writeStream = createWriteStream(dest, { encoding: 'binary' })
        .on('finish', () => {
          done(false);

          return resolve();
        })
        .on('error', (err) => {
          done(true);

          return reject(err);
        });

      httpRes.pipe(writeStream);
    })
      .on('error', (err) => {
        done(true);

        return reject(err);
      });
  });
}

export function resetWorkingDir(): { base: string, cache: string } {
  const baseDir = joinPath(tmpdir(), 'SpraxDev-Action-SpigotMC');
  const cacheDir = joinPath(baseDir, 'cache');

  rmSync(baseDir, { recursive: true, force: true }); // delete dir
  mkdirSync(cacheDir, { recursive: true }); // create directories

  return { base: baseDir, cache: cacheDir };
}