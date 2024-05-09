<p align="center">
  <a href="https://sprax.me/discord">
    <img alt="Get Support on Discord" src="https://img.shields.io/discord/344982818863972352.svg?label=Get%20Support&logo=Discord&color=blue">
  </a>
  <a href="https://www.patreon.com/sprax">
    <img alt="Support me on Patreon"
         src="https://img.shields.io/badge/-Support%20me%20on%20Patreon-%23FF424D?logo=patreon&logoColor=white">
  </a>
</p>

<p align="center">
  <a href="https://github.com/SpraxDev/Action-SpigotMC/actions?query=workflow%3A%22Build+%26+Run%22">
    <img alt="Build & Run" src="https://github.com/SpraxDev/Action-SpigotMC/workflows/Build%20&%20Run/badge.svg">
  </a>
  <a href="https://sonarcloud.io/dashboard?id=SpraxDev_Action-SpigotMC">
    <img alt="Quality Gate Status"
         src="https://sonarcloud.io/api/project_badges/measure?project=SpraxDev_Action-SpigotMC&metric=alert_status">
  </a>
</p>

# Action-SpigotMC
This Action allows you to easily compile Minecraft Spigot
and install it in your runners local maven repository.

Supported:
* SpigotMC (using the latest version of the official BuildTools)

You configure all the versions you want, and it'll compile all the missing versions automatically.
By checking for a file in the local maven repository beforehand, build times can be reduces drastically.


## Usage
**Note:** Use `actions/cache` as described [here](https://docs.github.com/en/free-pro-team@latest/actions/guides/building-and-testing-java-with-maven#caching-dependencies) to save some additional time by caching between runs!

All the values already provided below are their default values.

If you don't change them, you can remove them from your workflow,
as they are set automatically.

```yaml
- uses: SpraxDev/Action-SpigotMC@v5
  with:
    # A comma-separated list of Spigot version that should be compiled
    # These values are later given to the BuildTools.jar as '--rev' argument
    #
    # Example: latest, 1.19.2, 1.8.8
    versions: latest # Optional

    # Should sources be generated?
    # If enabled, BuildTools is provided the '--generate-source' argument
    generateSrc: false # Optional

    # Should the documentation be generated?
    # If enabled, BuildTools is provided the '--generate-docs' argument
    generateDoc: false # Optional

    # Should we disable the BuildTools's Java-Version-Check?
    # If enabled, BuildTools is provided the '--disable-java-check' argument
    disableJavaCheck: false # Optional

    # Should we download additional files to deobfuscate CraftBukkit and NMS?
    # If enabled, BuildTools will also install additional files that are required to deobfuscate CraftBukkit and NMS with the SpecialSource-Plugin
    remapped: false # Optional

    # Disables the check for existing files in the local maven repository
    # Normally, a version is skipped if it is already installed
    # in the local maven repository to speed up build time
    forceRun: false # Optional

    # The amount of builds allowed to run at the same time
    # Set to '-1' to use system's cpu core count
    threads: -1 # Optional

    # You can choose between different BuildTools to be used by this action
    # Available: SpigotMC
    buildToolProvider: SpigotMC # Optional


    # The host of the SFTP-Server to use as dedicated artifact cache
    sftpCacheHost: '' # Optional
    
    # The port of the SFTP-Server to use as dedicated artifact cache
    sftpCachePort: 22 # Optional
    
    # The username of the SFTP-Server to use as dedicated artifact cache
    sftpCacheUser: '' # Optional
    
    # The private key of the SFTP-Server to use as dedicated artifact cache
    # The configured value should start with `-----BEGIN OPENSSH PRIVATE KEY-----`
    sftpCachePrivateKey: '' # Optional
    
    # Setting this to the server's host key, will enable strictly checking the host key
    # something like `ssh-ed25519 [HASH]` is expected here
    sftpCacheExpectedHostKey: '' # Optional
```

## Cache Spigot artifacts on a dedicated SFTP-Server
Using GitHub's `actions/cache` is already great but may not be enough for some use-cases,
causing all those Spigot versions to be recompiled more often than necessary.

To solve this, you are able to configure your own SFTP-Server that should be used to store and restore built Spigot artifacts.

To be clear, we still recommend using `actions/cache` in addition to this feature – This is not aimed to be a replacement.

In theory, using this feature allows you only build a version once and then share it across all your repositories and workflows.
