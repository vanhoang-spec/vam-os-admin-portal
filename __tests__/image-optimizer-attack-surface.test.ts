/**
 * Locks the image-processing attack surface that makes GHSA-f88m-g3jw-g9cj
 * (sharp < 0.35.0 / libvips CVE-2026-33327, -33328, -35590, -35591)
 * unreachable in deployed VAM OS.
 *
 * Next.js 15.5.23 pins `sharp` at `^0.34.3` as an optional dependency, so the
 * installed decoder IS a vulnerable one and cannot be moved to >= 0.35.0
 * without an unsupported override or a Next major upgrade. The release
 * therefore rests on the decoder being unreachable rather than on it being
 * patched, and "unreachable" is only true for as long as all four of the
 * conditions below hold:
 *
 *   1. No remote image source is allowed, so `/_next/image?url=https://...`
 *      is rejected before any fetch (`"url" parameter is not allowed`).
 *   2. Every `next/image` usage is `unoptimized`, so nothing in the UI routes
 *      bytes through the optimizer.
 *   3. No route handler returns `image/*`, so no same-origin path can hand
 *      attacker-controlled bytes to the optimizer's upstream fetch.
 *   4. Nothing imports `sharp` directly, bypassing all of the above.
 *
 * Measured against a real `next start` on this build: with all four holding,
 * every attacker-shaped request to `/_next/image` is refused with HTTP 400
 * before a decoder runs. A positive control — one GIF placed at a path the
 * middleware matcher excludes — returned HTTP 200 `image/webp`, confirming
 * these tests guard a live optimizer and not a dead endpoint.
 *
 * If a change has to break one of these, the sharp advisory must be
 * re-classified before that change ships.
 *
 * RE-CLASSIFIED 14/09/2026 for the AI tools (/ai), by the programme owner's
 * decision to accept document uploads. They are the first feature that takes
 * binary uploads (PDF, DOCX, XLSX), and pdf-parse brings a native graphics
 * library, @napi-rs/canvas, which pdf.js loads when pdf-parse is imported (it
 * polyfills DOMMatrix, Path2D and ImageData). Conditions 1–4 above are
 * unchanged and still pinned below. The uploads stay outside every image
 * decoder because:
 *
 *   - No image is accepted under any name. The accept list has no image type,
 *     and the server rejects image signatures even behind a .pdf or .txt name
 *     (lib/ai/upload-core.ts), deciding the type from the bytes, never from the
 *     browser-supplied MIME type.
 *   - Raw bytes are taken in exactly one place (lib/ai/uploads.ts) and handed
 *     only to text extractors. They are never stored, never returned under any
 *     content type, and never passed to sharp.
 *   - pdf-parse is only ever asked for text (`getText`). Nothing renders a page
 *     or pulls embedded images, which is the only path that would put image
 *     bytes into @napi-rs/canvas.
 *
 * Section 3b pins each of those. Widening any of them is a new
 * re-classification, not a test update.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { AI_UPLOAD_ACCEPT, AI_UPLOAD_KINDS, AI_UPLOAD_MIME } from "../lib/ai/upload-core";

const repoRoot = join(__dirname, "..");
const SOURCE_DIRS = ["app", "lib", "components"];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of SOURCE_DIRS) walk(join(repoRoot, dir));
  return out;
}

const relative = (file: string) => file.slice(repoRoot.length + 1).replace(/\\/g, "/");

describe("1. no remote image source reaches the optimizer", () => {
  const config = readFileSync(join(repoRoot, "next.config.mjs"), "utf8");

  it.each(["remotePatterns", "domains", "dangerouslyAllowSVG", "loaderFile"])(
    "next.config.mjs does not configure images.%s",
    (key) => {
      expect(config).not.toContain(key);
    }
  );

  it("next.config.mjs configures no images block at all", () => {
    // With no `images` key, remotePatterns and domains both default to [] and
    // the optimizer refuses every absolute URL.
    expect(config).not.toMatch(/\bimages\s*:/);
  });
});

describe("2. no UI path routes bytes through the optimizer", () => {
  const usages = sourceFiles()
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => source.includes("next/image"));

  it("every file importing next/image is accounted for", () => {
    // Kept explicit so that ADDING an optimized image is a failure here rather
    // than a silent widening of the attack surface.
    expect(usages.map((u) => relative(u.file))).toEqual([
      "app/events/[id]/registration-link-panel.tsx"
    ]);
  });

  it("every <Image> element is unoptimized", () => {
    for (const { file, source } of usages) {
      const elements = source.match(/<Image\b[\s\S]*?\/>/g) ?? [];
      expect(elements.length, `${file} imports next/image but renders no <Image>`).toBeGreaterThan(0);
      for (const element of elements) {
        expect(element, `${file}: <Image> is not unoptimized`).toContain("unoptimized");
      }
    }
  });

  it("the one optimized-image exemption renders a server-generated data URL, not user input", () => {
    const page = readFileSync(join(repoRoot, "app/events/[id]/page.tsx"), "utf8");
    // The QR source is produced by `qrcode` (a pure-JS PNG encoder) from a URL
    // the server built. No request value reaches it, and `unoptimized` keeps it
    // out of the optimizer regardless.
    expect(page).toMatch(/QRCode\.toDataURL\(/);
  });
});

describe("3. no same-origin path can serve attacker-controlled image bytes", () => {
  const routeHandlers = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/^route\.(ts|tsx|js)$/.test(entry.name)) out.push(full);
      }
    };
    walk(join(repoRoot, "app"));
    return out;
  })();

  it("no route handler responds with an image content type", () => {
    for (const file of routeHandlers) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} returns an image content type`).not.toMatch(/content-type["'\s:]+["']image\//i);
    }
  });

  it("the repository ships no image assets and no public/ directory", () => {
    // `public/` is served from the filesystem at runtime, so a file added there
    // becomes a same-origin image source the optimizer can fetch.
    expect(existsSync(join(repoRoot, "public"))).toBe(false);
  });

  it("no object-storage bucket is written or signed, so no upload becomes a served URL", () => {
    const offenders = sourceFiles()
      .filter((file) => /storage\s*\.\s*from\(|createSignedUrl|getPublicUrl/.test(readFileSync(file, "utf8")))
      .map(relative);
    expect(offenders).toEqual([]);
  });

  it("file uploads are the two CSV importers plus the AI tools' single input", () => {
    const fileInputs = sourceFiles()
      .filter((file) => /type=["']file["']/.test(readFileSync(file, "utf8")))
      .map(relative)
      .sort();
    // An upload only matters to the sharp advisory if its bytes can be handed
    // back out under an image content type, or fed to a decoder. The CSV
    // importers are neither: both are admin-only, decoded as UTF-8 text and
    // parsed as CSV. The AI input is pinned separately in 3b.
    expect(fileInputs).toEqual([
      "app/admin/renewals/legacy/legacy-client.tsx",
      "app/admin/users/import/import-client.tsx",
      "app/ai/ai-file-input.tsx"
    ]);

    const client = readFileSync(join(repoRoot, "app/admin/users/import/import-client.tsx"), "utf8");
    const legacyClient = readFileSync(join(repoRoot, "app/admin/renewals/legacy/legacy-client.tsx"), "utf8");
    expect(client).toContain('accept=".csv,text/csv"');
    expect(legacyClient).toContain('accept=".csv,text/csv"');

    const action = readFileSync(join(repoRoot, "app/admin/users/import/actions.ts"), "utf8");
    const legacyAction = readFileSync(join(repoRoot, "app/admin/renewals/legacy/actions.ts"), "utf8");
    expect(action).toMatch(/await file\.text\(\)/);
    expect(legacyAction).toMatch(/await file\.text\(\)/);
    // No raw-byte handle is ever taken, which is what a decoder would need.
    expect(action).not.toMatch(/arrayBuffer\(\)|\.stream\(\)|Buffer\.from\(/);
    expect(legacyAction).not.toMatch(/arrayBuffer\(\)|\.stream\(\)|Buffer\.from\(/);
  });
});

describe("3b. AI tool uploads never reach an image decoder", () => {
  const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|heic|heif|avif|tiff?|bmp|ico)\b/i;

  it("the accept list and the server allowlist contain no image type", () => {
    expect(AI_UPLOAD_ACCEPT).not.toMatch(/image/i);
    expect(AI_UPLOAD_ACCEPT).not.toMatch(IMAGE_EXTENSIONS);
    expect(AI_UPLOAD_MIME.filter((mime) => mime.startsWith("image/"))).toEqual([]);
    expect(Object.keys(AI_UPLOAD_KINDS).sort()).toEqual(["csv", "docx", "md", "pdf", "txt", "xlsx"]);
  });

  it("the AI file input takes its accept list from that allowlist and nowhere else", () => {
    const input = readFileSync(join(repoRoot, "app/ai/ai-file-input.tsx"), "utf8");
    expect(input).toContain("accept={AI_UPLOAD_ACCEPT}");
    expect(input.match(/accept=/g)).toHaveLength(1);
  });

  it("raw upload bytes are taken in exactly one file", () => {
    const takers = sourceFiles()
      .filter((file) => /arrayBuffer\(\)|\.stream\(\)/.test(readFileSync(file, "utf8")))
      .map(relative);
    expect(takers).toEqual(["lib/ai/uploads.ts"]);
  });

  it("that file checks the bytes before extracting, and hands them only to the text extractor", () => {
    const uploads = readFileSync(join(repoRoot, "lib/ai/uploads.ts"), "utf8");
    const readAt = uploads.indexOf("arrayBuffer()");
    const sniffAt = uploads.indexOf("sniffAiUpload(bytes");
    const extractAt = uploads.indexOf("extractTextFromFile(");
    expect(readAt).toBeGreaterThan(-1);
    expect(sniffAt).toBeGreaterThan(readAt);
    expect(extractAt).toBeGreaterThan(sniffAt);
    // The only copy of the bytes is the one handed straight to the text extractor.
    expect(uploads.match(/Buffer\.from\(/g)).toHaveLength(1);
    expect(uploads).toContain("extractTextFromFile(Buffer.from(bytes)");
    // Nothing that could persist or serve the bytes.
    expect(uploads).not.toMatch(/writeFile|createWriteStream|supabase|storage\s*\.|new Response|NextResponse|sharp/);
  });

  it("only the text extractor imports pdf-parse, and it never renders or pulls images", () => {
    const importers = sourceFiles()
      .filter((file) => /from\s+["']pdf-parse|import\(["']pdf-parse/.test(readFileSync(file, "utf8")))
      .map(relative);
    expect(importers).toEqual(["lib/ai/extract-text.ts"]);

    const extractor = readFileSync(join(repoRoot, "lib/ai/extract-text.ts"), "utf8");
    expect(extractor).toMatch(/\.getText\(/);
    expect(extractor).not.toMatch(/getScreenshot|getImage|CanvasFactory|createCanvas|\.render\(/);
  });

  it("no application source touches @napi-rs/canvas directly", () => {
    const offenders = sourceFiles()
      .filter((file) => /["']@napi-rs\/canvas["']/.test(readFileSync(file, "utf8")))
      .map(relative);
    expect(offenders).toEqual([]);
  });
});

describe("4. sharp is never invoked directly", () => {
  it("no application source imports or requires sharp", () => {
    const offenders = [...sourceFiles(), join(repoRoot, "middleware.ts"), join(repoRoot, "next.config.mjs")]
      .filter((file) => existsSync(file))
      .filter((file) => /require\(["']sharp["']\)|from\s+["']sharp["']/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("sharp is not a declared dependency of this project", () => {
    // It is present only as Next's own optional dependency. Declaring it here
    // would make the vulnerable version a first-party runtime choice.
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    expect(pkg.dependencies?.sharp).toBeUndefined();
    expect(pkg.devDependencies?.sharp).toBeUndefined();
  });
});

describe("5. dependency overrides stay inside every parent's supported range", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

  it("does not override Next's exact postcss pin or its sharp range", () => {
    // Next 15.5.23 declares `postcss: 8.4.31` (exact) and `sharp: ^0.34.3`.
    // Forcing either is an unsupported configuration, not a fix.
    expect(pkg.overrides?.postcss).toBeUndefined();
    expect(pkg.overrides?.sharp).toBeUndefined();
  });

  it("keeps only the overrides that satisfy their parents", () => {
    // nanoid ^3.3.17 -> 3.3.18 satisfies postcss@8.4.31's ^3.3.6 and
    // postcss@8.5.26's ^3.3.17. ws ^8.21.0 -> 8.21.3 satisfies
    // @supabase/realtime-js@2.105.0's ^8.18.2.
    expect(Object.keys(pkg.overrides ?? {}).sort()).toEqual(["nanoid", "ws"]);
  });
});
