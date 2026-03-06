import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { writeWorkflow } from "./write"

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

const mockMkdirSync = vi.mocked(mkdirSync)
const mockWriteFileSync = vi.mocked(writeFileSync)

describe("writeWorkflow", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("creates the .github/workflows directory", () => {
    writeWorkflow("ci", "content", "/tmp/project")
    expect(mockMkdirSync).toHaveBeenCalledWith(
      join("/tmp/project", ".github", "workflows"),
      { recursive: true },
    )
  })

  it("writes content to the correct file path", () => {
    writeWorkflow("ci", "my-yaml", "/tmp/project")
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join("/tmp/project", ".github", "workflows", "ci.yml"),
      "my-yaml",
      "utf8",
    )
  })

  it("returns the full file path", () => {
    const result = writeWorkflow("deploy", "content", "/tmp/project")
    expect(result).toBe(
      join("/tmp/project", ".github", "workflows", "deploy.yml"),
    )
  })

  it("uses process.cwd() as default directory", () => {
    writeWorkflow("ci", "content")
    const expectedDir = join(process.cwd(), ".github", "workflows")
    expect(mockMkdirSync).toHaveBeenCalledWith(expectedDir, {
      recursive: true,
    })
  })
})
