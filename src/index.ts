import * as core from '@actions/core';
import { parallelLimit } from 'async';
import { copy } from 'fs-extra';
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, rmSync } from 'node:fs';
import { join as joinPath, resolve as resolvePath } from 'node:path';
import { xml2js } from 'xml-js';
import SpigotArtifactCache from './cache/SpigotArtifactCache';
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

const supportedBuildTools: { [key: string]: { url: string } } = {
    spigotmc: {
        url: 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar'
    }
};

/* GitHub Actions inputs */
const buildToolProvider: string = (core.getInput('buildToolProvider') || 'SpigotMC').toLowerCase();
let versions: string[] = fixArgArr((core.getInput('versions') || 'latest').toLowerCase().split(','));
const generateSrc: boolean = core.getInput('generateSrc') == 'true';
const generateDoc: boolean = core.getInput('generateDoc') == 'true';
const disableJavaCheck: boolean = core.getInput('disableJavaCheck') == 'true';
const remapped: boolean = core.getInput('remapped') == 'true';

const forceRun: boolean = core.getInput('forceRun') == 'true';
const threadCount: number = isNumeric(core.getInput('threads')) ? parseInt(core.getInput('threads'), 10) : cpuCount;

const sftpCacheHost: string = core.getInput('sftpCacheHost') || '';
const sftpCachePort: number = isNumeric(core.getInput('sftpCachePort')) ? parseInt(core.getInput('sftpCachePort'), 10) : 22;
const sftpCacheUser: string = core.getInput('sftpCacheUser') || '';
const sftpCachePrivateKey: string = core.getInput('sftpCachePrivateKey') || '';

const workingDir = resetWorkingDir();
const appLogFile = joinPath(workingDir.logs, 'SpraxDev_Actions-SpigotMC.log');
const appLogStream = createWriteStream(appLogFile, {encoding: 'utf-8', flags: 'a' /* append */});

let spigotArtifactCache: SpigotArtifactCache;
const requestedVersionToArtifactVersionMap = new Map<string, string>();

async function run(): Promise<{ code: number, msg?: string }> {
    spigotArtifactCache = new SpigotArtifactCache(sftpCacheHost, sftpCachePort, sftpCacheUser, sftpCachePrivateKey);
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
            await downloadFile(buildTool.url, joinPath(workingDir.cache, 'BuildTools.jar'));

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
                buildToolsArgs.push('--remapped')
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
                                rmSync(versionDir, {recursive: true}); // delete our task dir
                            }

                            const end = Date.now();

                            logInfo(`Finished '${ver}' (${requestedVersionToArtifactVersionMap.get(ver)}) in ${((end - start) / 60_000).toFixed(2)} minutes`);

                            if (spigotArtifactCache.isSftpAvailable() && requestedVersionToArtifactVersionMap.has(ver)) {
                                const artifactVersion = requestedVersionToArtifactVersionMap.get(ver)!;
                                if (await spigotArtifactCache.createAndUploadCacheForVersion(artifactVersion, workingDir.cache, logError)) {
                                    logInfo(`Uploaded cache for version '${ver}' (${artifactVersion}) to SFTP-Server`);
                                }
                            }

                            resolveTask();
                        } catch (err: any) {
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
                        const result = xml2js(verPomBuff.toString('utf-8'), {
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

            const jarPath = resolvePath(joinPath(userHomeDir, `/.m2/repository/org/spigotmc/spigot/${versionToCheck}/spigot-${versionToCheck}${remapped ? '-remapped-mojang' : ''}.jar`));
            if (versionToCheck) {
                skipVersion = existsSync(jarPath);
            }

            if (!versionToCheck && spigotArtifactCache.isSftpAvailable()) {
                if (await spigotArtifactCache.fetchAndExtractCacheForVersionIfExists(ver, workingDir.cache, logError)) {
                    logInfo(`Restored version '${ver}' from SFTP-Cache`);
                    skipVersion = existsSync(jarPath);
                } else {
                    logInfo(`Version '${ver}' not found in SFTP-Cache`);
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

let originalGitUserName: string | null = null;
let originalGitUserEmail: string | null = null;

function setGitUserAndBackupCurrent(): void {
    let gitProcess = spawnSync('git', ['config', '--global', 'user.name']);
    if (gitProcess.status == 0) {
        originalGitUserName = gitProcess.stdout.toString();
    }

    gitProcess = spawnSync('git', ['config', '--global', 'user.email']);
    if (gitProcess.status == 0) {
        originalGitUserEmail = gitProcess.stdout.toString();
    }

    const gitUserName = `GitHub Runner on ${process.env['GITHUB_REPOSITORY'] || 'Unknown_Repository'} (id=${process.env['GITHUB_RUN_ID']})`;
    const gitUserEmail = 'no-reply@example.com';
    spawnSync('git', ['config', '--global', 'user.name', gitUserName]);
    spawnSync('git', ['config', '--global', 'user.email', gitUserEmail]);

    logInfo(`Configured git user set to '${gitUserName} <${gitUserEmail}>' (was '${originalGitUserName} <${originalGitUserEmail}>')`);
}

function restoreGitUser(): void {
    spawnSync('git', ['config', '--global', 'user.name', originalGitUserName ?? '']);
    spawnSync('git', ['config', '--global', 'user.email', originalGitUserEmail ?? '']);
    logInfo(`Configured git user restored to '${originalGitUserName ?? ''} <${originalGitUserEmail ?? ''}>'`);
}

let exitCode = 2;
let exitMessage: string | Error | undefined;

setGitUserAndBackupCurrent();
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
        restoreGitUser();
        exit(exitCode, exitMessage);
    });
