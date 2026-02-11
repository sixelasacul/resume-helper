#!/usr/bin/env bun
/**
 * Build script for cross-compiling resume-helper CLI
 *
 * Produces standalone binaries for multiple platforms that don't require
 * Bun or Node.js to be installed.
 *
 * Usage:
 *   bun run scripts/build.ts              # Build all platforms
 *   bun run scripts/build.ts --current    # Build for current platform only
 *   bun run scripts/build.ts --platform darwin-arm64  # Build specific platform
 */

import { $ } from "bun";
import { mkdir, rm, copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// Supported platforms for Bun's cross-compilation
const PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "windows-x64",
] as const;

type Platform = (typeof PLATFORMS)[number];

interface BuildOptions {
  platforms: Platform[];
  outputDir: string;
  entrypoint: string;
  name: string;
}

function getPlatformBinaryName(name: string, platform: Platform): string {
  const ext = platform.startsWith("windows") ? ".exe" : "";
  return `${name}-${platform}${ext}`;
}

function getCurrentPlatform(): Platform {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const os = process.platform === "win32" ? "windows" : process.platform;
  return `${os}-${arch}` as Platform;
}

async function buildForPlatform(
  platform: Platform,
  options: BuildOptions,
): Promise<{ success: boolean; size?: number; error?: string }> {
  const binaryName = getPlatformBinaryName(options.name, platform);
  const outputPath = join(options.outputDir, binaryName);

  console.log(`  Building for ${platform}...`);

  try {
    // Bun compile with cross-compilation target
    const result =
      await $`bun build ${options.entrypoint} --compile --target=bun-${platform} --outfile=${outputPath}`
        .quiet()
        .nothrow();

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      const stdout = result.stdout.toString().trim();
      return {
        success: false,
        error: stderr || stdout || `Exit code ${result.exitCode}`,
      };
    }

    // Get file size
    const file = Bun.file(outputPath);
    const size = file.size;

    return { success: true, size };
  } catch (error) {
    return {
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
    const platform = args[platformIndex + 1] as Platform;
    if (!PLATFORMS.includes(platform)) {
      console.error(`Invalid platform: ${platform}`);
      console.error(`Valid platforms: ${PLATFORMS.join(", ")}`);
      process.exit(1);
    }
    selectedPlatforms = [platform];
  }

  const options: BuildOptions = {
    platforms: selectedPlatforms,
    outputDir: "dist/bin",
    entrypoint: "src/index.ts",
    name: "resume-cli",
  };

  console.log("Building resume-helper CLI...\n");
  console.log(`Platforms: ${options.platforms.join(", ")}`);
  console.log(`Output: ${options.outputDir}\n`);

  // Clean and create output directory
  try {
    await rm(options.outputDir, { recursive: true, force: true });
  } catch {
    // Ignore if doesn't exist
  }
  await mkdir(options.outputDir, { recursive: true });

  // Build for each platform
  const results: {
    platform: Platform;
    success: boolean;
    size?: number;
    error?: string;
  }[] = [];

  for (const platform of options.platforms) {
    const result = await buildForPlatform(platform, options);
    results.push({ platform, ...result });

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
    for (const { platform, size } of successful) {
      const binaryName = getPlatformBinaryName(options.name, platform);
      console.log(`  ${binaryName} (${formatSize(size!)})`);
    }
  }

  if (failed.length > 0) {
    console.log(`\nFailed builds (${failed.length}):`);
    for (const { platform, error } of failed) {
      console.log(`  ${platform}: ${error}`);
    }
  }

  // List output files
  console.log(`\nOutput directory: ${options.outputDir}`);
  const files = await readdir(options.outputDir);
  for (const file of files) {
    console.log(`  ${file}`);
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
