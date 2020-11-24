import * as core from '@actions/core';
import { join as joinPath, resolve as resolvePath } from 'path';
import { copy } from 'fs-extra';
import { rmdirSync } from 'fs';
import { parallelLimit } from 'async';

import { cpuCount, downloadFile, exit, fixArgArr, isNumeric, resetWorkingDir, runCmd } from './utils';

const rll = require('read-last-lines');

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
const versions: string[] = fixArgArr((core.getInput('versions') || 'latest').split(','));
const target: string[] = fixArgArr((core.getInput('target') || 'Spigot').toUpperCase().split(','));
const generateSrc: boolean = core.getInput('generateSrc') == 'true';
const generateDoc: boolean = core.getInput('generateDoc') == 'true';
const disableJavaCheck: boolean = core.getInput('disableJavaCheck') == 'true';

const forceRun: boolean = core.getInput('forceRun') == 'true';  // TODO
const threadCount: number = isNumeric(core.getInput('threads')) ? parseInt(core.getInput('threads')) : cpuCount;

const workingDir = resetWorkingDir();

async function run(): Promise<{ code: number, msg?: string }> {
  return new Promise(async (resolve, reject): Promise<void> => {
    try {
      if (versions.length == 0) return resolve({code: 0, msg: 'No version(s) provided to build'});
      if (target.length == 0) return resolve({code: 0, msg: 'No target(s) provided to build'});

      if (!Object.keys(supportedBuildTools).includes(buildToolProvider)) {
        return reject(new Error(`'${buildToolProvider}' is not a valid BuildTool-Provider (${Object.keys(supportedBuildTools).join(', ')})`));
      }

      const buildTool = supportedBuildTools[buildToolProvider];
      const appLogFile = joinPath(workingDir.logs, 'SpraxDev_Actions-SpigotMC.log');

      console.log('Installed Java-Version:');
      await runCmd('java', ['-version'], workingDir.base, appLogFile);

      console.log(`\nDownloading '${buildTool.url}'...`);
      await downloadFile(buildTool.url, joinPath(workingDir.cache, 'BuildTools.jar'));

      const gotTemplateDirectory = versions.length != 1;

      // Prepare template directory if more than one version is provided
      if (gotTemplateDirectory) {
        console.log('Prepare for future tasks by running BuildTools...');

        try {
          await core.group('Prepare BuildTools', async (): Promise<void> => {
            return runCmd('java', ['-jar', 'BuildTools.jar', (disableJavaCheck ? '--disable-java-check' : ''), ...buildTool.prepareArgs],
                workingDir.cache, appLogFile);
          });
        } catch (err) {
          console.error(err);

          console.error(`\nPrinting last 25 lines from '${resolvePath(appLogFile)}':`);
          for (const line of (await rll.read(appLogFile, 25))) {
            console.error(line);
          }

          return exit(1);
        }
      }

      const buildToolsArgs = ['-jar', 'BuildTools.jar', '--compile', target.join(',')];

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

            console.log(`Building version '${ver}'...`);

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

              console.log(`Finished '${ver}' in ${((end - start) / 60_000).toFixed(2)} minutes`);
              resolveTask();
            } catch (err) {
              console.log(`An error occurred while building '${ver}'`);
              console.error(err);

              console.error(`\nPrinting last 25 lines from '${resolvePath(logFile)}':`);
              rll.read(logFile, 25)
                  .then((lines: string[]) => {
                    for (const line of lines) {
                      console.error(line);
                    }
                  })
                  .catch(console.error)
                  .finally(() => rejectTask(err));
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

run()
    .then((result) => exit(result.code, result.msg))
    .catch((err) => exit(1, err));