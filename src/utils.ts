import readLines from 'n-readlines';
import { spawn as spawnProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, rmSync, WriteStream } from 'node:fs';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { cpus, homedir, tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { logError, logInfo } from './index';

const packageJson = JSON.parse(readFileSync(joinPath(__dirname, '..', 'package.json'), 'utf-8'));
const userAgent = `${packageJson.name || 'Action-SpigotMC'}/${packageJson.version || 'UNKNOWN_VERSION'} (+${packageJson.homepage || 'https://github.com/SpraxDev/Action-SpigotMC'})`;

export const cpuCount = cpus().length;
export const userHomeDir = homedir();

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

export async function runCmd(cmd: string, args: string[], workingDir: string, logStreamOrFile: string | WriteStream, silent: boolean = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const closeLogStream = typeof logStreamOrFile == 'string';
    const logStream = typeof logStreamOrFile != 'string' ? logStreamOrFile :
        createWriteStream(logStreamOrFile, {encoding: 'utf-8', flags: 'a' /* append */});

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
      if (closeLogStream) {
        logStream.close();
      }

      if (code != 0) {
        return reject({err: new Error(`process exited with code ${code}`), cmd, workingDir});
      }

      resolve();
    });
  });
}

/**
 * @param url The URL to fetch the data from
 * @param dest Set to `null` to get an Buffer instead of writing it to the file system
 * @param currRedirectDepth Internally used to track how often the function has been redirected
 */
export async function downloadFile(url: string, dest: string | null, currRedirectDepth: number = 0): Promise<Buffer | void> {
  const doGetRequest = url.toLowerCase().startsWith('http://') ? httpGet : httpsGet;

  return new Promise((resolve, reject) => {
    let writeStream: WriteStream | null = null;

    const done = function (errored: boolean) {
      if (writeStream) {
        writeStream.close();
        writeStream = null;

        if (errored && dest != null) {
          rmSync(dest, {recursive: true});
        }
      }
    };

    doGetRequest(url, {
      headers: {
        'User-Agent': userAgent
      }
    }, (httpRes) => {
      if (httpRes.statusCode != 200) {
        const locHeader = httpRes.headers.location;

        // Follow redirect
        if (currRedirectDepth < 12 && locHeader &&
            (httpRes.statusCode == 301 || httpRes.statusCode == 302 || httpRes.statusCode == 303 ||
                httpRes.statusCode == 307 || httpRes.statusCode == 308)) {
          done(false);

          if (!/https?:\/\//g.test(locHeader)) {
            return reject(new Error(`Server responded with ${httpRes.statusCode} and a relative Location-Header value (${locHeader})`));
          }

          return downloadFile(locHeader, dest, ++currRedirectDepth)
              .then(resolve)
              .catch(reject);
        } else {
          done(true);

          return reject(new Error(`Server responded with ${httpRes.statusCode}`));
        }
      }

      if (dest != null) {
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
      } else {
        const chunks: Buffer[] = [];

        httpRes.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk, 'binary'));
        });

        httpRes.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      }
    })
        .on('error', (err) => {
          done(true);

          return reject(err);
        });
  });
}

export function readLastLines(file: string, lineCount: number, encoding: BufferEncoding = 'utf-8'): string[] {
  const result = [];

  const reader = new readLines(file);

  let line;
  while (line = reader.next()) {
    result.push(line.toString(encoding));

    if (result.length > lineCount) {
      result.shift();
    }
  }

  return result;
}

export function resetWorkingDir(): { base: string, cache: string, logs: string } {
  const baseDir = joinPath(tmpdir(), 'SpraxDev-Action-SpigotMC');
  const cacheDir = joinPath(baseDir, 'cache');
  const logDir = joinPath(baseDir, 'logs');

  rmSync(baseDir, {recursive: true, force: true}); // delete dir

  // create directories
  mkdirSync(cacheDir, {recursive: true});
  mkdirSync(logDir, {recursive: true});

  return {base: baseDir, cache: cacheDir, logs: logDir};
}

export function exit(code: number, msg?: string | Error): never {
  if (msg) {
    if (typeof msg == 'string') {
      logInfo(msg);
    } else {
      logError(msg);
    }
  }

  return process.exit(code);
}
