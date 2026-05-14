import { describe, it, expect } from "vitest"
import path from "path"
import os from "os"
import { validateWritePath } from "../agent"

const WORKDIR = path.join(os.tmpdir(), "inkora-test-workdir")

describe("validateWritePath — path traversal", () => {
    it("accepte un chemin relatif dans le workdir", () => {
        const result = validateWritePath("src/index.ts", WORKDIR)
        expect(result.safe).toBe(true)
        expect(result.resolved).toBe(path.join(WORKDIR, "src", "index.ts"))
    })

    it("accepte un chemin absolu dans le workdir", () => {
        const result = validateWritePath(path.join(WORKDIR, "file.ts"), WORKDIR)
        expect(result.safe).toBe(true)
    })

    it("bloque une remontée de répertoire (../)", () => {
        const result = validateWritePath("../../etc/passwd", WORKDIR)
        expect(result.safe).toBe(false)
        expect(result.error).toMatch(/hors du répertoire/)
    })

    it("bloque un chemin absolu hors du workdir", () => {
        const result = validateWritePath("/tmp/evil.sh", WORKDIR)
        expect(result.safe).toBe(false)
    })
})

describe.skipIf(process.platform === "win32")("validateWritePath — répertoires système (Linux)", () => {
    it("bloque /etc", () => {
        const result = validateWritePath("/etc/passwd", "/etc")
        // workdir=/etc, path=/etc/passwd — dans workdir mais bloque par SYSTEM_DIRS
        // Actually, workdir=/etc means base=/etc, and /etc/passwd starts with /etc+sep
        // but SYSTEM_DIRS check should block it
        // Wait: the check is SYSTEM_DIRS.some(d => resolved.startsWith(d))
        // /etc/passwd starts with /etc — blocked
        expect(result.safe).toBe(false)
        expect(result.error).toMatch(/répertoire système/)
    })

    it("bloque /bin", () => {
        const result = validateWritePath("/bin/bash", "/bin")
        expect(result.safe).toBe(false)
    })

    it("bloque /sys", () => {
        const result = validateWritePath("/sys/kernel/config", "/sys")
        expect(result.safe).toBe(false)
    })
})

describe.skipIf(process.platform === "win32" || !process.env.HOME)("validateWritePath — fichiers sensibles home (Linux)", () => {
    it("bloque ~/.ssh/id_rsa", () => {
        const home = process.env.HOME!
        const result = validateWritePath(path.join(home, ".ssh", "id_rsa"), home)
        expect(result.safe).toBe(false)
        expect(result.error).toMatch(/fichier de configuration sensible/)
    })

    it("bloque ~/.bashrc", () => {
        const home = process.env.HOME!
        const result = validateWritePath(path.join(home, ".bashrc"), home)
        expect(result.safe).toBe(false)
    })

    it("autorise un fichier normal dans ~", () => {
        const home = process.env.HOME!
        const result = validateWritePath(path.join(home, "my-project", "main.ts"), home)
        expect(result.safe).toBe(true)
    })
})
