/**
 * Những dòng cấu hình mà thiếu chúng Công cụ AI hỏng LẶNG LẼ — đọc PDF trả rỗng,
 * trang vỡ vì 413, khoá API lọt xuống trình duyệt — mà cả bốn cổng vẫn xanh.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_AI_FILE_BYTES } from "@/lib/ai/upload-core";

const ROOT = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

type Version = [number, number, number];

function parseVersion(value: string): Version {
  const [major = 0, minor = 0, patch = 0] = value.replace(/^[^\d]*/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch];
}

function compare(a: Version, b: Version): number {
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

/** Đủ cho dạng `engines` npm hay dùng: ">=20.16.0 <21 || >=22.3.0". */
function satisfies(version: string, range: string): boolean {
  const current = parseVersion(version);
  return range.split("||").some((alternative) =>
    alternative
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((condition) => {
        const match = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(condition);
        if (!match) return false;
        const order = compare(current, parseVersion(match[2]));
        switch (match[1]) {
          case ">=":
            return order >= 0;
          case ">":
            return order > 0;
          case "<=":
            return order <= 0;
          case "<":
            return order < 0;
          default:
            return order === 0;
        }
      })
  );
}

describe("next.config.mjs", () => {
  it("giữ pdf-parse và @napi-rs/canvas ngoài bundle — thiếu dòng này mọi PDF đọc ra rỗng", async () => {
    const configPath = pathToFileURL(join(ROOT, "next.config.mjs")).href;
    const config = (await import(/* @vite-ignore */ configPath)).default;
    expect(config.serverExternalPackages).toEqual(expect.arrayContaining(["pdf-parse", "@napi-rs/canvas"]));
  });

  it("nới giới hạn thân server action đủ cho một file tối đa, và không hơn nhiều", async () => {
    const configPath = pathToFileURL(join(ROOT, "next.config.mjs")).href;
    const config = (await import(/* @vite-ignore */ configPath)).default;
    const limit = String(config.experimental?.serverActions?.bodySizeLimit ?? "");
    const match = /^(\d+)mb$/i.exec(limit);
    expect(match).not.toBeNull();
    const bytes = Number(match![1]) * 1024 * 1024;
    expect(bytes).toBeGreaterThan(MAX_AI_FILE_BYTES);
    // Giới hạn này áp cho cả form ứng tuyển công khai.
    expect(bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
});

describe("gói phụ thuộc", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));

  it("có đúng các gói module cần, không có SDK hay thư viện đã quyết định bỏ", () => {
    for (const name of ["pdf-parse", "mammoth", "pizzip", "zod"]) expect(pkg.dependencies[name], name).toBeDefined();
    // exceljs: đọc XLSX bằng pizzip, khỏi kéo archiver/unzipper/uuid.
    // @anthropic-ai/sdk: module chỉ dùng DeepSeek.
    // pdfjs-dist, @napi-rs/canvas: pdf-parse tự ghim; khai trực tiếp chỉ tạo bản sao thừa.
    for (const name of ["exceljs", "@anthropic-ai/sdk", "pdfjs-dist", "@napi-rs/canvas"]) {
      expect(pkg.dependencies[name], name).toBeUndefined();
      expect(pkg.devDependencies?.[name], name).toBeUndefined();
    }
  });

  it("pdf-parse và pdf.js mà nó dùng chạy được trên đúng bản Node của CI", () => {
    const ciVersions = readdirSync(join(ROOT, ".github", "workflows"))
      .map((file) => read(".github", "workflows", file))
      .flatMap((workflow) => Array.from(workflow.matchAll(/node-version:\s*["']?([\d.]+)["']?/g), (match) => match[1]));
    expect(ciVersions.length).toBeGreaterThan(0);

    const pdfParse = lock.packages["node_modules/pdf-parse"];
    const pdfjs = lock.packages["node_modules/pdf-parse/node_modules/pdfjs-dist"] ?? lock.packages["node_modules/pdfjs-dist"];
    expect(pdfParse?.engines?.node).toBeTruthy();
    expect(pdfjs?.engines?.node).toBeTruthy();
    for (const version of ciVersions) {
      expect(satisfies(version, pdfParse.engines.node), `pdf-parse ${pdfParse.engines.node} trên Node ${version}`).toBe(true);
      expect(satisfies(version, pdfjs.engines.node), `pdfjs-dist ${pdfjs.engines.node} trên Node ${version}`).toBe(true);
    }
  });

  it("bộ so khớp phiên bản tự nó đúng", () => {
    expect(satisfies("20.19.0", ">=20.16.0 <21 || >=22.3.0")).toBe(true);
    expect(satisfies("21.5.0", ">=20.16.0 <21 || >=22.3.0")).toBe(false);
    expect(satisfies("20.19.0", ">=22.13.0 || >=24")).toBe(false);
  });
});

describe("khoá API chỉ ở phía server", () => {
  const sourceFiles = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
      }
    };
    for (const dir of ["app", "lib", "components"]) walk(join(ROOT, dir));
    return out;
  })();

  it("không biến AI nào mang tiền tố NEXT_PUBLIC_", () => {
    const offenders = sourceFiles.filter((file) => /NEXT_PUBLIC_(DEEPSEEK|TAVILY)/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
    expect(read(".env.local.example")).not.toMatch(/NEXT_PUBLIC_(DEEPSEEK|TAVILY)/);
  });

  it("chỉ lớp gọi AI đọc khoá, và file mẫu env để trống giá trị", () => {
    const readers = sourceFiles
      .filter((file) => /process\.env\.(DEEPSEEK_API_KEY|TAVILY_API_KEY)/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(ROOT.length + 1).replace(/\\/g, "/"))
      .sort();
    expect(readers).toEqual(["lib/ai/deepseek.ts", "lib/ai/websearch.ts"]);
    const example = read(".env.local.example");
    expect(example).toMatch(/^DEEPSEEK_API_KEY=$/m);
    expect(example).toMatch(/^TAVILY_API_KEY=$/m);
  });

  it("không component client nào import lớp gọi AI, đọc file hay nạp số liệu", () => {
    const serverOnly = /from\s+["']@\/lib\/ai\/(deepseek|websearch|uploads|extract-text|executive-report)["']/;
    const offenders = sourceFiles.filter((file) => {
      const code = readFileSync(file, "utf8");
      return /^\s*["']use client["']/.test(code) && serverOnly.test(code);
    });
    expect(offenders).toEqual([]);
  });

  it("mọi file của lớp gọi AI có server-only", () => {
    for (const name of ["deepseek", "websearch", "uploads", "extract-text", "executive-report"]) {
      expect(read("lib", "ai", `${name}.ts`).startsWith('import "server-only";'), name).toBe(true);
    }
  });
});
