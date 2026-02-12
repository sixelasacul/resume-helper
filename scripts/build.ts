#!/usr/bin/env bun
/**
 * Build script for cross-compiling resume-helper CLI
 *
 * Produces standalone binaries for multiple platforms that don't require
 * Bun or Node.js to be installed. Uses Bun.build() API for compilation
 * and generates platform-specific npm packages with proper os/cpu fields
 * for npm's optional dependency resolution.
 *
 * Usage:
 *   bun run scripts/build.ts              # Build all platforms
 *   bun run scripts/build.ts --current    # Build for current platform only
 *   bun run scripts/build.ts --platform darwin-arm64  # Build specific platform
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

// Package info
const pkg = await Bun.file("package.json").json();
const PKG_NAME = "resume-helper";
const VERSION = pkg.version;

// Supported platforms for Bun's cross-compilation
const PLATFORMS = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "windows", arch: "x64" },
] as const;

type Platform = (typeof PLATFORMS)[number];

interface BuildResult {
  platform: Platform;
  packageName: string;
  success: boolean;
  size?: number;
  error?: string;
}

function getPlatformKey(platform: Platform): string {
  return `${platform.os}-${platform.arch}`;
}

function getPackageName(platform: Platform): string {
  return `${PKG_NAME}-${getPlatformKey(platform)}`;
}

function getBunTarget(platform: Platform): string {
  // Map our platform names to Bun's target format
  return `bun-${platform.os}-${platform.arch}`;
}

function getBinaryName(platform: Platform): string {
  return platform.os === "windows" ? `${PKG_NAME}.exe` : PKG_NAME;
}

function getNpmOs(platform: Platform): string {
  // npm uses "darwin" for macOS, "linux" for Linux, "win32" for Windows
  return platform.os === "windows" ? "win32" : platform.os;
}

function getCurrentPlatform(): Platform {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const os =
    process.platform === "win32"
      ? "windows"
      : (process.platform as "darwin" | "linux");
  return { os, arch } as Platform;
}

async function buildForPlatform(platform: Platform): Promise<BuildResult> {
  const packageName = getPackageName(platform);
  const binaryName = getBinaryName(platform);
  const bunTarget = getBunTarget(platform);
  const outputDir = join("dist", packageName, "bin");
  const outputPath = join(outputDir, binaryName);

  console.log(`  Building ${packageName}...`);

  try {
    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });

    // Build using Bun.build() API with compile option
    // See: https://bun.sh/docs/bundler/executables
    const result = await Bun.build({
      entrypoints: ["./src/index.ts"],
      compile: {
        target: bunTarget as Bun.Build.CompileTarget,
        outfile: outputPath,
      },
      minify: true,
      bytecode: true,
    });

    if (!result.success) {
      const errors = result.logs
        .filter((log) => log.level === "error")
        .map((log) => log.message)
        .join("\n");
      return {
        platform,
        packageName,
        success: false,
        error: errors || "Build failed with unknown error",
      };
    }

    // Get file size
    const file = Bun.file(outputPath);
    const size = file.size;

    // Generate platform package.json
    const platformPkgJson = {
      name: packageName,
      version: VERSION,
      description: `Platform-specific binary for resume-helper (${getPlatformKey(platform)})`,
      license: "MIT",
      repository: {
        type: "git",
        url: "https://github.com/sixelasacul/resume-helper.git",
      },
      os: [getNpmOs(platform)],
      cpu: [platform.arch],
    };

    await Bun.write(
      join("dist", packageName, "package.json"),
      JSON.stringify(platformPkgJson, null, 2),
    );

    return { platform, packageName, success: true, size };
  } catch (error) {
    return {
      platform,
      packageName,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let selectedPlatforms: Platform[] = [...PLATFORMS];

  if (args.includes("--current")) {
    selectedPlatforms = [getCurrentPlatform()];
  } else if (args.includes("--platform")) {
    const platformIndex = args.indexOf("--platform");
    const platformArg = args[platformIndex + 1];
    if (!platformArg) {
      console.error("Missing platform argument");
      console.error(
        `Valid platforms: ${PLATFORMS.map((p) => getPlatformKey(p)).join(", ")}`,
      );
      process.exit(1);
    }
    const [os, arch] = platformArg.split("-") as [
      Platform["os"],
      Platform["arch"],
    ];
    const platform = PLATFORMS.find((p) => p.os === os && p.arch === arch);
    if (!platform) {
      console.error(`Invalid platform: ${platformArg}`);
      console.error(
        `Valid platforms: ${PLATFORMS.map((p) => getPlatformKey(p)).join(", ")}`,
      );
      process.exit(1);
    }
    selectedPlatforms = [platform];
  }

  console.log(`Building ${PKG_NAME} CLI v${VERSION}...\n`);
  console.log(
    `Platforms: ${selectedPlatforms.map((p) => getPlatformKey(p)).join(", ")}`,
  );
  console.log(`Output: dist/<platform-package>/\n`);

  // Clean dist directory for selected platforms
  for (const platform of selectedPlatforms) {
    const packageName = getPackageName(platform);
    try {
      await rm(join("dist", packageName), { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  }

  // Build for each platform
  const results: BuildResult[] = [];

  for (const platform of selectedPlatforms) {
    const result = await buildForPlatform(platform);
    results.push(result);

    if (result.success) {
      console.log(`    Done (${formatSize(result.size!)})`);
    } else {
      console.log(`    Failed: ${result.error}`);
    }
  }

  // Summary
  console.log("\nBuild Summary:");
  console.log("─".repeat(50));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    console.log(`\nSuccessful builds (${successful.length}):`);
    for (const { packageName, size } of successful) {
      console.log(`  ${packageName} (${formatSize(size!)})`);
    }
  }

  if (failed.length > 0) {
    console.log(`\nFailed builds (${failed.length}):`);
    for (const { packageName, error } of failed) {
      console.log(`  ${packageName}: ${error}`);
    }
  }

  // List output structure
  console.log("\nOutput structure:");
  for (const { packageName } of successful) {
    console.log(`  dist/${packageName}/`);
    console.log(`    ├── bin/`);
    console.log(
      `    │   └── resume-helper${packageName.includes("windows") ? ".exe" : ""}`,
    );
    console.log(`    └── package.json`);
  }

  // Exit with error if any builds failed
  if (failed.length > 0) {
    process.exit(1);
  }

  console.log("\nBuild complete!");
}

main().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
