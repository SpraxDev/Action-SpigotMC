import * as core from '@actions/core';
import { join as joinPath, resolve as resolvePath } from 'path';
import { copy } from 'fs-extra';
import { rmdirSync } from 'fs';

import { cpuCount, downloadFile, exit, fixArgArr, isNumeric, resetWorkingDir, runCmd } from './utils';
import { parallelLimit } from 'async';


const rll = require('read-last-lines');

/* GitHub Actions inputs */
const versions: string[] = fixArgArr((core.getInput('versions') || 'latest').split(','));
const target: string[] = fixArgArr((core.getInput('target') || 'Spigot').toUpperCase().split(','));
const generateSrc: boolean = core.getInput('generateSrc') == 'true';
const generateDoc: boolean = core.getInput('generateDoc') == 'true';
const disableJavaCheck: boolean = core.getInput('disableJavaCheck') == 'true';

const forceRun: boolean = core.getInput('forceRun') == 'true';  // TODO
const threadCount: number = isNumeric(core.getInput('threads')) ? parseInt(core.getInput('threads')) : cpuCount;

const workingDir = resetWorkingDir();

async function run(): Promise<{ code: number, msg?: string }> {
  return new Promise<{ code: number, msg?: string }>(async (resolve, reject): Promise<void> => {
    if (versions.length == 0) return resolve({code: 0, msg: 'No version(s) provided to build'});
    if (target.length == 0) return resolve({code: 0, msg: 'No target(s) provided to build'});

    const appLogFile = joinPath(workingDir.logs, 'SpraxDev_Actions-SpigotMC.log');

    console.log('Installed Java-Version:');
    await runCmd('java', ['-version'], workingDir.base, appLogFile);

    console.log(`Downloading BuildTools.jar from 'hub.spigotmc.org'...`);
    await downloadFile('https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar', joinPath(workingDir.cache, 'BuildTools.jar'));

    const gotTemplateDirectory = versions.length != 1;

    // Prepare template directory if more than one version is provided
    if (gotTemplateDirectory) {
      console.log('Prepare for future tasks by running BuildTools...');

      try {
        await core.group('Prepare BuildTools', async (): Promise<void> => {
          return runCmd('java', ['-jar', 'BuildTools.jar', '--compile', 'NONE'],
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
      tasks.push((callback: (err?: Error, result?: unknown) => void) => {
        try {
          const start = Date.now();

          const logFile = joinPath(workingDir.logs, `${ver}.log`);

          console.log(`Building version '${ver}'...`);

          // If there is only one version to build, the cache directory is used instead of copying it first
          const versionDir = gotTemplateDirectory ? joinPath(workingDir.base, `${ver}`) : workingDir.cache;

          if (gotTemplateDirectory) {
            copy(workingDir.cache, versionDir)
                .then(() => {
                  runCmd('java', [...buildToolsArgs, '--rev', ver],
                      versionDir, logFile, true)  // set to silent because multiple builds can run at once
                      .then(() => {
                        rmdirSync(versionDir, {recursive: true}); // delete our task dir

                        const end = Date.now();

                        console.log(`Finished building '${ver}' in ${((end - start) / 60_000)} minutes`);
                        callback();
                      });
                })
                .catch((err) => {
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
                      .finally(() => callback(err));
                });
          }
        } catch (err) {
          callback(err);
        }
      });
    }

    (parallelLimit(tasks, threadCount) as unknown as Promise<unknown[]>)  // Valid according to docs - types outdated?
        .then(() => resolve({code: 0}))
        .catch(reject);
  });
}

run()
    .then((result) => exit(result.code, result.msg))
    .catch((err) => exit(1, err));