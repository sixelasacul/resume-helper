#!/usr/bin/env node
/**
 * CLI wrapper for resume-helper
 *
 * This script finds and executes the platform-specific binary.
 * It handles both:
 * 1. Development mode (binary in dist/<platform-package>/bin/)
 * 2. Production mode (binary from optionalDependencies packages)
 *
 * Based on the pattern used by OpenCode, esbuild, and other native npm packages.
 * 
 * Note: This file uses CommonJS syntax to work regardless of package.json "type".
 */

"use strict";

var childProcess = require("node:child_process");
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");

// Map Node.js platform/arch to our package naming convention
var PLATFORM_MAP = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

var ARCH_MAP = {
  x64: "x64",
  arm64: "arm64",
  arm: "arm",
};

function getPlatformPackageName() {
  var platform = PLATFORM_MAP[os.platform()] || os.platform();
  var arch = ARCH_MAP[os.arch()] || os.arch();
  return "resume-helper-" + platform + "-" + arch;
}

function getBinaryName() {
  return os.platform() === "win32" ? "resume-helper.exe" : "resume-helper";
}

function findBinary(startDir) {
  var packageName = getPlatformPackageName();
  var binaryName = getBinaryName();
  var current = startDir;

  // Walk up the directory tree looking for node_modules
  for (;;) {
    var modulesDir = path.join(current, "node_modules");

    if (fs.existsSync(modulesDir)) {
      // Look for exact package match
      var exactPath = path.join(modulesDir, packageName, "bin", binaryName);
      if (fs.existsSync(exactPath)) {
        return exactPath;
      }

      // Look for any matching package (handles baseline variants)
      try {
        var entries = fs.readdirSync(modulesDir);
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.indexOf(packageName) !== 0) continue;
          var candidate = path.join(modulesDir, entry, "bin", binaryName);
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      } catch (e) {
        // Ignore read errors
      }
    }

    var parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

function findBinaryInDist() {
  // For development: look in dist/<package>/bin/
  var packageName = getPlatformPackageName();
  var binaryName = getBinaryName();
  var scriptDir = __dirname;
  var packageRoot = path.dirname(scriptDir);
  var distPath = path.join(
    packageRoot,
    "dist",
    packageName,
    "bin",
    binaryName
  );

  if (fs.existsSync(distPath)) {
    return distPath;
  }

  return null;
}

function run(binaryPath) {
  var result = childProcess.spawnSync(
    binaryPath,
    process.argv.slice(2),
    {
      stdio: "inherit",
    }
  );

  if (result.error) {
    console.error("Failed to execute binary: " + result.error.message);
    process.exit(1);
  }

  process.exit(result.status || 0);
}

function main() {
  // Try to find in node_modules first (production)
  var binaryPath = findBinary(path.dirname(fs.realpathSync(__filename)));

  // Fall back to dist directory (development)
  if (!binaryPath) {
    binaryPath = findBinaryInDist();
  }

  if (!binaryPath) {
    var packageName = getPlatformPackageName();
    console.error(
      "resume-helper: Could not find binary for your platform.\n" +
      "Expected package: " + packageName + "\n" +
      "Platform: " + os.platform() + "-" + os.arch() + "\n\n" +
      "This usually means:\n" +
      "1. The optional dependency for your platform was not installed\n" +
      "2. You need to build from source: bun run scripts/build.ts --current\n\n" +
      "If you installed with npm, try: npm install --include=optional"
    );
    process.exit(1);
  }

  run(binaryPath);
}

main();
