#!/usr/bin/env node
/**
 * Postinstall script for resume-helper
 *
 * This script verifies that the correct platform-specific binary package
 * was installed. It doesn't copy or symlink anything - the bin/resume-helper
 * wrapper script handles finding and executing the binary at runtime.
 *
 * This follows the pattern used by OpenCode, esbuild, and other native npm packages.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Map Node.js platform/arch to our package naming convention
const PLATFORM_MAP = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

const ARCH_MAP = {
  x64: "x64",
  arm64: "arm64",
  arm: "arm",
};

function getPlatformPackageName() {
  const platform = PLATFORM_MAP[os.platform()] || os.platform();
  const arch = ARCH_MAP[os.arch()] || os.arch();
  return `resume-helper-${platform}-${arch}`;
}

function getBinaryName() {
  return os.platform() === "win32" ? "resume-helper.exe" : "resume-helper";
}

function findBinary() {
  const packageName = getPlatformPackageName();
  const binaryName = getBinaryName();

  try {
    // Try to resolve the platform package
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const binaryPath = path.join(
      path.dirname(packageJsonPath),
      "bin",
      binaryName,
    );

    if (fs.existsSync(binaryPath)) {
      return { binaryPath, packageName };
    }
  } catch {
    // Package not found - this is expected if optionalDependencies wasn't installed
  }

  return null;
}

async function main() {
  // Skip postinstall in CI environments or during npm publish
  if (
    process.env.CI ||
    process.env.npm_config_ignore_scripts ||
    process.env.npm_command === "publish"
  ) {
    console.log(
      "resume-helper: Skipping binary verification (CI/publish environment)",
    );
    return;
  }

  const result = findBinary();

  if (result) {
    console.log(`resume-helper: Platform binary verified (${result.packageName})`);
  } else {
    const packageName = getPlatformPackageName();
    // Not a hard error - the binary might be installed via other means
    // or the user might be building from source
    console.log(
      `resume-helper: Platform package ${packageName} not found.\n` +
        `This is expected if you're building from source or on an unsupported platform.\n` +
        `Run 'bun run scripts/build.ts --current' to build the binary locally.`,
    );
  }
}

main().catch((error) => {
  // Don't fail the install on postinstall errors
  console.error(`resume-helper: Postinstall warning: ${error.message}`);
});
