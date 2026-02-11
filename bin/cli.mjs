#!/usr/bin/env node
/**
 * CLI wrapper for resume-helper
 *
 * This script finds and executes the platform-specific binary.
 * It handles both:
 * 1. Development mode (binary in dist/bin)
 * 2. Production mode (binary in bin or from optionalDependencies)
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

function findBinary() {
  const platformKey = getPlatformKey();
  const platform = PLATFORM_MAP[platformKey];

  if (!platform) {
    console.error(
      `Unsupported platform: ${platformKey}\n` +
        `Supported platforms: ${Object.keys(PLATFORM_MAP).join(", ")}`,
    );
    process.exit(1);
  }

  const ext = process.platform === "win32" ? ".exe" : "";
  const binaryName = `resume-cli-${platform}${ext}`;

  // Check locations in priority order

  // 1. Local bin directory (set up by postinstall)
  const localBin = join(__dirname, `resume-cli${ext}`);
  if (existsSync(localBin)) {
    return localBin;
  }

  // 2. Optional dependency package
  const optionalPkgBinary = join(
    packageRoot,
    "..",
    "@resume-helper",
    platform,
    "bin",
    binaryName,
  );
  if (existsSync(optionalPkgBinary)) {
    return optionalPkgBinary;
  }

  // 3. dist/bin (development)
  const distBinary = join(packageRoot, "dist", "bin", binaryName);
  if (existsSync(distBinary)) {
    return distBinary;
  }

  // 4. bin directory with platform name
  const binBinary = join(__dirname, binaryName);
  if (existsSync(binBinary)) {
    return binBinary;
  }

  return null;
}

function main() {
  const binaryPath = findBinary();

  if (!binaryPath) {
    console.error(
      "resume-helper: Could not find binary for your platform.\n" +
        `Platform: ${getPlatformKey()}\n\n` +
        "This usually means:\n" +
        "1. The optional dependency for your platform was not installed\n" +
        "2. You need to build from source: bun run scripts/build.ts --current\n\n" +
        "If you installed with npm, try: npm install --include=optional",
    );
    process.exit(1);
  }

  // Execute the binary with all arguments passed through
  const child = spawn(binaryPath, process.argv.slice(2), {
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`Failed to execute binary: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

main();
