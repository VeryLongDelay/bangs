#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DUCKDUCKGO_BANG_URL = "https://duckduckgo.com/bang.js";
const KAGI_BANG_URL = "https://raw.githubusercontent.com/kagisearch/bangs/main/data/bangs.json";

const DATA_DIR = path.join(__dirname, "..", "public");
const OUTPUT_FILE = path.join(DATA_DIR, "bangs.json");
const OUTPUT_MIN_JS_FILE = path.join(DATA_DIR, "bangs.min.js");
const OUTPUT_SHA256_FILE = path.join(DATA_DIR, "bangs.json.sha256");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;

    client
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          return fetchJson(redirectUrl).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

function normalizeUrl(url) {
  if (!url) {
    return "";
  }

  return url
    .replace(/\{\{\{s\}\}\}/g, "%s")
    .replace(/\{searchTerms\}/g, "%s")
    .replace(/\{search_term_string\}/g, "%s")
    .replace(/^http:\/\/(www\.)?(google|youtube|wikipedia|github|reddit|amazon|twitter|duckduckgo)\./i, "https://$1$2.")
    .trim();
}

function normalizeDomain(domain) {
  if (!domain) {
    return "";
  }
  return domain.toLowerCase().replace(/^www\./, "");
}

function extractDomain(url) {
  if (!url) {
    return "";
  }
  try {
    const match = url.match(/^https?:\/\/([^/]+)/i);
    if (match) {
      return normalizeDomain(match[1]);
    }
  } catch (e) {
    console.error(`Failed to extract domain from ${url}: ${e.message}`);
    return "";
  }
  return "";
}

function createBangKey(bang) {
  return normalizeUrl(bang.u)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
}

function normalizeDdgBang(bang) {
  const url = normalizeUrl(bang.u);
  return {
    t: [bang.t],
    s: bang.s || "",
    d: normalizeDomain(bang.d) || extractDomain(url),
    c: bang.c || null,
    sc: bang.sc || null,
    r: bang.r || 0,
    u: url,
    _source: "ddg",
  };
}

function normalizeKagiBang(bang) {
  const triggers = [bang.t];
  if (bang.ts && Array.isArray(bang.ts)) {
    triggers.push(...bang.ts);
  }

  const url = normalizeUrl(bang.u);
  return {
    t: triggers,
    s: bang.s || "",
    d: normalizeDomain(bang.d) || extractDomain(url),
    c: bang.c || null,
    sc: bang.sc || null,
    r: bang.r || 0,
    u: url,
    _source: "kagi",
  };
}

function mergeBangs(existing, newBang) {
  const allTriggers = new Set([...(existing.t || []), ...(newBang.t || [])]);
  const relevance = Math.max(existing.r || 0, newBang.r || 0);
  const service = existing.s || newBang.s;
  const category = existing.c || newBang.c;
  const subcategory = existing.sc || newBang.sc;

  let url = existing.u;
  if (newBang.u.startsWith("https://") && !existing.u.startsWith("https://")) {
    url = newBang.u;
  }

  const sources = new Set();
  if (existing._source) {
    sources.add(existing._source);
  }
  if (newBang._source) {
    sources.add(newBang._source);
  }

  return {
    t: Array.from(allTriggers),
    s: service,
    d: existing.d || newBang.d,
    c: category,
    sc: subcategory,
    r: relevance,
    u: url,
    _source: Array.from(sources).join("+"),
  };
}

function processBangs(ddgBangs, kagiBangs) {
  console.log(`Processing ${ddgBangs.length} DDG bangs and ${kagiBangs.length} Kagi bangs...`);

  const bangMap = new Map();

  for (const raw of ddgBangs) {
    if (!(raw.u && raw.t)) {
      continue;
    }
    const bang = normalizeDdgBang(raw);
    const key = createBangKey(bang);

    if (bangMap.has(key)) {
      bangMap.set(key, mergeBangs(bangMap.get(key), bang));
    } else {
      bangMap.set(key, bang);
    }
  }

  for (const raw of kagiBangs) {
    if (!(raw.u && raw.t)) {
      continue;
    }
    const bang = normalizeKagiBang(raw);
    const key = createBangKey(bang);

    if (bangMap.has(key)) {
      bangMap.set(key, mergeBangs(bangMap.get(key), bang));
    } else {
      bangMap.set(key, bang);
    }
  }

  const bangs = Array.from(bangMap.values()).map((bang) => {
    const sortedTriggers = [...bang.t].sort((a, b) => a.length - b.length);
    const { _source, ...cleanBang } = bang;

    return {
      ...cleanBang,
      t: sortedTriggers.length === 1 ? sortedTriggers[0] : sortedTriggers,
    };
  });

  bangs.sort((a, b) => {
    if (b.r !== a.r) {
      return b.r - a.r;
    }
    const aT = Array.isArray(a.t) ? a.t[0] : a.t;
    const bT = Array.isArray(b.t) ? b.t[0] : b.t;
    return aT.localeCompare(bT);
  });

  return bangs;
}

function cleanBang(bang) {
  const cleaned = {};
  for (const [key, value] of Object.entries(bang)) {
    if (value !== null && value !== undefined && value !== "") {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function toCompactFormat(bangs) {
  const categories = [...new Set(bangs.map((b) => b.c).filter(Boolean))].sort();
  const categoryIndex = new Map(categories.map((c, i) => [c, i]));

  const compactBangs = bangs.map((b) => {
    const catIdx = b.c ? categoryIndex.get(b.c) : -1;
    return [b.t, b.s, catIdx, b.r, b.u];
  });

  return {
    c: categories,
    b: compactBangs,
  };
}

function toMinifiedJs(data) {
  return `globalThis.BANGS_DATA=${JSON.stringify(data)};\n`;
}

function generateStats(bangs) {
  const stats = {
    total: bangs.length,
    withMultipleTriggers: 0,
    totalTriggers: 0,
    categories: new Map(),
    topByRelevance: [],
  };

  for (const bang of bangs) {
    const triggers = Array.isArray(bang.t) ? bang.t : [bang.t];
    stats.totalTriggers += triggers.length;
    if (triggers.length > 1) {
      stats.withMultipleTriggers++;
    }

    if (bang.c) {
      stats.categories.set(bang.c, (stats.categories.get(bang.c) || 0) + 1);
    }
  }

  stats.topByRelevance = bangs.slice(0, 10).map((b) => `!${Array.isArray(b.t) ? b.t[0] : b.t} (${b.s}, r=${b.r})`);

  return stats;
}

async function main() {
  console.log("🔄 Starting bang list update...\n");

  // Fetch from both sources in parallel
  console.log("📥 Fetching from DuckDuckGo and Kagi...");

  let ddgBangs = [];
  let kagiBangs = [];

  try {
    [ddgBangs, kagiBangs] = await Promise.all([
      fetchJson(DUCKDUCKGO_BANG_URL).catch((e) => {
        console.warn(`⚠️  Failed to fetch DDG bangs: ${e.message}`);
        return [];
      }),
      fetchJson(KAGI_BANG_URL).catch((e) => {
        console.warn(`⚠️  Failed to fetch Kagi bangs: ${e.message}`);
        return [];
      }),
    ]);
  } catch (e) {
    console.error("❌ Failed to fetch bang data:", e.message);
    process.exit(1);
  }

  console.log(`   DDG: ${ddgBangs.length} bangs`);
  console.log(`   Kagi: ${kagiBangs.length} bangs\n`);

  if (ddgBangs.length === 0 && kagiBangs.length === 0) {
    console.error("❌ No bangs fetched from any source!");
    process.exit(1);
  }

  // Process and merge
  console.log("🔀 Merging and deduplicating...");
  const bangs = processBangs(ddgBangs, kagiBangs);

  // Clean up null values
  const cleanedBangs = bangs.map(cleanBang);

  // Generate stats
  const stats = generateStats(cleanedBangs);
  console.log("\n📊 Statistics:");
  console.log(`   Total unique bangs: ${stats.total}`);
  console.log(`   Total triggers: ${stats.totalTriggers}`);
  console.log(`   Bangs with multiple triggers: ${stats.withMultipleTriggers}`);
  console.log(`   Triggers saved by merging: ${stats.totalTriggers - stats.total}`);
  console.log("\n   Top categories:");
  const sortedCategories = Array.from(stats.categories.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [cat, count] of sortedCategories) {
    console.log(`     ${cat}: ${count}`);
  }
  console.log("\n   Top by relevance:");
  for (const item of stats.topByRelevance) {
    console.log(`     ${item}`);
  }

  // Write output
  console.log("\n💾 Writing generated files...");

  // Ensure directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Convert to compact format for smaller file size
  const compactData = toCompactFormat(cleanedBangs);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(compactData));
  fs.writeFileSync(OUTPUT_MIN_JS_FILE, toMinifiedJs(compactData));

  const fileSize = fs.statSync(OUTPUT_FILE).size;
  const minJsFileSize = fs.statSync(OUTPUT_MIN_JS_FILE).size;
  const originalSize = JSON.stringify(cleanedBangs).length;
  const savings = ((1 - fileSize / originalSize) * 100).toFixed(0);
  console.log(`   JSON size: ${(fileSize / 1024 / 1024).toFixed(2)} MB (${savings}% smaller than object format)`);
  console.log(`   Min JS size: ${(minJsFileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   JSON output: ${OUTPUT_FILE}`);
  console.log(`   Min JS output: ${OUTPUT_MIN_JS_FILE}`);

  const repoRoot = path.join(__dirname, "..");
  const sha256Rel = path.relative(repoRoot, OUTPUT_FILE).split(path.sep).join("/");
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(OUTPUT_FILE)).digest("hex");
  const sha256Line = `${sha256}  ${sha256Rel}\n`;
  fs.writeFileSync(OUTPUT_SHA256_FILE, sha256Line);
  console.log(`   SHA-256: ${sha256}`);
  console.log(`   Checksum file: ${OUTPUT_SHA256_FILE} (verify from repo root: sha256sum -c public/bangs.json.sha256)`);

  console.log("\n✅ !Bangs list updated successfully!");
}

// Run
main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});
