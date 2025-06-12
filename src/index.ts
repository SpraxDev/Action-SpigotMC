import * as ActionsCore from '@actions/core';
import Async from 'async';
import FsExtra from 'fs-extra';
import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';
import XmlJs from 'xml-js';
import SpigotArtifactCache from './cache/SpigotArtifactCache';
import {downloadFile, exit, fixArgArr, isNumeric, readLastLines, resetWorkingDir, runCmd} from './utils';

const supportedBuildTools: { [key: string]: { url: string } } = {
  spigotmc: {
    url: 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar'
  }
};

/* GitHub Actions inputs */
const buildToolProvider: string = (ActionsCore.getInput('buildToolProvider') || 'SpigotMC').toLowerCase();
let versions: string[] = fixArgArr((ActionsCore.getInput('versions') || 'latest').toLowerCase().split(','));
const generateSrc: boolean = ActionsCore.getInput('generateSrc') == 'true';
const generateDoc: boolean = ActionsCore.getInput('generateDoc') == 'true';
const disableJavaCheck: boolean = ActionsCore.getInput('disableJavaCheck') == 'true';
const remapped: boolean = ActionsCore.getInput('remapped') == 'true';
const finalJarOutputDir: string = ActionsCore.getInput('finalJarOutputDir') || '';

const forceRun: boolean = ActionsCore.getInput('forceRun') == 'true';
const threadCount: number = isNumeric(ActionsCore.getInput('threads')) ? parseInt(ActionsCore.getInput('threads'), 10) : Os.cpus().length;

const sftpCacheHost: string = ActionsCore.getInput('sftpCacheHost') || '';
const sftpCachePort: number = isNumeric(ActionsCore.getInput('sftpCachePort')) ? parseInt(ActionsCore.getInput('sftpCachePort'), 10) : 22;
const sftpCacheUser: string = ActionsCore.getInput('sftpCacheUser') || '';
const sftpCachePrivateKey: string = ActionsCore.getInput('sftpCachePrivateKey') || '';
const sftpCacheExpectedHostKey: string | null = ActionsCore.getInput('sftpCacheExpectedHostKey')?.trim() || null;

const workingDir = resetWorkingDir();
const appLogFile = Path.join(workingDir.logs, 'SpraxDev_Actions-SpigotMC.log');
const appLogStream = Fs.createWriteStream(appLogFile, {encoding: 'utf-8', flags: 'a' /* append */});

let spigotArtifactCache: SpigotArtifactCache;
const requestedVersionToArtifactVersionMap = new Map<string, string>();

async function run(): Promise<{ code: number, msg?: string }> {
  spigotArtifactCache = new SpigotArtifactCache(sftpCacheHost, sftpCachePort, sftpCacheUser, sftpCachePrivateKey, sftpCacheExpectedHostKey);
  if (spigotArtifactCache.isSftpAvailable()) {
    logInfo('SFTP-Cache is configured and will be used');
  } else {
    logInfo('SFTP-Cache is not configured and will not be used');
  }

  return new Promise(async (resolve, reject): Promise<void> => {
    try {
      if (versions.length == 0) return resolve({code: 0, msg: 'No version(s) provided to build'});

      if (!Object.keys(supportedBuildTools).includes(buildToolProvider)) {
        return reject(new Error(`'${buildToolProvider}' is not a valid BuildTool-Provider (${Object.keys(supportedBuildTools).join(', ')})`));
      }

      if (!forceRun) {
        versions = await removeExistingVersionsAndRestoreFromSftpCacheIfPossible(versions, remapped, (ver, jarPath) => {
          logInfo(`Skipping version '${ver}' because it has been found in the local maven repository: ${jarPath}`);
        });

        if (versions.length == 0) return resolve({code: 0, msg: 'No new versions to build'});
      }

      const buildTool = supportedBuildTools[buildToolProvider];

      logInfo('Installed Java-Version:');
      await runCmd('java', ['-version'], workingDir.base, appLogStream);

      logInfo(`\nDownloading '${buildTool.url}'...`);
      await downloadFile(buildTool.url, Path.join(workingDir.cache, 'BuildTools.jar'));

      const gotTemplateDirectory = versions.length != 1;
      const buildToolsArgs = ['-jar', 'BuildTools.jar', '--compile', 'Spigot', '--nogui'];

      if (generateSrc) {
        buildToolsArgs.push('--generate-source');
      }

      if (generateDoc) {
        buildToolsArgs.push('--generate-docs');
      }

      if (disableJavaCheck) {
        buildToolsArgs.push('--disable-java-check');
      }

      if (remapped) {
        buildToolsArgs.push('--remapped');
      }

      if (finalJarOutputDir) {
        const outputDir = Path.isAbsolute(finalJarOutputDir) ? finalJarOutputDir : Path.resolve(finalJarOutputDir);
        if (!Fs.existsSync(outputDir)) {
          Fs.mkdirSync(outputDir, {recursive: true});
        }

        buildToolsArgs.push('--output-dir');
        buildToolsArgs.push(Path.isAbsolute(finalJarOutputDir) ? finalJarOutputDir : Path.resolve(finalJarOutputDir));
      }

      const tasks = [];
      for (const ver of versions) {
        tasks.push(async (): Promise<void> => {
          return new Promise(async (resolveTask, rejectTask): Promise<void> => {
            const start = Date.now();

            const logFile = Path.join(workingDir.logs, `${ver}.log`);

            logInfo(`Building version '${ver}'...`);

            // If there is only one version to build, the cache directory is used instead of copying it first
            const versionDir = gotTemplateDirectory ? Path.join(workingDir.base, `${ver}`) : workingDir.cache;

            if (gotTemplateDirectory) {
              await FsExtra.copy(workingDir.cache, versionDir);
            }

            try {
              // set to silent because multiple builds can run at once
              await runCmd('java', [...buildToolsArgs, '--rev', ver], versionDir, logFile, true);

              if (gotTemplateDirectory) {
                Fs.rmSync(versionDir, {recursive: true}); // delete our task dir
              }

              const end = Date.now();

              logInfo(`Finished '${ver}' (${requestedVersionToArtifactVersionMap.get(ver)}) in ${((end - start) / 60_000).toFixed(2)} minutes`);

              if (spigotArtifactCache.isSftpAvailable() && requestedVersionToArtifactVersionMap.has(ver)) {
                const artifactVersion = requestedVersionToArtifactVersionMap.get(ver)!;
                if (await spigotArtifactCache.createAndUploadCacheForVersion(artifactVersion, workingDir.cache, logInfo, logError)) {
                  logInfo(`Uploaded cache for version '${ver}' (${artifactVersion}) to SFTP-Server`);
                }
              }

              resolveTask();
            } catch (err: any) {
              logInfo(`An error occurred while building '${ver}'`);
              logError(err);

              logError(`\nPrinting last 30 lines from '${Path.resolve(logFile)}':`);

              for (const line of readLastLines(logFile, 30)) {
                logError(line);
              }

              rejectTask(err);
            }
          });
        });
      }

      Async.parallelLimit(tasks, threadCount, (err) => {
        if (err) return reject(err);

        resolve({code: 0});
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function removeExistingVersionsAndRestoreFromSftpCacheIfPossible(versionArr: string[], remapped: boolean, onExist: (ver: string, jarPath: string) => void): Promise<string[]> {
  return new Promise(async (resolve, _reject): Promise<void> => {
    const result = [];

    for (const ver of versionArr) {
      let skipVersion = false;
      let versionToCheck: string | null = ver != 'latest' ? ver : null;

      try {
        const verJsonBuff = await downloadFile(`https://hub.spigotmc.org/versions/${ver}.json`, null);
        const verJson = verJsonBuff instanceof Buffer ? JSON.parse(verJsonBuff.toString('utf-8')) : null;
        const bukkitRef: undefined | string = verJson?.refs?.Bukkit;

        if (bukkitRef) {
          const verPomBuff = await downloadFile(`https://hub.spigotmc.org/stash/projects/SPIGOT/repos/bukkit/raw/pom.xml?at=${bukkitRef}`, null);

          if (verPomBuff instanceof Buffer) {
            const result = XmlJs.xml2js(verPomBuff.toString('utf-8'), {
              compact: true,
              ignoreComment: true,
              ignoreAttributes: true
            }) as any;

            versionToCheck = result.project?.version?._text;
            if (versionToCheck != null) {
              requestedVersionToArtifactVersionMap.set(ver, versionToCheck);
            }
          }
        }
      } catch (err: any) {
        logError(err);
      }

      const jarPath = Path.resolve(Path.join(Os.homedir(), `/.m2/repository/org/spigotmc/spigot/${versionToCheck}/spigot-${versionToCheck}${remapped ? '-remapped-mojang' : ''}.jar`));
      if (versionToCheck) {
        skipVersion = Fs.existsSync(jarPath);
      }

      if (!skipVersion && spigotArtifactCache.isSftpAvailable()) {
        if (await spigotArtifactCache.fetchAndExtractCacheForVersionIfExists(versionToCheck ?? ver, workingDir.cache, logInfo, logError)) {
          logInfo(`Restored version '${versionToCheck ?? ver}' (${ver}) from SFTP-Cache`);
          skipVersion = Fs.existsSync(jarPath);
        } else {
          logInfo(`Version '${versionToCheck ?? ver}' (${ver}) not found in SFTP-Cache`);
        }
      }

      if (skipVersion) {
        onExist(ver, jarPath);
      } else {
        result.push(ver);
      }
    }

    resolve(result);
  });
}

export function logInfo(msg?: string): void {
  console.log(msg);
  appLogStream.write(msg + '\n');
}

export function logError(msg?: string | object): void {
  if (typeof msg != 'string') {
    msg = JSON.stringify(msg, null, 2);
  }

  console.error(msg);
  appLogStream.write(msg + '\n');
}

let exitCode = 2;
let exitMessage: string | Error | undefined;

run()
  .then((result) => {
    exitCode = result.code;
    exitMessage = result.msg;
  })
  .catch((err) => {
    exitCode = 1;
    exitMessage = err;
  })
  .finally(async () => {
    await spigotArtifactCache?.shutdown();
    exit(exitCode, exitMessage);
  });
