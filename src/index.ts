import * as core from '@actions/core';
import { join as joinPath } from 'path';

import { fixArgArr, runCmd, downloadFile, resetWorkingDir } from './utils';

/* GitHub Actions inputs */
const versions: string[] = fixArgArr((core.getInput('versions') || 'latest').split(','));
const target: string[] = fixArgArr((core.getInput('target') || 'Spigot').split(','));
const forceRun: boolean = core.getInput('forceRun') == 'true';
const generateSrc: boolean = core.getInput('generateSrc') == 'true';
const generateDoc: boolean = core.getInput('generateDoc') == 'true';
const disableJavaCheck: boolean = core.getInput('disableJavaCheck') == 'true';

const workingDir = resetWorkingDir();

async function run() {
  console.log('Downloading BuildTools...');
  await downloadFile('https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar', joinPath(workingDir.cache, 'BuildTools.jar'));

  // await core.group('Create cache', async () => {
  runCmd('java', ['-jar', 'BuildTools.jar', '--compile', 'NONE'], workingDir.cache)
    .then(() => {
      console.log('done');
    })
    .catch(console.error);
  // });

  // for (const ver of versions) {
  //   core.group('Do something async', async () => {
  //     return runCmd();
  //   })
  // }
}

run();