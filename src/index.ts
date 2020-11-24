import * as core from '@actions/core';
import { parallelLimit } from 'async';
import { createWriteStream, existsSync, rmdirSync } from 'fs';
import { copy } from 'fs-extra';
import { join as joinPath, resolve as resolvePath } from 'path';
import { xml2js } from 'xml-js';

import {
  cpuCount,
  downloadFile,
  exit,
  fixArgArr,
  isNumeric,
  readLastLines,
  resetWorkingDir,
  runCmd,
  userHomeDir
} from './utils';

const supportedBuildTools: { [key: string]: { url: string, prepareArgs: string[] } } = {
  spraxdev: {
    url: 'https://github.com/SpraxDev/Spigot-BuildTools/releases/latest/download/BuildTools.jar',
    prepareArgs: ['--exit-after-fetch']
  },
  spigotmc: {
    url: 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar',
    prepareArgs: ['--compile', 'None']
  }
};

/* GitHub Actions inputs */
const buildToolProvider: string = (core.getInput('buildToolProvider') || 'SpraxDev').toLowerCase();
let versions: string[] = fixArgArr((core.getInput('versions') || 'latest').toLowerCase().split(','));
const generateSrc: boolean = core.getInput('generateSrc') == 'true';
const generateDoc: boolean = core.getInput('generateDoc') == 'true';
const disableJavaCheck: boolean = core.getInput('disableJavaCheck') == 'true';

const forceRun: boolean = core.getInput('forceRun') == 'true';
const threadCount: number = isNumeric(core.getInput('threads')) ? parseInt(core.getInput('threads')) : cpuCount;

const workingDir = resetWorkingDir();
const appLogFile = joinPath(workingDir.logs, 'SpraxDev_Actions-SpigotMC.log');
const appLogStream = createWriteStream(appLogFile, {encoding: 'utf-8', flags: 'a' /* append */});

async function run(): Promise<{ code: number, msg?: string }> {
  return new Promise(async (resolve, reject): Promise<void> => {
    try {
      if (versions.length == 0) return resolve({code: 0, msg: 'No version(s) provided to build'});

      if (!Object.keys(supportedBuildTools).includes(buildToolProvider)) {
        return reject(new Error(`'${buildToolProvider}' is not a valid BuildTool-Provider (${Object.keys(supportedBuildTools).join(', ')})`));
      }

      if (!forceRun) {
        versions = await removeExistingVersions(versions, (ver, jarPath) => {
          logInfo(`Skipping version '${ver}' because it has been found in the local maven repository: ${jarPath}`);
        });

        if (versions.length == 0) return resolve({code: 0, msg: 'No new versions to build'});
      }

      const buildTool = supportedBuildTools[buildToolProvider];

      logInfo('Installed Java-Version:');
      await runCmd('java', ['-version'], workingDir.base, appLogStream);

      logInfo(`\nDownloading '${buildTool.url}'...`);
      await downloadFile(buildTool.url, joinPath(workingDir.cache, 'BuildTools.jar'));

      const gotTemplateDirectory = versions.length != 1;

      // Prepare template directory if more than one version is provided
      if (gotTemplateDirectory) {
        logInfo('Prepare for future tasks by running BuildTools...');

        await core.group('Prepare BuildTools', async (): Promise<void> => {
          try {
            return runCmd('java', ['-jar', 'BuildTools.jar', (disableJavaCheck ? '--disable-java-check' : ''), ...buildTool.prepareArgs],
                workingDir.cache, appLogStream);
          } catch (err) {
            logError(err);

            logError(`\nPrinting last 30 lines from '${resolvePath(appLogFile)}':`);
            for (const line of readLastLines(appLogFile, 30)) {
              logError(line);
            }

            return exit(1);
          }
        });
      }

      const buildToolsArgs = ['-jar', 'BuildTools.jar', '--compile', 'Spigot'];

      if (generateSrc) {
        buildToolsArgs.push('--generate-source');
      }

      if (generateDoc) {
        buildToolsArgs.push('--generate-docs');
      }

      if (disableJavaCheck) {
        buildToolsArgs.push('--disable-java-check');
      }

      const tasks = [];
      for (const ver of versions) {
        tasks.push(async (): Promise<void> => {
          return new Promise(async (resolveTask, rejectTask): Promise<void> => {
            const start = Date.now();

            const logFile = joinPath(workingDir.logs, `${ver}.log`);

            logInfo(`Building version '${ver}'...`);

            // If there is only one version to build, the cache directory is used instead of copying it first
            const versionDir = gotTemplateDirectory ? joinPath(workingDir.base, `${ver}`) : workingDir.cache;

            if (gotTemplateDirectory) {
              await copy(workingDir.cache, versionDir);
            }

            try {
              // set to silent because multiple builds can run at once
              await runCmd('java', [...buildToolsArgs, '--rev', ver], versionDir, logFile, true);

              if (gotTemplateDirectory) {
                rmdirSync(versionDir, {recursive: true}); // delete our task dir
              }

              const end = Date.now();

              logInfo(`Finished '${ver}' in ${((end - start) / 60_000).toFixed(2)} minutes`);
              resolveTask();
            } catch (err) {
              logInfo(`An error occurred while building '${ver}'`);
              logError(err);

              logError(`\nPrinting last 30 lines from '${resolvePath(logFile)}':`);

              for (const line of readLastLines(logFile, 30)) {
                logError(line);
              }

              rejectTask(err);
            }
          });
        });
      }

      parallelLimit(tasks, threadCount, (err) => {
        if (err) return reject(err);

        resolve({code: 0});
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function removeExistingVersions(versionArr: string[], onExist: (ver: string, jarPath: string) => void): Promise<string[]> {
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
            const result = xml2js(verPomBuff.toString('utf-8'), {
              compact: true,
              ignoreComment: true,
              ignoreAttributes: true
            }) as any;

            versionToCheck = result.project?.version?._text;
          }
        }
      } catch (err) {
        logError(err);
      }

      const jarPath = resolvePath(joinPath(userHomeDir, `/.m2/repository/org/spigotmc/spigot/${versionToCheck}/spigot-${versionToCheck}.jar`));
      if (versionToCheck) {
        skipVersion = existsSync(jarPath);
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

run()
    .then((result) => exit(result.code, result.msg))
    .catch((err) => exit(1, err));