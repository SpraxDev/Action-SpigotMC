import NReadLines from 'n-readlines';
import ChildProcess from 'node:child_process';
import Fs from 'node:fs';
import Http from 'node:http';
import Https from 'node:https';
import Os from 'node:os';
import Path from 'node:path';
import {logError, logInfo} from './index';

const packageJson = JSON.parse(Fs.readFileSync(Path.join(__dirname, '..', 'package.json'), 'utf-8'));
const userAgent = `${packageJson.name || 'Action-SpigotMC'}/${packageJson.version || 'UNKNOWN_VERSION'} (+${packageJson.homepage || 'https://github.com/SpraxDev/Action-SpigotMC'})`;

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

export async function runCmd(cmd: string, args: string[], workingDir: string, logStreamOrFile: string | Fs.WriteStream, silent: boolean = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const closeLogStream = typeof logStreamOrFile == 'string';
    const logStream = typeof logStreamOrFile != 'string' ? logStreamOrFile :
      Fs.createWriteStream(logStreamOrFile, {encoding: 'utf-8', flags: 'a'});

    const runningProcess = ChildProcess.spawn(cmd, args, {shell: true, cwd: workingDir, env: process.env});

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
  const doGetRequest = url.toLowerCase().startsWith('http://') ? Http.get : Https.get;

  return new Promise((resolve, reject) => {
    let writeStream: Fs.WriteStream | null = null;

    const done = function (errored: boolean) {
      if (writeStream) {
        writeStream.close();
        writeStream = null;

        if (errored && dest != null) {
          Fs.rmSync(dest, {recursive: true});
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
        writeStream = Fs.createWriteStream(dest, {encoding: 'binary'})
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

  const reader = new NReadLines(file);

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
  const baseDir = Path.join(Os.tmpdir(), 'SpraxDev-Action-SpigotMC');
  const cacheDir = Path.join(baseDir, 'cache');
  const logDir = Path.join(baseDir, 'logs');

  Fs.rmSync(baseDir, {recursive: true, force: true}); // delete dir

  // create directories
  Fs.mkdirSync(cacheDir, {recursive: true});
  Fs.mkdirSync(logDir, {recursive: true});

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
