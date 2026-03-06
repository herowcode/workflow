import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export function writeWorkflow(
  name: string,
  content: string,
  cwd = process.cwd(),
): string {
  const dir = join(cwd, ".github", "workflows")
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${name}.yml`)
  writeFileSync(filePath, content, "utf8")
  return filePath
}
