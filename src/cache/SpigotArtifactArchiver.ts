import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';
import * as Tar from 'tar';

export default class SpigotArtifactArchiver {
  private static readonly ARTIFACT_DIRS = [
    'org/spigotmc/minecraft-server/',
    'org/spigotmc/spigot-api/',
    'org/spigotmc/spigot/'
  ];

  async createCacheArchiveForVersion(version: string, destFilePath: string): Promise<void> {
    if (!Path.isAbsolute(destFilePath)) {
      throw new Error('Destination path must be absolute');
    }

    const localMavenRepo = SpigotArtifactArchiver.determineLocalMavenRepositoryPath();
    const files = await this.collectFilesFromMavenRepo(localMavenRepo, version);
    if (files.length === 0) {
      throw new Error('No files found in local Maven repository');
    }

    await Tar.create(
      {
        file: destFilePath,
        gzip: true,
        cwd: localMavenRepo
      },
      files.map(file => Path.relative(localMavenRepo, file))
    );
  }

  async extractCacheArchive(filePath: string): Promise<void> {
    if (!Path.isAbsolute(filePath)) {
      throw new Error('File path must be absolute');
    }

    const localMavenRepo = SpigotArtifactArchiver.determineLocalMavenRepositoryPath();
    await Fs.promises.mkdir(localMavenRepo, {recursive: true});
    await Tar.extract({
      file: filePath,
      cwd: localMavenRepo
    });
  }

  private async collectFilesFromMavenRepo(localMavenRepo: string, version: string): Promise<string[]> {
    const files: string[] = [];

    for (const artifactDir of SpigotArtifactArchiver.ARTIFACT_DIRS) {
      const artifactPath = Path.join(localMavenRepo, artifactDir, version);
      if (Fs.existsSync(artifactPath)) {
        files.push(artifactPath);
      }
    }

    return files;
  }

  private static determineLocalMavenRepositoryPath() {
    return Path.join(Os.homedir(), '.m2', 'repository');
  }
}
