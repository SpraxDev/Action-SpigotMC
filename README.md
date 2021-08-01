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
This Action allows you to easily compile Minecraft Spigot or Paper
and install it in your runners local maven repository.

Supported:
* SpigotMC (using official BuildTools or my modified one)
* ~~PaperMC~~ (coming soon #26)

You configure all the versions you want, and it'll compile all the missing versions automatically.
By checking for a file in the local maven repository beforehand, build times can be reduces drastically.

By default, this Action uses [a fork](https://github.com/SpraxDev/Spigot-BuildTools#readme) of the
[original BuildTools](https://hub.spigotmc.org/stash/projects/SPIGOT/repos/buildtools/browse)
to introduce some improvements in *system compatibility* and *speed*.


## Usage
**Note:** Use `actions/cache` as described [here](https://docs.github.com/en/free-pro-team@latest/actions/guides/building-and-testing-java-with-maven#caching-dependencies) to save some additional time by caching between runs!

All the values already provided below are their default values.

If you don't change them, you can remove them from your workflow,
as they are set automatically.

```YAML
- uses: SpraxDev/Action-SpigotMC@v3
  with:
    # A comma-separated list of Spigot version that should be compiled
    # These values are later given to the BuildTools.jar as '--rev' argument
    #
    # Example: latest, 1.14.4, 1.8.8
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

    # Disables the check for existing files in the local maven repository
    # Normally, a version is skipped if it is already installed
    # in the local maven repository to speed up build time
    forceRun: false # Optional

    # The amount of builds allowed to run at the same time
    # Set to '-1' to use system's cpu core count
    threads: -1 # Optional

    # You can choose between different BuildTools to be used by this action
    # ~~'SpraxDev' is my fork of SpigotMC's that introduces some changes (https://github.com/SpraxDev/Spigot-BuildTools/#breaking-changes)~~
    # My (SpraxDev) provider is causing some builds to fail depending on the build environment
    # Available: SpraxDev, SpigotMC
    buildToolProvider: SpigotMC # Optional
```
