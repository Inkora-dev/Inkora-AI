import { parse } from "@typescript-eslint/typescript-estree"
import type { TSESTree } from "@typescript-eslint/typescript-estree"
import { readFile, readdir } from "fs/promises"
import path from "path"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AstSymbol {
    name: string
    kind: string
    line: number
    exported: boolean
}

// ─── TS/JS parser ─────────────────────────────────────────────────────────────

function extractSymbols(code: string, isJsx: boolean): AstSymbol[] {
    let ast: TSESTree.Program
    try {
        ast = parse(code, { jsx: isJsx, loc: true, range: false, tokens: false, comment: false, errorOnUnknownASTType: false })
    } catch {
        return []
    }

    const symbols: AstSymbol[] = []

    function visit(node: TSESTree.Node, isExported: boolean) {
        const line = node.loc?.start.line ?? 0

        if (node.type === "FunctionDeclaration" && node.id) {
            symbols.push({ name: node.id.name, kind: "function", line, exported: isExported })
        } else if (node.type === "ClassDeclaration" && node.id) {
            symbols.push({ name: node.id.name, kind: "class", line, exported: isExported })
        } else if (node.type === "TSInterfaceDeclaration") {
            symbols.push({ name: node.id.name, kind: "interface", line, exported: isExported })
        } else if (node.type === "TSTypeAliasDeclaration") {
            symbols.push({ name: node.id.name, kind: "type", line, exported: isExported })
        } else if (node.type === "VariableDeclaration") {
            for (const decl of node.declarations) {
                if (decl.id.type !== "Identifier") continue
                const init = decl.init
                const isFunc = init && (
                    init.type === "ArrowFunctionExpression" ||
                    init.type === "FunctionExpression"
                )
                symbols.push({
                    name: decl.id.name,
                    kind: isFunc ? "function" : node.kind,
                    line: decl.loc?.start.line ?? line,
                    exported: isExported,
                })
            }
        } else if (node.type === "ExportNamedDeclaration") {
            if (node.declaration) visit(node.declaration, true)
            for (const spec of node.specifiers) {
                if (spec.exported.type === "Identifier") {
                    symbols.push({ name: spec.exported.name, kind: "re-export", line, exported: true })
                }
            }
        } else if (node.type === "ExportDefaultDeclaration") {
            if (node.declaration.type === "FunctionDeclaration" && node.declaration.id) {
                symbols.push({ name: node.declaration.id.name, kind: "function", line, exported: true })
            } else if (node.declaration.type === "ClassDeclaration" && node.declaration.id) {
                symbols.push({ name: node.declaration.id.name, kind: "class", line, exported: true })
            } else {
                symbols.push({ name: "(default)", kind: "export default", line, exported: true })
            }
        }
    }

    for (const node of ast.body) visit(node, false)
    return symbols
}

// ─── Regex fallback (Python, Go, Rust…) ───────────────────────────────────────

const REGEX_PATTERNS: Record<string, RegExp[]> = {
    ".py": [/^(async\s+)?def\s+(\w+)/m, /^class\s+(\w+)/m],
    ".go": [/^func\s+(\w+)/, /^type\s+(\w+)\s+struct/],
    ".rs": [/^pub\s+fn\s+(\w+)/, /^fn\s+(\w+)/, /^pub\s+struct\s+(\w+)/],
}

function extractRegexSymbols(code: string, ext: string): AstSymbol[] {
    const patterns = REGEX_PATTERNS[ext]
    if (!patterns) return []
    const symbols: AstSymbol[] = []
    const lines = code.split("\n")
    lines.forEach((line, idx) => {
        for (const re of patterns) {
            const m = line.match(re)
            if (m) {
                const name = m[2] ?? m[1]
                if (name) symbols.push({ name, kind: re.source.includes("def") || re.source.includes("fn") ? "function" : "class", line: idx + 1, exported: line.includes("pub ") })
            }
        }
    })
    return symbols
}

// ─── Format output ─────────────────────────────────────────────────────────────

function formatSymbols(symbols: AstSymbol[], filePath: string): string {
    if (symbols.length === 0) return `Aucun symbole trouvé dans ${path.basename(filePath)}`

    const grouped: Record<string, AstSymbol[]> = {}
    for (const s of symbols) {
        ;(grouped[s.kind] ??= []).push(s)
    }

    const lines = [`# ${path.basename(filePath)}\n`]
    const ORDER = ["class", "interface", "type", "function", "const", "let", "var", "export default", "re-export"]
    const kinds = [...ORDER.filter((k) => grouped[k]), ...Object.keys(grouped).filter((k) => !ORDER.includes(k))]

    for (const kind of kinds) {
        const items = grouped[kind]
        lines.push(`${kind.toUpperCase()}S (${items.length}):`)
        for (const s of items) {
            const exp = s.exported ? " [export]" : ""
            lines.push(`  ${s.name.padEnd(28)} line ${s.line}${exp}`)
        }
        lines.push("")
    }
    return lines.join("\n").trim()
}

// ─── Public API ───────────────────────────────────────────────────────────────

const TS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"])

export async function astSymbols(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase()
    let code: string
    try {
        code = await readFile(filePath, "utf-8")
    } catch (err) {
        return `Impossible de lire ${filePath}: ${String(err)}`
    }

    const symbols = TS_EXTS.has(ext)
        ? extractSymbols(code, ext === ".tsx" || ext === ".jsx")
        : extractRegexSymbols(code, ext)

    return formatSymbols(symbols, filePath)
}

export async function astFindDefinition(name: string, dir: string): Promise<string> {
    const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv"])
    const results: string[] = []

    async function walk(current: string, depth: number): Promise<void> {
        if (depth > 6 || results.length >= 20) return
        const entries = await readdir(current, { withFileTypes: true }).catch(() => null)
        if (!entries) return
        for (const entry of entries) {
            if (entry.name.startsWith(".") || SKIP.has(entry.name) || entry.isSymbolicLink()) continue
            const fullPath = path.join(current, entry.name)
            if (entry.isDirectory()) {
                await walk(fullPath, depth + 1)
            } else {
                const ext = path.extname(entry.name).toLowerCase()
                if (!TS_EXTS.has(ext)) continue
                const code = await readFile(fullPath, "utf-8").catch(() => "")
                if (!code) continue
                const symbols = extractSymbols(code, ext === ".tsx" || ext === ".jsx")
                const match = symbols.find((s) => s.name === name)
                if (match) {
                    results.push(`${fullPath}:${match.line} — ${match.kind}${match.exported ? " [export]" : ""}`)
                }
            }
        }
    }

    await walk(path.resolve(dir), 0)

    if (results.length === 0) return `Symbole "${name}" introuvable dans ${dir}`
    return `Définitions de "${name}":\n${results.join("\n")}`
}
