#!/usr/bin/env node
/**
 * Postinstall script for resume-helper
 *
 * This script is called after npm install to set up the correct binary
 * for the current platform. It tries to:
 * 1. Find the platform-specific package (e.g., @resume-helper/darwin-arm64)
 * 2. Copy/link the binary to the expected location
 *
 * This follows the pattern used by esbuild, biome, and other native npm packages.
 */

import {
  existsSync,
  copyFileSync,
  chmodSync,
  symlinkSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");

// Map Node.js platform/arch to our binary names
const PLATFORM_MAP = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "win32-x64": "windows-x64",
};

function getPlatformKey() {
  return `${process.platform}-${process.arch}`;
}

function getBinaryName(platformKey) {
  const platform = PLATFORM_MAP[platformKey];
  if (!platform) {
    return null;
  }
  const ext = process.platform === "win32" ? ".exe" : "";
  return `resume-cli-${platform}${ext}`;
}

function findBinary() {
  const platformKey = getPlatformKey();
  const binaryName = getBinaryName(platformKey);

  if (!binaryName) {
    console.error(
      `Unsupported platform: ${platformKey}. ` +
        `Supported platforms: ${Object.keys(PLATFORM_MAP).join(", ")}`,
    );
    process.exit(1);
  }

  // Strategy 1: Look in optionalDependencies package
  // e.g., node_modules/@resume-helper/darwin-arm64/bin/resume-cli
  const platform = PLATFORM_MAP[platformKey];
  const optionalPkgBinary = join(
    packageRoot,
    "..",
    `@resume-helper`,
    platform,
    "bin",
    binaryName,
  );

  if (existsSync(optionalPkgBinary)) {
    return optionalPkgBinary;
  }

  // Strategy 2: Look in dist/bin (development or bundled distribution)
  const distBinary = join(packageRoot, "dist", "bin", binaryName);
  if (existsSync(distBinary)) {
    return distBinary;
  }

  // Strategy 3: Look in bin directory (pre-built distribution)
  const binBinary = join(packageRoot, "bin", binaryName);
  if (existsSync(binBinary)) {
    return binBinary;
  }

  return null;
}

function setupBinary() {
  const binaryPath = findBinary();

  if (!binaryPath) {
    // Not an error in CI or when using source install
    if (process.env.CI || process.env.npm_config_ignore_scripts) {
      console.log(
        "resume-helper: Binary not found, likely source install or CI environment",
      );
      return;
    }

    console.error(
      "resume-helper: Could not find pre-built binary for your platform.\n" +
        "You may need to build from source: bun run scripts/build.ts --current\n" +
        `Platform: ${getPlatformKey()}`,
    );
    process.exit(1);
  }

  // Ensure bin directory exists
  const binDir = join(packageRoot, "bin");
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }

  // Target location for the binary
  const ext = process.platform === "win32" ? ".exe" : "";
  const targetPath = join(binDir, `resume-cli${ext}`);

  // Remove existing binary/symlink if it exists
  if (existsSync(targetPath)) {
    try {
      unlinkSync(targetPath);
    } catch {
      // Ignore errors
    }
  }

  try {
    // Try to create a symlink first (saves disk space)
    if (process.platform !== "win32") {
      symlinkSync(binaryPath, targetPath);
    } else {
      // Windows: just copy the binary
      copyFileSync(binaryPath, targetPath);
    }

    // Ensure executable permissions
    chmodSync(targetPath, 0o755);

    console.log(`resume-helper: Binary installed successfully`);
  } catch (error) {
    // Fall back to copying if symlink fails
    try {
      copyFileSync(binaryPath, targetPath);
      chmodSync(targetPath, 0o755);
      console.log(`resume-helper: Binary installed successfully (copied)`);
    } catch (copyError) {
      console.error(
        `resume-helper: Failed to install binary: ${copyError.message}`,
      );
      process.exit(1);
    }
  }
}

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  setupBinary();
}

export { findBinary, setupBinary, getPlatformKey, getBinaryName };
