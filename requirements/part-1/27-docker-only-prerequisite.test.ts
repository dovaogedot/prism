/**
 * REQUIREMENTS_1.md: "Project application is containerized using Docker. The
 * project uses Docker to containerize the application and its dependencies.
 * Docker is the only host prerequisite - all other dependencies are managed
 * within containers."
 *
 * The start scripts are read for every command they run on the host: Docker
 * passes, as do the shell's own commands, coreutils and grep, which every
 * machine with that shell has. Anything a container runs is an argument of a
 * `docker` command and is not a host command.
 */

import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readRepositoryFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")

/** One word or operator of a script. */
type Token = { kind: "word" | "operator" | "string"; text: string }

/** What a script runs and defines. */
type Found = { commands: string[]; functions: string[] }

/** A bash script's commands, read the way bash splits them. */
const BashScript = {
  /** Every command `source` runs, those inside `$( )` and backticks included, and the functions it defines. */
  scan: (source: string): Found => {
    const found: Found = { commands: [], functions: [] }
    BashScript.collect(BashScript.lex(source, 0, false, found).tokens, found)

    return found
  },

  /**
   * Splits `source` from `start` into words and operators, dropping comments,
   * heredoc bodies and redirection targets, and scanning each command
   * substitution into `found`. With `isNested` it stops after the `)` that
   * closes a substitution and answers the index after it.
   */
  lex: (source: string, start: number, isNested: boolean, found: Found): { tokens: Token[]; end: number } => {
    const tokens: Token[] = []
    const heredocs: { delimiter: string; isIndented: boolean }[] = []
    let word = ""
    let hasWord = false
    let isRedirectTarget = false
    let depth = 0
    let index = start

    const endWord = (): void => {
      if (hasWord && !isRedirectTarget) {
        tokens.push({ kind: "word", text: word })
      }

      if (hasWord) {
        isRedirectTarget = false
      }

      word = ""
      hasWord = false
    }

    // From just after `$(`, to just after its `)`.
    const substitute = (from: number): number => {
      const inner = BashScript.lex(source, from, true, found)
      BashScript.collect(inner.tokens, found)

      return inner.end
    }

    // From an opening `{` or `(`, to just after the one that closes it.
    const skipBalanced = (from: number, open: string, close: string): number => {
      let level = 0
      let at = from

      do {
        level += source[at] === open ? 1 : 0
        level -= source[at] === close ? 1 : 0
        at += 1
      } while (level > 0 && at < source.length)

      return at
    }

    const skipDoubleQuoted = (from: number): number => {
      let at = from

      while (at < source.length && source[at] !== '"') {
        if (source[at] === "\\") {
          at += 2
        } else if (source.startsWith("$(", at)) {
          at = substitute(at + 2)
        } else if (source.startsWith("${", at)) {
          at = skipBalanced(at + 1, "{", "}")
        } else {
          at += 1
        }
      }

      return at + 1
    }

    const skipHeredocBodies = (from: number): number => {
      let at = from

      for (const { delimiter, isIndented } of heredocs.splice(0)) {
        while (at < source.length) {
          const lineEnd = BashScript.indexOrEnd(source, "\n", at)
          const line = source.slice(at, lineEnd)
          at = lineEnd + 1

          if ((isIndented ? line.replace(/^\t+/, "") : line) === delimiter) {
            break
          }
        }
      }

      return at
    }

    while (index < source.length) {
      const char = source.charAt(index)
      const rest = source.slice(index, index + 3)
      const heredoc = /^<<(-?)\s*(['"]?)(\w+)\2/.exec(source.slice(index, index + 80))
      const redirect = /^(&>>?|>>|>&|<&|>\||>|<)/.exec(source.slice(index, index + 3))

      if (char === "\\") {
        word += source.charAt(index + 1) === "\n" ? "" : source.charAt(index + 1)
        hasWord ||= source.charAt(index + 1) !== "\n"
        index += 2
      } else if (char === "'") {
        const close = BashScript.indexOrEnd(source, "'", index + 1)
        word += source.slice(index + 1, close)
        hasWord = true
        index = close + 1
      } else if (char === '"') {
        hasWord = true
        index = skipDoubleQuoted(index + 1)
      } else if (char === "`") {
        const close = BashScript.indexOrEnd(source, "`", index + 1)
        BashScript.collect(BashScript.lex(source.slice(index + 1, close), 0, false, found).tokens, found)
        hasWord = true
        index = close + 1
      } else if (rest === "$((") {
        hasWord = true
        index = skipBalanced(index + 1, "(", ")")
      } else if (rest.startsWith("$(")) {
        hasWord = true
        index = substitute(index + 2)
      } else if (rest.startsWith("${")) {
        hasWord = true
        index = skipBalanced(index + 1, "{", "}")
      } else if (char === "#" && !hasWord) {
        index = BashScript.indexOrEnd(source, "\n", index)
      } else if (char === " " || char === "\t" || char === "\r") {
        endWord()
        index += 1
      } else if (char === "\n") {
        endWord()
        tokens.push({ kind: "operator", text: "\n" })
        index = skipHeredocBodies(index + 1)
      } else if (rest === "<<<") {
        endWord()
        isRedirectTarget = true
        index += 3
      } else if (heredoc !== null) {
        endWord()
        heredocs.push({ delimiter: String(heredoc[3]), isIndented: heredoc[1] === "-" })
        index += heredoc[0].length
      } else if (redirect !== null) {
        // A file descriptor's number, as in 2>&1, belongs to the redirection and is no word of the command.
        if (/^\d+$/.test(word)) {
          word = ""
          hasWord = false
        }

        endWord()
        isRedirectTarget = true
        index += redirect[0].length
      } else if (char === "(" && word.endsWith("=")) {
        // An array assignment, `name=( ... )`, is a value and runs nothing.
        hasWord = true
        index = skipBalanced(index, "(", ")")
      } else if (char === "(") {
        endWord()
        tokens.push({ kind: "operator", text: "(" })
        depth += 1
        index += 1
      } else if (char === ")") {
        endWord()
        index += 1

        if (isNested && depth === 0) {
          return { tokens, end: index }
        }

        depth = Math.max(0, depth - 1)
        tokens.push({ kind: "operator", text: ")" })
      } else if (";&|".includes(char)) {
        endWord()
        const operator = source.charAt(index + 1) === char ? char + char : char
        tokens.push({ kind: "operator", text: operator })
        index += operator.length
      } else {
        word += char
        hasWord = true
        index += 1
      }
    }

    endWord()

    return { tokens, end: index }
  },

  /** Where `text` next holds `search` from `from` on, or its end when it holds it no more. */
  indexOrEnd: (text: string, search: string, from: number): number =>
    text.includes(search, from) ? text.indexOf(search, from) : text.length,

  /** Adds the command each simple command of `tokens` runs, and each function they define, to `found`. */
  collect: (tokens: Token[], found: Found): void => {
    // Words that open or close a compound command; the command they hold follows them.
    const keywords = new Set(["if", "then", "else", "elif", "fi", "while", "until", "do", "done", "!", "time", "{", "}"])
    // Commands that run the command named after them.
    const prefixes = new Set(["exec", "command", "builtin", "env", "nohup"])
    const cases: ("pattern" | "body")[] = []
    let words: string[] = []

    const finish = (): void => {
      let rest = words
      words = []

      while (rest.length > 0) {
        const [first = "", ...others] = rest

        if (/^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/.test(first) || keywords.has(first)) {
          rest = others
        } else if (first === "esac") {
          cases.pop()
          rest = others
        } else if (first === "case") {
          cases.push("pattern")
          return
        } else if (first === "for" || first === "select") {
          return
        } else {
          found.commands.push(first)
          rest = prefixes.has(first) ? others.filter((other) => !other.startsWith("-")) : []
        }
      }
    }

    for (const [index, token] of tokens.entries()) {
      if (cases.at(-1) === "pattern") {
        if (token.text === "esac" && token.kind === "word") {
          cases.pop()
        } else if (token.text === ")" && token.kind === "operator") {
          cases[cases.length - 1] = "body"
        }
      } else if (token.kind === "word") {
        words.push(token.text)
      } else if (token.text === "(" && words.length === 1 && tokens[index + 1]?.text === ")") {
        found.functions.push(String(words[0]))
        words = []
      } else if (token.text !== ")" || tokens[index - 1]?.text !== "(") {
        finish()

        if (token.text === ";;" && cases.length > 0) {
          cases[cases.length - 1] = "pattern"
        }
      }
    }

    finish()
  },
} as const

/** A PowerShell script's commands: the first name of every statement and pipeline stage. */
const PowerShellScript = {
  /** Every command `source` runs, those inside `$( )` included, and the functions it defines. */
  scan: (source: string, found: Found = { commands: [], functions: [] }): Found => {
    PowerShellScript.collect(PowerShellScript.lex(source, found), found)

    return found
  },

  /** Splits `source` into words, strings and operators, dropping comments and scanning each `$( )` inside a string into `found`. */
  lex: (source: string, found: Found): Token[] => {
    const tokens: Token[] = []
    let index = 0

    // Code inside a string's `$( )` runs too.
    const scanSubexpressions = (text: string): void => {
      for (const match of text.matchAll(/\$\(/g)) {
        let level = 1
        let at = match.index + 2

        while (level > 0 && at < text.length) {
          level += text[at] === "(" ? 1 : 0
          level -= text[at] === ")" ? 1 : 0
          at += 1
        }

        PowerShellScript.scan(text.slice(match.index + 2, at - 1), found)
      }
    }

    while (index < source.length) {
      const char = source.charAt(index)
      const pair = source.slice(index, index + 2)

      if (pair === "<#") {
        index = source.indexOf("#>", index) + 2
      } else if (char === "#") {
        index = BashScript.indexOrEnd(source, "\n", index)
      } else if (pair === "`\n" || char === " " || char === "\t" || char === "\r") {
        index += char === "`" ? 2 : 1
      } else if (pair === '@"' || pair === "@'") {
        const close = source.indexOf(`\n${pair.charAt(1)}@`, index)

        if (pair === '@"') {
          scanSubexpressions(source.slice(index, close))
        }

        tokens.push({ kind: "string", text: source.slice(index + 2, close) })
        index = close + 3
      } else if (char === "'" || char === '"') {
        let close = index + 1

        while (close < source.length && (source[close] !== char || source[close + 1] === char)) {
          close += source[close] === char || source[close] === "`" ? 2 : 1
        }

        if (char === '"') {
          scanSubexpressions(source.slice(index + 1, close))
        }

        tokens.push({ kind: "string", text: source.slice(index + 1, close) })
        index = close + 1
      } else if (pair === "@(" || pair === "$(" || pair === "@{") {
        tokens.push({ kind: "operator", text: pair.charAt(1) })
        index += 2
      } else if ("\n(){};|,=".includes(char)) {
        tokens.push({ kind: "operator", text: char })
        index += 1
      } else {
        const word = /^[^\s(){};|,='"]+/.exec(source.slice(index))?.[0] ?? char
        tokens.push({ kind: "word", text: word })
        index += word.length
      }
    }

    return tokens
  },

  /** Adds the name at the head of each statement and pipeline stage in `tokens`, and each function they define, to `found`. */
  collect: (tokens: Token[], found: Found): void => {
    const keywords = new Set(["if", "elseif", "else", "foreach", "for", "while", "do", "until", "switch", "try", "catch", "finally"])
    const statementKeywords = new Set(["return", "exit", "throw", "break", "continue", "param"])
    let isCommandPosition = true
    let isFunctionName = false

    for (const token of tokens) {
      const name = token.text.toLowerCase()

      if (token.kind === "operator") {
        isCommandPosition = ["\n", ";", "{", "}", "(", "|", "="].includes(token.text)
      } else if (token.kind === "string") {
        isCommandPosition = false
      } else if (isFunctionName) {
        found.functions.push(token.text)
        isFunctionName = false
        isCommandPosition = false
      } else if (isCommandPosition && name === "function") {
        isFunctionName = true
      } else if (isCommandPosition && (keywords.has(name) || name === "&")) {
        isCommandPosition = true
      } else if (isCommandPosition && /^[a-z_][\w.-]*$/i.test(token.text) && !statementKeywords.has(name)) {
        found.commands.push(token.text)
        isCommandPosition = false
      } else {
        isCommandPosition = false
      }
    }
  },
} as const

/** Each command `found` runs that is neither one of `allowed` nor a function the script defines, once each and sorted. */
const listForeign = (found: Found, allowed: Set<string>, isCaseBlind: boolean): string[] => {
  const normalize = (name: string): string => (isCaseBlind ? name.toLowerCase() : name)
  const defined = new Set(found.functions.map(normalize))

  return [...new Set(found.commands.map(normalize))].filter((command) => !allowed.has(command) && !defined.has(command)).toSorted()
}

/** What bash offers on any machine: its builtins, coreutils and grep. */
const bashAllowed = new Set([
  ...". : [ [[ break builtin cd command continue declare echo eval exec exit export false getopts local printf pwd read".split(" "),
  ..."readonly return set shift source test trap true type unset wait".split(" "),
  ..."basename cat chmod chown cp cut date dirname env head id ln ls mkdir mktemp mv nohup readlink realpath rm rmdir".split(" "),
  ..."seq sleep sort stat tail tee touch tr uname uniq wc grep docker".split(" "),
])

/** What PowerShell offers on any Windows machine: the cmdlets of its own modules. */
const powerShellAllowed = new Set(
  [
    ..."Write-Host Write-Output Write-Error Join-Path Split-Path Resolve-Path Test-Path Copy-Item Move-Item Remove-Item".split(" "),
    ..."New-Item Get-Item Get-ChildItem Get-Content Set-Content Add-Content Out-File Out-Null Where-Object Select-Object".split(" "),
    ..."ForEach-Object Sort-Object Set-Location Get-Location Start-Sleep docker".split(" "),
  ].map((name) => name.toLowerCase()),
)

describe("the start scripts", () => {
  it("are read by a check that finds a host tool wherever a command can stand, and only there", () => {
    const bash = [
      "helper() {",
      "  docker compose run --rm seed node seed.ts",
      "}",
      'if curl -fs https://localhost/health >/dev/null 2>&1; then echo "up"; fi',
      'version="$(node --version)"',
      "cat <<TEXT",
      "psql is only text here",
      "TEXT",
      "grep -q x .env && npx prettier . # wget is only a comment here",
      "docker run --rm node:26 npm ci | k6 run x.js",
      "helper",
    ].join("\n")
    const powerShell = [
      "function Invoke-Tool { docker compose ps }",
      'if ($x) { curl.exe -kfs -o NUL "https://localhost" }',
      "$version = (node --version)",
      'Write-Host "psql is only text here" # wget is only a comment here',
      "docker run --rm node:26 npm ci | k6 run x.js",
      "Invoke-Tool",
    ].join("\n")

    expect(listForeign(BashScript.scan(bash), bashAllowed, false)).toEqual(["curl", "k6", "node", "npx"])
    expect(listForeign(PowerShellScript.scan(powerShell), powerShellAllowed, true)).toEqual(["curl.exe", "k6", "node"])
  })

  it("run nothing on a Linux or macOS host but Docker and what bash itself offers", () => {
    const found = BashScript.scan(readRepositoryFile("start.sh"))

    expect(found.commands).toContain("docker")
    expect(listForeign(found, bashAllowed, false)).toEqual([])
  })

  it("run nothing on a Windows host but Docker and what PowerShell itself offers", () => {
    const found = PowerShellScript.scan(readRepositoryFile("start.ps1"))
    const launcher = readRepositoryFile("start.cmd")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)

    expect(found.commands).toContain("docker")
    expect(listForeign(found, powerShellAllowed, true)).toEqual([])
    // start.cmd only hands start.ps1 to the PowerShell every Windows has.
    expect(launcher.every((line) => /^(@echo off|rem .*|powershell .*"%~dp0start\.ps1" %\*)$/i.test(line))).toBe(true)
  })
})

describe("the containers", () => {
  /** Each service of a compose file that names an image or a build, with the lines that define it. */
  const listServices = (path: string): Map<string, string> =>
    new Map(
      [...readRepositoryFile(path).matchAll(/^ {2}(\w[\w-]*):\n([\s\S]*?)(?=^ {2}\w|^\S|(?![\s\S]))/gm)]
        .filter(([, , body]) => /^ {4}(image|build):/m.test(String(body)))
        .map(([, name, body]) => [String(name), String(body)]),
    )

  it("run every part of the shop and its tests, each from a pinned image or a Dockerfile in the repository", () => {
    const shop = listServices("docker-compose.yml")
    // The browser suite's and the load test's files add their own services, and only adjust the shop's.
    const overlays = [...listServices("docker-compose.e2e.yml"), ...listServices("docker-compose.loadtest.yml")].filter(
      ([name]) => !shop.has(name),
    )
    const services = new Map([...shop, ...overlays])

    expect([...services.keys()]).toEqual(
      expect.arrayContaining(["postgres", "rabbitmq", "mailpit", "migrate", "api", "web", "seed", "test", "e2e", "k6"]),
    )

    for (const [name, body] of services) {
      const image = /^ {4}image: (\S+)$/m.exec(body)?.[1]
      const dockerfile = /^ {6}dockerfile: (\S+)$/m.exec(body)?.[1]

      if (image === undefined) {
        expect(dockerfile, name).toBeDefined()
        expect(existsSync(new URL(`../../${String(dockerfile)}`, import.meta.url)), name).toBe(true)
      } else {
        expect(image, name).toMatch(/^[\w./-]+:v?\d[\w.-]*$/)
      }
    }
  })

  it("build on pinned images and install every dependency of the code inside them, so the host needs no Node or npm", () => {
    for (const dockerfile of ["apps/api/Dockerfile", "apps/web/Dockerfile", "Dockerfile.test", "Dockerfile.e2e"]) {
      const text = readRepositoryFile(dockerfile)

      expect(text, dockerfile).toMatch(/^FROM [\w./-]+:v?\d[\w.-]*( AS \w+)?$/m)
      expect(text, dockerfile).toMatch(/^RUN npm ci\b/m)
    }
  })
})
