import { spawn as spawnProcess } from 'child_process';
import { join as joinPath } from 'path';
import { get as httpGet } from 'http';
import { get as httpsGet } from 'https';
import { cpus, tmpdir } from 'os';
import { createWriteStream, mkdirSync, readFileSync, rmdirSync, WriteStream } from 'fs';

const packageJson = JSON.parse(readFileSync(joinPath(__dirname, '..', 'package.json'), 'utf-8'));
const userAgent = `${packageJson.name || 'Action-SpigotMC'}/${packageJson.version || 'UNKNOWN_VERSION'} (+${packageJson.homepage || 'https://github.com/SpraxDev/'})`;

export const cpuCount = cpus().length;

export function fixArgArr(arr: string[]): string[] {
  const result: string[] = [];

  for (const element of arr) {
    const newValue = element.trim();

    if (newValue && !result.includes(newValue)) {
      result.push(newValue);
    }
  }

  return result;
}

export function isNumeric(str: string): boolean {
  return /^[0-9]+$/.test(str);
}

export async function runCmd(cmd: string, args: string[], workingDir: string, logFile: string, silent: boolean = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const logStream = createWriteStream(logFile, {encoding: 'utf-8', flags: 'a'});  // Use UTF-8 and append when file exists
    const runningProcess = spawnProcess(cmd, args, {shell: true, cwd: workingDir, env: process.env});

    runningProcess.stdout.on('data', (data) => {
      logStream.write(data);

      if (!silent) {
        process.stdout.write(data); // Not using console.log to prevent '\n\n'
      }
    });
    runningProcess.stderr.on('data', (data) => {
      logStream.write(data);

      if (!silent) {
        process.stderr.write(data); // Not using console.error to prevent '\n\n'
      }
    });

    runningProcess.on('close', (code) => {
      logStream.close();

      if (code != 0) {
        return reject({err: new Error(`process exited with code ${code}`), cmd, workingDir});
      }

      resolve();
    });
  });
}

export async function downloadFile(url: string, dest: string, currRedirectDepth: number = 0): Promise<void> {
  const doGetRequest = url.toLowerCase().startsWith('http://') ? httpGet : httpsGet;

  return new Promise((resolve, reject) => {
    let writeStream: WriteStream | null = null;

    const done = function (errored: boolean) {
      if (writeStream) {
        writeStream.close();
        writeStream = null;

        if (errored) {
          rmdirSync(dest, {recursive: true});
        }
      }
    };

    doGetRequest(url, {
      headers: {
        'User-Agent': userAgent
      }
    }, (httpRes) => {
      if (httpRes.statusCode != 200) {
        // Follow redirect
        if (currRedirectDepth < 12 &&
            (httpRes.statusCode == 301 || httpRes.statusCode == 302 || httpRes.statusCode == 303 ||
                httpRes.statusCode == 307 || httpRes.statusCode == 308)) {
          return downloadFile(url, dest, ++currRedirectDepth)
              .then(resolve)
              .catch(reject);
        } else {
          done(true);

          return reject(new Error(`Server responded with ${httpRes.statusCode}`));
        }
      }

      writeStream = createWriteStream(dest, {encoding: 'binary'})
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

export function resetWorkingDir(): { base: string, cache: string, logs: string } {
  const baseDir = joinPath(tmpdir(), 'SpraxDev-Action-SpigotMC');
  const cacheDir = joinPath(baseDir, 'cache');
  const logDir = joinPath(baseDir, 'logs');

  rmdirSync(baseDir, {recursive: true}); // delete dir

  // create directories
  mkdirSync(cacheDir, {recursive: true});
  mkdirSync(logDir);

  return {base: baseDir, cache: cacheDir, logs: logDir};
}

export function exit(code: number, msg?: string | Error): never {
  if (msg) {
    if (typeof msg == 'string') {
      console.log(msg);
    } else {
      console.error(msg);
    }
  }

  return process.exit(code);
}