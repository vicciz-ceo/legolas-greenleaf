export async function currentSha(): Promise<string> {
  const { stdout } = await new Deno.Command("git", {
    args: ["rev-parse", "--short", "HEAD"],
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(stdout).trim();
}

export async function isDirty(): Promise<boolean> {
  const { stdout } = await new Deno.Command("git", {
    args: ["status", "--porcelain"],
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(stdout).trim().length > 0;
}
