import chalk from "chalk";

/**
 * Read multiline input from stdin until termination signal.
 *
 * Supports two termination methods:
 * 1. Typing '--end--' on a new line (case-insensitive)
 * 2. Pressing Ctrl+D (EOF signal)
 *
 * @returns The collected input as a single string (lines joined with \n)
 */
export async function readMultilineInput(): Promise<string> {
  const lines: string[] = [];
  const readline = await import("readline");

  console.log(chalk.dim("When done, type '--end--' on a new line or press Ctrl+D:\n"));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const handleClose = () => {
      resolve(lines.join("\n"));
    };

    // Handle Ctrl+D (EOF)
    rl.on("close", handleClose);

    const readLine = () => {
      rl.question("", (line) => {
        // Check for termination sequence
        if (line.trim().toLowerCase() === "--end--") {
          rl.off("close", handleClose); // Remove listener to avoid double-resolve
          rl.close();
          resolve(lines.join("\n"));
        } else {
          lines.push(line);
          readLine();
        }
      });
    };

    readLine();
  });
}
