// ============================================
// VOYAGE v3 — BUNDLED (IIFE)
// Совместимость: file://, http://, CSP-safe
// Все модули объединены для работы без сервера
// ============================================

(function() {
'use strict';

// ============================================
// VOYAGE UTILS v3.2 — Объединённый аудит
// Исправления от: Kimi Code + Master Architect
// ============================================

function debounce(fn, ms) {
  if (typeof fn !== 'function') throw new TypeError('debounce: fn must be a function');
  ms = Math.max(0, Number(ms) || 0);
  let t;
  const d = function(...a) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

function escapeHtml(s) {
  if (s == null) return '';
  if (typeof s !== 'string' && typeof s !== 'number') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#x60;');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

function isValidBaseUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const p = new URL(url, window.location.href);
    if (p.protocol === 'file:' && window.location.protocol !== 'file:') return false;
    const forbidden = ['javascript:', 'data:', 'vbscript:', 'about:', 'blob:'];
    if (forbidden.some(x => p.protocol === x)) return false;
    return ['http:', 'https:', 'file:'].includes(p.protocol);
  } catch { return false; }
}

function validateImportedState(obj, maxDepth = 20) {
  if (!obj || typeof obj !== 'object') return false;
  if (Object.prototype.toString.call(obj) !== '[object Object]') return false;

  const bad = ['__proto__', 'constructor', 'prototype'];
  const seen = new WeakSet();

  function hasBad(o, depth) {
    if (depth > maxDepth) return true;
    if (!o || typeof o !== 'object') return false;
    if (seen.has(o)) return false;
    seen.add(o);

    for (const key of Object.keys(o)) {
      if (bad.includes(key)) return true;
      const val = o[key];
      if (val && typeof val === 'object') {
        if (Object.prototype.toString.call(val) !== '[object Object]' && !Array.isArray(val)) {
          return true;
        }
        if (hasBad(val, depth + 1)) return true;
      }
    }
    return false;
  }

  if (hasBad(obj, 0)) return false;

  if (obj.baseUrl !== undefined && typeof obj.baseUrl !== 'string') return false;
  if (obj.task !== undefined && typeof obj.task !== 'string') return false;
  if (obj.masterResponse !== undefined && typeof obj.masterResponse !== 'string') return false;
  if (obj.feedbacks !== undefined && (typeof obj.feedbacks !== 'object' || Array.isArray(obj.feedbacks) || obj.feedbacks === null)) return false;
  return true;
}

function domCreate(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  const dangerousUrlAttrs = ['href', 'src', 'action', 'formaction'];
  const dangerousProto = /^\s*(javascript|data:text\/html|vbscript):/i;

  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') {
      el.textContent = v;
    } else if (k === 'className') {
      el.setAttribute('class', v);
    } else if (k === 'htmlFor') {
      el.setAttribute('for', v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      const eventName = k.slice(2).toLowerCase();
      el.addEventListener(eventName, v);
    } else if (k.startsWith('on') && typeof v === 'string') {
      continue;
    } else if (dangerousUrlAttrs.includes(k) && typeof v === 'string' && dangerousProto.test(v)) {
      continue;
    } else if (k.startsWith('data-') || k.startsWith('aria-')) {
      el.setAttribute(k, v);
    } else {
      el.setAttribute(k, v);
    }
  }

  children.forEach(c => {
    if (c == null) return;
    el.appendChild(
      typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean'
        ? document.createTextNode(String(c))
        : c
    );
  });
  return el;
}

function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    const str = String(text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(resolve).catch(reject);
      return;
    }
    if (!document.body) {
      reject(new Error('document.body is not available'));
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
    ta.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ta);
    ta.select();
    try {
      const ok = document.execCommand('copy');
      ok ? resolve() : reject(new Error('execCommand copy failed'));
    } catch (e) {
      reject(e);
    } finally {
      if (ta.parentNode) document.body.removeChild(ta);
    }
  });
}

function generateId(prefix = 'voyage') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}


// ===== STATE v3.2 =====
// Immutable store with localStorage backup, selective subscriptions, memory safety
// ============================================

const STORAGE_KEY = 'voyage_state';
const STORAGE_MAX = 4 * 1024 * 1024; // 4 MB localStorage limit

const store = (() => {
  const DEFAULT_STATE = {
    baseUrl: './prompts/',
    task: '',
    masterResponse: '',
    plan: null,
    roles: {},
    feedbacks: {},
    projectFiles: [],
    dependencyGraph: null,
    activeScreen: 'screen-settings',
    lastAction: ''
  };

  let state = loadFromStorage() || { ...DEFAULT_STATE };
  const listeners = new Map();
  let batchTimer = null;
  let pending = {};
  let listenerId = 0;

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return validateImportedState(parsed) ? parsed : null;
    } catch { return null; }
  }

  function saveToStorage() {
    try {
      const json = JSON.stringify(state);
      if (json.length > STORAGE_MAX) {
        console.warn('State too large for localStorage:', json.length, 'bytes');
        return false;
      }
      localStorage.setItem(STORAGE_KEY, json);
      return true;
    } catch (e) {
      console.warn('localStorage save failed:', e.message);
      return false;
    }
  }

  function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  function notify(changedKeys) {
    listeners.forEach(({ fn, selector }) => {
      try {
        const selected = selector ? selector(state) : state;
        fn(selected, changedKeys);
      } catch (e) { console.error('State listener error:', e); }
    });
  }

  return {
    getState: () => state,

    setState: (patch) => {
      pending = deepMerge(pending, patch);
      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => {
        const changedKeys = Object.keys(pending);
        state = deepMerge(state, pending);
        pending = {};
        saveToStorage();
        notify(changedKeys);
      }, 50);
    },

    subscribe: (fn, selector) => {
      const id = ++listenerId;
      listeners.set(id, { fn, selector });
      return () => { listeners.delete(id); };
    },

    exportState: () => {
      const json = JSON.stringify(state);
      if (json.length > STORAGE_MAX) {
        console.warn('Export too large:', json.length);
      }
      return json;
    },

    importState: (json) => {
      try {
        const parsed = JSON.parse(json);
        if (!validateImportedState(parsed)) return false;
        state = deepMerge(DEFAULT_STATE, parsed);
        saveToStorage();
        notify(Object.keys(parsed));
        return true;
      } catch (e) {
        console.error('Import failed:', e);
        return false;
      }
    },

    reset: () => {
      state = { ...DEFAULT_STATE };
      localStorage.removeItem(STORAGE_KEY);
      notify(Object.keys(state));
    }
  };
})();


// ===== ZIP LOADER =====
// ============================================
// VOYAGE ZIP LOADER — Native browser ZIP parsing
// Uses DecompressionStream('deflate-raw') + manual ZIP format parsing
// No external libraries. Works in all modern browsers (2023+)
// ============================================

// --- ZIP format constants ---
const COMP_NONE = 0;
const COMP_DEFLATE = 8;
const FH_SIG = 0x04034b50;
const CDFH_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const FH_OFFS = {
  SIG: 0, COMP_METHOD: 8, COMP_SIZE: 18, UNCOMP_SIZE: 22,
  NAME_LEN: 26, EXTRA_LEN: 28, FIXED: 30
};
const CDFH_OFFS = {
  SIG: 0, COMP_METHOD: 10, COMP_SIZE: 20, UNCOMP_SIZE: 24,
  NAME_LEN: 28, EXTRA_LEN: 30, COMMENT_LEN: 32, FH_OFFSET: 42, FIXED: 46
};
const EOCD_OFFS = {
  SIG: 0, DISK_NUM: 4, CD_DISK: 6, CD_RECORDS: 8, TOTAL_RECORDS: 10,
  CD_SIZE: 12, CD_OFFSET: 16, COMMENT_LEN: 20, FIXED: 22
};

function getData(buffer, offset, size) {
  return buffer.slice(offset, offset + size);
}

function readString(buffer, offset, len) {
  return new TextDecoder('utf-8').decode(getData(buffer, offset, len));
}

async function decompressDeflateRaw(data) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Response(stream).arrayBuffer();
}

function findEOCD(buffer) {
  // Search backwards from end for EOCD signature
  const view = new DataView(buffer);
  const maxComment = 65535;
  const start = Math.max(0, buffer.byteLength - EOCD_OFFS.FIXED - maxComment);
  for (let i = buffer.byteLength - EOCD_OFFS.FIXED; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      const commentLen = view.getUint16(i + EOCD_OFFS.COMMENT_LEN, true);
      if (i + EOCD_OFFS.FIXED + commentLen === buffer.byteLength) {
        return {
          cdRecords: view.getUint16(i + EOCD_OFFS.CD_RECORDS, true),
          cdOffset: view.getUint32(i + EOCD_OFFS.CD_OFFSET, true),
          cdSize: view.getUint32(i + EOCD_OFFS.CD_SIZE, true)
        };
      }
    }
  }
  throw new Error('ZIP: End of Central Directory not found');
}

function readCentralDirectory(buffer, eocd) {
  const files = [];
  const view = new DataView(buffer);
  let offset = eocd.cdOffset;
  for (let i = 0; i < eocd.cdRecords; i++) {
    if (view.getUint32(offset, true) !== CDFH_SIG) {
      throw new Error('ZIP: Invalid Central Directory File Header at offset ' + offset);
    }
    const nameLen = view.getUint16(offset + CDFH_OFFS.NAME_LEN, true);
    const extraLen = view.getUint16(offset + CDFH_OFFS.EXTRA_LEN, true);
    const commentLen = view.getUint16(offset + CDFH_OFFS.COMMENT_LEN, true);
    const name = readString(buffer, offset + CDFH_OFFS.FIXED, nameLen);
    const compMethod = view.getUint16(offset + CDFH_OFFS.COMP_METHOD, true);
    const compSize = view.getUint32(offset + CDFH_OFFS.COMP_SIZE, true);
    const uncompSize = view.getUint32(offset + CDFH_OFFS.UNCOMP_SIZE, true);
    const fhOffset = view.getUint32(offset + CDFH_OFFS.FH_OFFSET, true);
    files.push({ name, compMethod, compSize, uncompSize, fhOffset });
    offset += CDFH_OFFS.FIXED + nameLen + extraLen + commentLen;
  }
  return files;
}

async function extractFile(buffer, fileInfo) {
  const view = new DataView(buffer);
  const fhOffset = fileInfo.fhOffset;
  if (view.getUint32(fhOffset, true) !== FH_SIG) {
    throw new Error('ZIP: Invalid File Header for ' + fileInfo.name);
  }
  const nameLen = view.getUint16(fhOffset + FH_OFFS.NAME_LEN, true);
  const extraLen = view.getUint16(fhOffset + FH_OFFS.EXTRA_LEN, true);
  const dataOffset = fhOffset + FH_OFFS.FIXED + nameLen + extraLen;
  const compData = getData(buffer, dataOffset, fileInfo.compSize);

  if (fileInfo.compMethod === COMP_NONE) {
    return compData;
  } else if (fileInfo.compMethod === COMP_DEFLATE) {
    return await decompressDeflateRaw(compData);
  } else {
    throw new Error('ZIP: Unsupported compression method ' + fileInfo.compMethod + ' for ' + fileInfo.name);
  }
}

/**
 * Parse a ZIP file and return array of { name, content, language }
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array<{name:string, content:string, language:string}>>}
 */
async function parseZip(buffer) {
  const eocd = findEOCD(buffer);
  const files = readCentralDirectory(buffer, eocd);
  const result = [];
  for (const info of files) {
    // Skip directories and hidden files
    if (info.name.endsWith('/')) continue;
    if (info.name.startsWith('__MACOSX/')) continue;
    if (info.name.startsWith('.')) continue;
    try {
      const raw = await extractFile(buffer, info);
      const content = new TextDecoder('utf-8').decode(raw);
      const language = detectLanguage(info.name, content);
      result.push({ name: info.name, content, language });
    } catch (e) {
      console.warn('Failed to extract', info.name, e.message);
    }
  }
  return result;
}

function detectLanguage(filename, content) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    py: 'python', java: 'java', go: 'go', rs: 'rust', cpp: 'cpp', c: 'c',
    h: 'c', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift',
    kt: 'kotlin', scala: 'scala', r: 'r', m: 'objectivec', mm: 'objectivec',
    html: 'html', htm: 'html', css: 'css', scss: 'css', sass: 'css', less: 'css',
    json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml', md: 'markdown',
    dockerfile: 'dockerfile', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
    sql: 'sql', graphql: 'graphql', vue: 'vue', svelte: 'svelte',
    toml: 'toml', ini: 'ini', conf: 'ini', env: 'dotenv', gitignore: 'gitignore'
  };
  if (map[ext]) return map[ext];
  // Heuristics
  if (content.includes('import ') && content.includes('from ')) return 'javascript';
  if (content.includes('def ') && content.includes(':')) return 'python';
  if (content.includes('package main')) return 'go';
  if (content.includes('<?php')) return 'php';
  return 'text';
}


// ===== DEPENDENCY ANALYZER =====
// ============================================
// VOYAGE DEPENDENCY ANALYZER — Multi-language
// Parses imports/includes across JS/TS, Python, Go, Java, HTML, CSS, Docker, YAML
// Full cycle detection, impact analysis, dead code detection
// ============================================

const LANGUAGE_PATTERNS = {
  javascript: {
    imports: [
      /import\s+(?:[\w\s{},*]+)\s+from\s+['"]([^'"]+)['"]/g,
      /import\s*\(['"]([^'"]+)['"]\)/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /export\s+(?:[\w\s{},*]+)\s+from\s+['"]([^'"]+)['"]/g
    ],
    functions: /function\s+(\w+)\s*\(/g,
    classes: /class\s+(\w+)\s*(?:extends|implements|{)/g,
    exports: /(?:export\s+(?:default\s+)?(?:function|class|const|let|var)\s+|module\.exports\s*=\s*|exports\.(\w+)\s*=)/g
  },
  typescript: {
    imports: [
      /import\s+(?:type\s+)?(?:[\w\s{},*]+)\s+from\s+['"]([^'"]+)['"]/g,
      /import\s*\(['"]([^'"]+)['"]\)/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    ],
    functions: /function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g,
    classes: /class\s+(\w+)\s*(?:extends|implements|<|{)/g,
    exports: /(?:export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface)\s+|export\s+interface\s+(\w+))/g
  },
  python: {
    imports: [
      /(?:from\s+(\S+)\s+import|import\s+(\S+))/g
    ],
    functions: /def\s+(\w+)\s*\(/g,
    classes: /class\s+(\w+)\s*(?:\(|:)/g,
    exports: null // Python doesn't have explicit exports
  },
  go: {
    imports: [
      /import\s+\(\s*([^)]+)\)/gs,
      /import\s+['"]([^'"]+)['"]/g
    ],
    functions: /func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/g,
    classes: null, // Go uses structs
    exports: /func\s+(\w+)[^(]*\(/g // exported if capitalized
  },
  java: {
    imports: [
      /import\s+(?:static\s+)?([\w.]+);/g
    ],
    functions: /(?:public|private|protected|static|final|abstract)\s+(?:[\w<>\[\]]+\s+)?(\w+)\s*\(/g,
    classes: /(?:public\s+)?(?:class|interface|enum|record)\s+(\w+)/g,
    exports: null
  },
  html: {
    imports: [
      /<script\s+[^>]*src=['"]([^'"]+)['"]/gi,
      /<link\s+[^>]*href=['"]([^'"]+)['"]/gi,
      /\burl\s*\(\s*['"]([^'"]+)['"]\s*\)/gi,
      /\b(?:src|href)\s*=\s*['"]([^'"]+\.(?:js|css|png|jpg|svg|woff|woff2))['"]/gi
    ],
    functions: /<script[^>]*>([\s\S]*?)<\/script>/gi, // extract inline scripts
    classes: null,
    exports: null
  },
  css: {
    imports: [
      /@import\s+(?:url\s*\()?['"]([^'"]+)['"]\)?/gi
    ],
    functions: null,
    classes: null,
    exports: null
  },
  dockerfile: {
    imports: [
      /FROM\s+(\S+)/gi,
      /COPY\s+\S+\s+(\S+)/gi,
      /ADD\s+\S+\s+(\S+)/gi
    ],
    functions: null,
    classes: null,
    exports: null
  },
  yaml: {
    imports: [
      /(?:depends_on|include|extends|import|require):\s*\n((?:\s+-\s+\S+\s*\n)+)/gi,
      /(?:depends_on|include|extends|import|require):\s*\[([^\]]+)\]/gi
    ],
    functions: null,
    classes: null,
    exports: null
  },
  json: {
    imports: null,
    functions: null,
    classes: null,
    exports: null
  }
};

function cleanPath(path, currentFile) {
  if (!path) return null;
  // Remove query params and hash
  path = path.split('?')[0].split('#')[0];
  // Skip URLs
  if (/^https?:\/\//.test(path)) return null;
  // Clean relative paths
  path = path.replace(/^\.\//, '').replace(/^\//, '');
  // Remove extensions for module resolution
  const ext = path.split('.').pop();
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'java'].includes(ext)) {
    return path.replace(/\.[^.]+$/, '');
  }
  return path;
}

function extractImports(content, patterns) {
  if (!patterns || !patterns.imports) return [];
  const deps = new Set();
  for (const regex of patterns.imports) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const dep = match[1] || match[2];
      if (dep) {
        // For Go multi-line imports
        if (dep.includes('\n')) {
          dep.split('\n').forEach(line => {
            const m = line.match(/['"]([^'"]+)['"]/);
            if (m) deps.add(cleanPath(m[1]));
          });
        } else {
          deps.add(cleanPath(dep));
        }
      }
    }
  }
  return Array.from(deps).filter(Boolean);
}

function extractSymbols(content, patterns) {
  const symbols = { functions: [], classes: [], exports: [] };
  if (!patterns) return symbols;

  if (patterns.functions) {
    patterns.functions.lastIndex = 0;
    let m;
    while ((m = patterns.functions.exec(content)) !== null) {
      symbols.functions.push(m[1] || m[2]);
    }
  }
  if (patterns.classes) {
    patterns.classes.lastIndex = 0;
    let m;
    while ((m = patterns.classes.exec(content)) !== null) {
      symbols.classes.push(m[1]);
    }
  }
  if (patterns.exports) {
    patterns.exports.lastIndex = 0;
    let m;
    while ((m = patterns.exports.exec(content)) !== null) {
      symbols.exports.push(m[1] || 'default');
    }
  }
  return symbols;
}

/**
 * Build dependency graph from project files
 * @param {Array<{name:string, content:string, language:string}>} files
 * @returns {Object} Full analysis result
 */
function analyzeProject(files) {
  const graph = {};
  const symbols = {};
  const fileMap = new Map();

  // Index all files
  files.forEach(f => {
    const cleanName = f.name.replace(/\.[^.]+$/, '');
    fileMap.set(cleanName, f);
    fileMap.set(f.name, f);
    const patterns = LANGUAGE_PATTERNS[f.language] || LANGUAGE_PATTERNS.javascript;
    symbols[f.name] = extractSymbols(f.content, patterns);
    graph[f.name] = {
      dependencies: [],
      dependents: [],
      language: f.language,
      symbols: symbols[f.name],
      size: f.content.length
    };
  });

  // Build forward dependencies
  files.forEach(f => {
    const patterns = LANGUAGE_PATTERNS[f.language] || LANGUAGE_PATTERNS.javascript;
    const imports = extractImports(f.content, patterns);
    graph[f.name].dependencies = imports.map(dep => {
      // Try to resolve dependency to actual file
      const resolved = resolveDependency(dep, f.name, fileMap);
      return { raw: dep, resolved };
    });
  });

  // Build reverse dependencies (dependents)
  Object.entries(graph).forEach(([fileName, info]) => {
    info.dependencies.forEach(dep => {
      if (dep.resolved && graph[dep.resolved]) {
        graph[dep.resolved].dependents.push(fileName);
      }
    });
  });

  return {
    graph,
    cycles: findCycles(graph),
    impact: buildImpactMap(graph),
    deadCode: findDeadCode(graph, symbols),
    orphans: findOrphans(graph),
    stats: computeStats(graph, files)
  };
}

function resolveDependency(dep, currentFile, fileMap) {
  // Direct match
  if (fileMap.has(dep)) return fileMap.get(dep).name;
  // With extension guessing
  for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java']) {
    if (fileMap.has(dep + ext)) return fileMap.get(dep + ext).name;
  }
  // Relative path resolution
  const currentDir = currentFile.split('/').slice(0, -1).join('/');
  const relativePath = currentDir ? currentDir + '/' + dep : dep;
  if (fileMap.has(relativePath)) return fileMap.get(relativePath).name;
  for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java']) {
    if (fileMap.has(relativePath + ext)) return fileMap.get(relativePath + ext).name;
  }
  // Index file resolution (folder/index.js)
  for (const ext of ['.js', '.ts', '.jsx', '.tsx']) {
    if (fileMap.has(dep + '/index' + ext)) return fileMap.get(dep + '/index' + ext).name;
  }
  return null;
}

/**
 * Find all cycles using DFS (supports cycles of any length)
 */
function findCycles(graph) {
  const cycles = [];
  const visited = new Set();
  const recStack = new Set();
  const path = [];

  function dfs(node) {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const deps = (graph[node]?.dependencies || [])
      .map(d => d.resolved)
      .filter(Boolean);

    for (const dep of deps) {
      if (!visited.has(dep)) {
        dfs(dep);
      } else if (recStack.has(dep)) {
        // Found cycle
        const cycleStart = path.indexOf(dep);
        const cycle = path.slice(cycleStart).concat([dep]);
        // Normalize: start from smallest element to deduplicate
        const normalized = normalizeCycle(cycle);
        if (!cycles.some(c => cyclesEqual(c, normalized))) {
          cycles.push(normalized);
        }
      }
    }

    path.pop();
    recStack.delete(node);
  }

  Object.keys(graph).forEach(node => {
    if (!visited.has(node)) dfs(node);
  });

  return cycles;
}

function normalizeCycle(cycle) {
  // Rotate to start from lexicographically smallest
  let minIdx = 0;
  for (let i = 1; i < cycle.length - 1; i++) {
    if (cycle[i] < cycle[minIdx]) minIdx = i;
  }
  return cycle.slice(minIdx, -1).concat(cycle.slice(0, minIdx)).concat([cycle[minIdx]]);
}

function cyclesEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Build impact map: if file X changes, what breaks?
 */
function buildImpactMap(graph) {
  const impact = {};
  Object.keys(graph).forEach(file => {
    impact[file] = getAllDependents(file, graph);
  });
  return impact;
}

function getAllDependents(file, graph, visited = new Set()) {
  if (visited.has(file)) return [];
  visited.add(file);
  const direct = graph[file]?.dependents || [];
  const indirect = [];
  direct.forEach(dep => {
    indirect.push(...getAllDependents(dep, graph, visited));
  });
  return [...new Set([...direct, ...indirect])];
}

/**
 * Find dead code: exported symbols that are never imported
 */
function findDeadCode(graph, symbols) {
  const dead = {};
  Object.entries(graph).forEach(([file, info]) => {
    if (!info.symbols || !info.symbols.exports.length) return;
    const used = new Set();
    Object.entries(graph).forEach(([otherFile, otherInfo]) => {
      if (otherFile === file) return;
      // Check if any dependency points to this file
      const deps = otherInfo.dependencies || [];
      if (deps.some(d => d.resolved === file)) {
        // Rough check: see if imported names match exports
        const otherContent = (deps.find(d => d.resolved === file)?.raw) || '';
        info.symbols.exports.forEach(exp => {
          if (otherContent.includes(exp) || otherFile.includes(exp)) {
            used.add(exp);
          }
        });
      }
    });
    const deadExports = info.symbols.exports.filter(e => !used.has(e) && e !== 'default');
    if (deadExports.length) dead[file] = deadExports;
  });
  return dead;
}

function findOrphans(graph) {
  return Object.entries(graph)
    .filter(([_, info]) => info.dependencies.length === 0 && info.dependents.length === 0)
    .map(([name]) => name);
}

function computeStats(graph, files) {
  const langs = {};
  files.forEach(f => {
    langs[f.language] = (langs[f.language] || 0) + 1;
  });
  const totalDeps = Object.values(graph).reduce((sum, i) => sum + i.dependencies.length, 0);
  const unresolved = Object.values(graph).reduce(
    (sum, i) => sum + i.dependencies.filter(d => !d.resolved).length, 0
  );
  return {
    totalFiles: files.length,
    totalDependencies: totalDeps,
    unresolvedDependencies: unresolved,
    languages: langs,
    avgFileSize: Math.round(files.reduce((s, f) => s + f.content.length, 0) / files.length)
  };
}

/**
 * Format analysis as markdown report
 */
function formatReport(analysis) {
  const { graph, cycles, impact, deadCode, orphans, stats } = analysis;
  let report = '# 📊 Dependency Analysis Report\n\n';

  // Stats
  report += '## 📈 Statistics\n\n';
  report += `- **Total files:** ${stats.totalFiles}\n`;
  report += `- **Total dependencies:** ${stats.totalDependencies}\n`;
  report += `- **Unresolved:** ${stats.unresolvedDependencies}\n`;
  report += `- **Languages:** ${Object.entries(stats.languages).map(([k,v]) => `${k}(${v})`).join(', ')}\n`;
  report += `- **Avg file size:** ${stats.avgFileSize} chars\n\n`;

  // Cycles
  report += '## 🔄 Cycles\n\n';
  if (cycles.length) {
    cycles.forEach(c => {
      report += `- 🔴 **${c.join(' → ')}**\n`;
    });
  } else {
    report += '- ✅ No cycles detected\n';
  }
  report += '\n';

  // Impact Analysis
  report += '## 💥 Impact Analysis\n\n';
  report += '> "If you change X, these files may break:"\n\n';
  Object.entries(impact).forEach(([file, deps]) => {
    if (deps.length) {
      report += `- **${file}** → ${deps.slice(0, 10).join(', ')}${deps.length > 10 ? ` (+${deps.length - 10} more)` : ''}\n`;
    }
  });
  report += '\n';

  // Dead Code
  report += '## 💀 Dead Code\n\n';
  if (Object.keys(deadCode).length) {
    Object.entries(deadCode).forEach(([file, exports]) => {
      report += `- **${file}**: ${exports.join(', ')}\n`;
    });
  } else {
    report += '- ✅ No dead exports detected\n';
  }
  report += '\n';

  // Orphans
  if (orphans.length) {
    report += '## 🏝️ Orphaned Files\n\n';
    orphans.forEach(f => report += `- ${f}\n`);
    report += '\n';
  }

  // Full Graph
  report += '## 🕸️ Full Dependency Graph\n\n';
  report += '```\n';
  Object.entries(graph).forEach(([file, info]) => {
    const deps = info.dependencies.map(d => d.resolved || `${d.raw} (unresolved)`).join(', ');
    report += `${file} → [${deps || 'none'}]\n`;
  });
  report += '```\n';

  return report;
}


// ===== IMPORTER =====
// ============================================
// VOYAGE IMPORTER — Role loading (fetch + File API fallback)
// Handles CORS, file:// protocol, manual file selection
// ============================================

const TOAST_TYPES = { ERROR: 'error', SUCCESS: 'success', WARN: 'warn', INFO: 'info' };

let _rolesAbortController = null;
// ===== IMPORTER v3.2 =====
// Role loading with concurrency limit, abort control, memory safety
// ============================================

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const CONCURRENCY_LIMIT = 5;

let _rolesLoading = false;
let _rolesAbortController = null;

function normalizeBaseUrl(url) {
  if (typeof url !== 'string') return './prompts/';
  return url.replace(/\/+$/, '') + '/';
}

async function fetchRoleFile(url, signal) {
  const to = setTimeout(() => signal.abort(), 10000);
  try {
    const res = await fetch(url, { signal });
    clearTimeout(to);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(to);
    throw e;
  }
}

async function loadRoles(baseUrl = store.getState().baseUrl) {
  if (_rolesLoading) {
    showToast('Загрузка уже идёт...', 'warning');
    return;
  }
  _rolesLoading = true;
  if (_rolesAbortController) _rolesAbortController.abort();
  _rolesAbortController = new AbortController();

  const normalized = normalizeBaseUrl(baseUrl);
  store.setState({ baseUrl: normalized, lastAction: 'loadRoles' });

  try {
    const manifestUrl = normalized + 'roles.json';
    const manifestRes = await fetchRoleFile(manifestUrl, _rolesAbortController.signal);
    const manifest = JSON.parse(manifestRes);
    const files = manifest.files || manifest;
    await loadRoleFiles(files, normalized);
  } catch (e) {
    console.warn('Manifest failed, using fallback:', e.message);
    const fallback = ['security.md', 'frontend.md', 'backend.md', 'devops.md'];
    await loadRoleFiles(fallback, normalized);
  } finally {
    _rolesLoading = false;
    _rolesAbortController = null;
  }
}

async function loadRoleFiles(files, baseUrl) {
  const seen = new Set();
  const chunks = [];
  for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
    chunks.push(files.slice(i, i + CONCURRENCY_LIMIT));
  }

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (file) => {
        const roleName = file.replace(/\.md$/i, '').replace(/^ROLE-\d+-/i, '');
        if (seen.has(roleName)) {
          console.warn(`Duplicate role skipped: ${roleName}`);
          return null;
        }
        seen.add(roleName);

        try {
          const text = await fetchRoleFile(baseUrl + file, _rolesAbortController.signal);
          return { roleName, text };
        } catch (e) {
          console.warn(`Failed to load ${file}:`, e.message);
          return null;
        }
      })
    );

    const valid = results.filter(Boolean);
    if (valid.length) {
      const patch = {};
      valid.forEach(({ roleName, text }) => {
        patch[roleName] = text;
      });
      store.setState({ roles: patch });
    }
  }

  requestAnimationFrame(() => {
    renderScreen('screen-routing');
  });
}

function promptForMdFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md';
  input.multiple = true;
  input.onchange = async (e) => {
    input.remove();
    const files = Array.from(e.target.files).filter(f => {
      if (f.size > MAX_FILE_SIZE) {
        console.warn(`File too large: ${f.name} (${f.size} bytes)`);
        return false;
      }
      return true;
    });
    await loadMdFiles(files);
  };
  input.click();
}

async function loadMdFiles(files) {
  const seen = new Set();
  const texts = await Promise.all(
    files.map(async (file) => {
      const roleName = file.name.replace(/\.md$/i, '');
      if (seen.has(roleName)) {
        console.warn(`Duplicate role skipped: ${roleName}`);
        return null;
      }
      seen.add(roleName);
      try {
        const text = await file.text();
        return { roleName, text };
      } catch (e) {
        console.warn(`Failed to read ${file.name}:`, e.message);
        return null;
      }
    })
  );

  const valid = texts.filter(Boolean);
  if (valid.length) {
    const patch = {};
    valid.forEach(({ roleName, text }) => {
      patch[roleName] = text;
    });
    store.setState({ roles: patch });
  }

  requestAnimationFrame(() => {
    renderScreen('screen-routing');
  });
}

function exportSession() {
  const blob = new Blob([store.exportState()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `voyage-session-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();

  requestAnimationFrame(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

async function importSession(file) {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = (e) => {
      try {
        const json = e.target.result;
        const ok = store.importState(json);
        if (ok) {
          renderScreen(store.getState().activeScreen);
          showToast('Сессия загружена', 'success');
          resolve(true);
        } else {
          showToast('Невалидный файл сессии', 'error');
          resolve(false);
        }
      } catch (err) {
        showToast('Ошибка импорта: ' + err.message, 'error');
        reject(err);
      }
    };
    reader.onerror = () => {
      showToast('Ошибка чтения файла', 'error');
      reject(new Error('File read error'));
    };
    reader.readAsText(file);
  });
}

function exportSession() {
  const payload = store.exportState();
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `voyage_session_${new Date().toISOString().slice(0, 10)}.json`;
  a.style.display = 'none';

  const cleanup = () => {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  };

  document.body.appendChild(a);
  a.click();
  requestAnimationFrame(cleanup);
  showToast('Сессия экспортирована', TOAST_TYPES.SUCCESS);
}

function importSession(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('Файл > 5 МБ', TOAST_TYPES.ERROR);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const ok = store.importState(e.target.result);
    if (ok) {
      showToast('Сессия импортирована!', TOAST_TYPES.SUCCESS);
      const state = store.getState();
      renderScreen(state.activeScreen);
    } else {
      showToast('Некорректный файл', TOAST_TYPES.ERROR);
    }
  };
  reader.onerror = () => showToast('Ошибка чтения файла', TOAST_TYPES.ERROR);
  reader.readAsText(file);
  input.value = '';
}
}

function resetSession() {
  if (!document.hasFocus()) return;
  if (confirm('Очистить ВСЕ данные? Это необратимо.')) {
    store.reset();
    location.reload();
  }
}


// ===== UI =====
// ============================================
// VOYAGE UI — XSS-safe DOM rendering, no innerHTML for user data
// Selective re-rendering based on state slices
// ============================================


const SCREENS = {
  SETTINGS: 'screen-settings',
  PROJECT: 'screen-project',
  INPUT: 'screen-input',
  ROUTING: 'screen-routing',
  COLLECTOR: 'screen-collector',
  FINAL: 'screen-final'
};
const STEPS = ['settings', 'project', 'input', 'routing', 'collector', 'final'];
const TOAST_TYPES = { ERROR: 'error', SUCCESS: 'success', WARN: 'warn', INFO: 'info' };

let _ui = {};
let _debouncers = {};

function initUI() {
  _ui.bottomBar = document.getElementById('bottom-action-bar');
  _ui.bottomBtn = document.getElementById('bottom-action-btn');
  _ui.bottomStatus = document.getElementById('bottom-status');
  _ui.bottomHint = document.getElementById('bottom-hint');
  _ui.toast = document.getElementById('toast');

  // Subscribe to state changes with selectors
  store.subscribe(renderScreen, s => s.activeScreen);
  store.subscribe(renderBottomBar, s => ({ plan: s.plan, feedbacks: s.feedbacks, activeScreen: s.activeScreen }));
  store.subscribe(renderProgress, s => s.activeScreen);
  store.subscribe(updateStatus, s => s.lastAction);

  // Initial render
  renderScreen(store.getState().activeScreen);
  renderProgress(store.getState().activeScreen);

  // Bind persistent events
  bindGlobalEvents();
}

function renderScreen(screenId) {
  if (!screenId) screenId = store.getState().activeScreen;
  document.querySelectorAll('.v-section').forEach(s => s.classList.remove('v-section--active'));
  const el = document.getElementById(screenId);
  if (el) el.classList.add('v-section--active');
  window.scrollTo(0, 0);

  // Render screen-specific content
  switch (screenId) {
    case SCREENS.SETTINGS: renderSettings(); break;
    case SCREENS.PROJECT: renderProject(); break;
    case SCREENS.INPUT: renderInput(); break;
    case SCREENS.ROUTING: renderRouting(); break;
    case SCREENS.COLLECTOR: renderCollector(); break;
    case SCREENS.FINAL: renderFinal(); break;
  }
}

function renderSettings() {
  const state = store.getState();
  const baseUrlInput = document.getElementById('baseUrl');
  if (baseUrlInput) baseUrlInput.value = state.baseUrl;

  const statusEl = document.getElementById('roles-status');
  if (!statusEl) return;

  const roleCount = Object.keys(state.roles).length;
  if (roleCount > 0) {
    statusEl.className = 'v-alert v-alert--success v-mt-md';
    statusEl.innerHTML = `<span class="v-alert__icon">✅</span><div class="v-alert__content"><strong>${roleCount} ролей загружено</strong></div>`;
  } else {
    statusEl.className = 'v-alert v-alert--info v-mt-md';
    statusEl.innerHTML = '<span class="v-alert__icon">ℹ️</span><div class="v-alert__content">Роли не загружены. Нажми «Загрузить роли» или выбери файл.</div>';
  }
}

function renderProject() {
  const state = store.getState();
  const container = document.getElementById('project-content');
  if (!container) return;

  container.innerHTML = '';

  // ZIP Drop Zone
  const dropZone = domCreate('div', {
    className: 'v-zip-drop',
    id: 'zip-drop-zone'
  }, [
    domCreate('div', { className: 'v-zip-drop__icon', text: '📦' }),
    domCreate('div', { className: 'v-zip-drop__text', text: 'Перетащите ZIP-архив проекта сюда' }),
    domCreate('div', { className: 'v-zip-drop__hint', text: 'Или нажмите для выбора файла' }),
    domCreate('input', {
      type: 'file',
      accept: '.zip',
      id: 'zip-file-input',
      className: 'v-file-input',
      change: handleZipSelect
    })
  ]);

  // Make drop zone clickable
  dropZone.addEventListener('click', () => document.getElementById('zip-file-input').click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('v-zip-drop--drag'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('v-zip-drop--drag'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('v-zip-drop--drag');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.zip')) processZipFile(file);
  });

  container.appendChild(dropZone);

  // File tree if loaded
  if (state.projectFiles.length > 0) {
    const treeCard = domCreate('div', { className: 'v-card' });
    const header = domCreate('div', { className: 'v-card__header' }, [
      domCreate('h2', { className: 'v-card__title', text: '📁 Структура проекта' }),
      domCreate('span', { className: 'v-card__badge v-card__badge--primary', text: `${state.projectFiles.length} файлов` })
    ]);
    treeCard.appendChild(header);

    const tree = domCreate('div', { className: 'v-file-tree' });
    state.projectFiles.forEach(f => {
      const icon = f.language === 'directory' ? '📁' : '📄';
      tree.appendChild(domCreate('div', {
        className: `v-file-tree__item${f.language === 'directory' ? ' v-file-tree__item--dir' : ''}`,
        text: `${icon} ${f.name} ${f.language !== 'directory' ? `(${f.language})` : ''}`
      }));
    });
    treeCard.appendChild(tree);

    // Analyze button
    const analyzeBtn = domCreate('button', {
      className: 'v-btn v-btn--primary v-btn--block v-mt-md',
      text: '🔍 Анализировать зависимости',
      click: runDependencyAnalysis
    });
    treeCard.appendChild(analyzeBtn);

    // Analysis report if exists
    if (state.dependencyGraph) {
      const reportCard = domCreate('div', { className: 'v-card v-mt-md' });
      const reportHeader = domCreate('div', { className: 'v-card__header' }, [
        domCreate('h3', { className: 'v-card__title', text: '📊 Отчёт по зависимостям' })
      ]);
      reportCard.appendChild(reportHeader);
      const pre = domCreate('pre', {
        className: 'v-output',
        style: 'min-height:200px;max-height:400px;overflow-y:auto;'
      });
      pre.textContent = formatReport(state.dependencyGraph);
      reportCard.appendChild(pre);

      const copyBtn = domCreate('button', {
        className: 'v-btn v-btn--secondary v-btn--block v-mt-md',
        text: '📋 Копировать отчёт',
        click: () => {
          copyToClipboard(formatReport(state.dependencyGraph))
            .then(() => showToast('Отчёт скопирован', TOAST_TYPES.SUCCESS))
            .catch(() => showToast('Ошибка копирования', TOAST_TYPES.ERROR));
        }
      });
      reportCard.appendChild(copyBtn);
      treeCard.appendChild(reportCard);
    }

    container.appendChild(treeCard);
  }
}

function renderInput() {
  const state = store.getState();
  const taskInput = document.getElementById('taskInput');
  const masterResponse = document.getElementById('masterResponse');
  if (taskInput) taskInput.value = state.task;
  if (masterResponse) masterResponse.value = state.masterResponse;
}

function renderRouting() {
  const state = store.getState();
  const container = document.getElementById('mandates-list');
  const countEl = document.getElementById('mandate-count');
  if (!container) return;

  container.innerHTML = '';
  const roles = state.plan?.roles || {};
  if (countEl) countEl.textContent = Object.keys(roles).length + ' ролей';

  for (const [roleKey, mandate] of Object.entries(roles)) {
    const roleData = state.roles[roleKey];
    const snippet = extractContext(mandate.context_needed, state.masterResponse);
    const existing = state.feedbacks[roleKey] || '';
    const hasData = existing.trim().length > 0;

    let promptText;
    if (roleData) {
      promptText = `${roleData.content}\n\n---\n**КОНТЕКСТ:**\n${state.task}\n\n**ФРАГМЕНТ:**\n\`\`\`\n${snippet}\n\`\`\`\n\n**МАНДАТ:**\n- Фокус: ${mandate.focus_areas.join('; ')}\n- Контекст: ${mandate.context_needed}\n- Критичность: ${mandate.severity}\n\n**ФОРМАТ:** Verdict, Issues, Trade-offs, Dependencies`;
    } else {
      promptText = `⚠️ Промпт для '${roleKey}' не найден.\nМандат: ${mandate.focus_areas.join('; ')}`;
    }

    const sevClass = {
      critical: 'v-role-card--critical',
      high: 'v-role-card--high',
      medium: 'v-role-card--medium',
      low: 'v-role-card--low'
    }[mandate.severity] || 'v-role-card--low';

    const card = domCreate('div', {
      className: `v-role-card ${sevClass}${hasData ? ' v-role-card--filled' : ''}`,
      id: `routing-card-${roleKey}`
    });

    // Header
    const header = domCreate('div', { className: 'v-role__header' }, [
      domCreate('div', {}, [
        domCreate('h3', { className: 'v-role__name', text: `👤 ${roleKey}` }),
        domCreate('p', { className: 'v-role__context', text: mandate.context_needed })
      ]),
      domCreate('span', {
        className: `v-role__severity v-role__severity--${mandate.severity}`,
        text: mandate.severity
      })
    ]);
    card.appendChild(header);

    // Focus areas
    const focusBox = domCreate('div', { className: 'v-role__focus' });
    mandate.focus_areas.forEach(f => {
      focusBox.appendChild(domCreate('div', { className: 'v-role__focus-item', text: f }));
    });
    card.appendChild(focusBox);

    // Prompt box
    const promptBox = domCreate('div', { className: 'v-prompt-box' }, [
      domCreate('div', { className: 'v-prompt-box__label', text: '📋 Промпт для Kimi' }),
      domCreate('textarea', {
        id: `prompt-${roleKey}`,
        rows: '4',
        className: 'v-prompt-textarea',
        readonly: true,
        text: promptText
      }),
      domCreate('div', { className: 'v-flex v-flex--gap-sm v-mt-sm' }, [
        domCreate('button', {
          className: 'v-btn v-btn--primary',
          style: 'flex:1',
          text: '📋 Копировать',
          click: () => copyPrompt(roleKey)
        }),
        domCreate('button', {
          className: 'v-btn v-btn--secondary',
          style: 'flex:1',
          text: '↗️ Kimi',
          click: openKimi
        })
      ])
    ]);
    card.appendChild(promptBox);

    // Answer box
    const answerBox = domCreate('div', { className: 'v-answer-box' }, [
      domCreate('div', { className: 'v-answer-box__label', text: '✍️ Ответ роли' }),
      domCreate('textarea', {
        id: `routing-feedback-${roleKey}`,
        rows: '5',
        className: 'v-answer-textarea',
        placeholder: `Вставь ответ Kimi для '${roleKey}'...`,
        text: existing
      }),
      domCreate('div', {
        id: `routing-status-${roleKey}`,
        className: `v-status ${hasData ? 'v-status--success' : 'v-status--neutral'} v-mt-sm`,
        text: hasData ? '✅ Ответ получен' : '⏳ Ожидается'
      })
    ]);
    card.appendChild(answerBox);

    // Bind input with debounce
    const ta = answerBox.querySelector(`#routing-feedback-${roleKey}`);
    if (ta) {
      ta.addEventListener('input', getDebouncer(roleKey, (value) => {
        saveFeedback(roleKey, value);
      }));
    }

    container.appendChild(card);
  }
}

function renderCollector() {
  const state = store.getState();
  const container = document.getElementById('collector-list');
  const progressEl = document.getElementById('collector-progress');
  if (!container) return;

  container.innerHTML = '';
  const roles = state.plan?.roles || {};
  const total = Object.keys(roles).length;
  let filled = 0;

  for (const roleKey of Object.keys(roles)) {
    const feedback = state.feedbacks[roleKey] || '';
    if (feedback.trim()) filled++;
    const hasData = feedback.trim().length > 0;

    const card = domCreate('div', {
      className: `v-collector-card${hasData ? ' v-collector-card--filled' : ''}`,
      id: `collector-card-${roleKey}`
    });

    const header = domCreate('div', { className: 'v-collector__header' }, [
      domCreate('h3', { className: 'v-role__name', text: `📥 ${roleKey}` }),
      domCreate('span', {
        id: `collector-status-${roleKey}`,
        className: `v-status ${hasData ? 'v-status--success' : 'v-status--neutral'}`,
        text: hasData ? '✅ Получено' : '⏳ Ожидается'
      })
    ]);
    card.appendChild(header);

    const ta = domCreate('textarea', {
      id: `feedback-${roleKey}`,
      rows: '6',
      className: 'v-textarea',
      placeholder: `Вставь ответ Kimi для «${roleKey.toUpperCase()}»`,
      text: feedback
    });
    ta.addEventListener('input', getDebouncer(roleKey, (value) => {
      saveFeedback(roleKey, value);
    }));
    card.appendChild(ta);

    const actions = domCreate('div', { className: 'v-flex v-flex--gap-sm v-mt-sm' }, [
      domCreate('button', {
        className: 'v-btn v-btn--secondary',
        style: 'flex:1',
        text: 'Копировать',
        click: () => copyToClipboard(feedback).then(() => showToast('Скопировано', TOAST_TYPES.SUCCESS))
      }),
      domCreate('button', {
        className: 'v-btn v-btn--danger',
        style: 'flex:1',
        text: 'Очистить',
        click: () => clearFeedback(roleKey)
      })
    ]);
    card.appendChild(actions);
    container.appendChild(card);
  }

  if (progressEl) progressEl.textContent = `${filled} / ${total}`;
}

function renderFinal() {
  const state = store.getState();
  const combined = generateCombinedReport(state);
  const output = document.getElementById('combinedOutput');
  if (output) output.value = combined;

  const hasConflicts = combined.includes('## ⚠️ Conflicts Detected');
  const cw = document.getElementById('conflicts-warning');
  const nc = document.getElementById('no-conflicts');
  if (cw && nc) {
    cw.classList.toggle('v-hidden', !hasConflicts);
    nc.classList.toggle('v-hidden', hasConflicts);
  }
}

function renderBottomBar(stateSlice) {
  const { plan, feedbacks, activeScreen } = stateSlice;
  const roles = plan ? Object.keys(plan.roles || {}) : [];
  const total = roles.length;
  let filled = 0;
  roles.forEach(r => { if ((feedbacks[r] || '').trim()) filled++; });

  if (activeScreen === SCREENS.ROUTING) {
    _ui.bottomBar.classList.remove('v-bottom-bar--hidden');
    _ui.bottomStatus.textContent = `Готово ${filled} из ${total} ролей`;
    _ui.bottomHint.textContent = filled === total ? 'все ответы получены →' : 'вставь ответы ниже ↑';
    _ui.bottomBtn.textContent = '➡️ Перейти к сбору';
    _ui.bottomBtn.className = 'v-bottom-bar__btn v-btn--success';
    _ui.bottomBtn.onclick = () => goToScreen(SCREENS.COLLECTOR);
    _ui.bottomBtn.disabled = false;
    _ui.bottomBtn.style.opacity = '1';
  } else if (activeScreen === SCREENS.COLLECTOR) {
    _ui.bottomBar.classList.remove('v-bottom-bar--hidden');
    _ui.bottomStatus.textContent = `Готово ${filled} из ${total} ролей`;
    _ui.bottomHint.textContent = filled >= 1 ? 'можно генерировать →' : 'вставь ответ ↑';
    _ui.bottomBtn.textContent = '🧩 Сгенерировать combined.md';
    _ui.bottomBtn.className = 'v-bottom-bar__btn v-btn--primary';
    _ui.bottomBtn.onclick = () => goToScreen(SCREENS.FINAL);
    if (filled === 0) {
      _ui.bottomBtn.disabled = true;
      _ui.bottomBtn.style.opacity = '0.5';
    } else {
      _ui.bottomBtn.disabled = false;
      _ui.bottomBtn.style.opacity = '1';
    }
  } else {
    _ui.bottomBar.classList.add('v-bottom-bar--hidden');
  }
}

function renderProgress(screenId) {
  if (!screenId) screenId = store.getState().activeScreen;
  const idx = STEPS.findIndex(s => 'screen-' + s === screenId);
  STEPS.forEach((s, i) => {
    const el = document.getElementById('step-' + s);
    if (!el) return;
    el.className = 'v-step';
    if (i === idx) el.classList.add('v-step--active');
    else if (i < idx) el.classList.add('v-step--completed');
    else el.classList.add('v-step--pending');
  });
}

function updateStatus(lastAction) {
  const el = document.getElementById('status-action');
  if (el) el.textContent = `Действие: ${lastAction}`;
}

// ===== ACTIONS =====

function goToScreen(screenId) {
  store.setState({ activeScreen: screenId });
}

function getDebouncer(key, fn) {
  if (!_debouncers[key]) _debouncers[key] = debounce(fn, 300);
  return (e) => _debouncers[key](e.target.value);
}

function saveFeedback(roleKey, value) {
  store.setState({
    feedbacks: { [roleKey]: value },
    lastAction: `Обновлено: ${roleKey}`
  });
  updateFeedbackStatus(roleKey, value.trim().length > 0);
}

function updateFeedbackStatus(roleKey, hasData) {
  const s = document.getElementById(`routing-status-${roleKey}`);
  if (s) {
    s.className = `v-status ${hasData ? 'v-status--success' : 'v-status--neutral'}`;
    s.textContent = hasData ? '✅ Ответ получен' : '⏳ Ожидается';
  }
  const c = document.getElementById(`routing-card-${roleKey}`);
  if (c) c.classList.toggle('v-role-card--filled', hasData);
  const cs = document.getElementById(`collector-status-${roleKey}`);
  if (cs) {
    cs.className = `v-status ${hasData ? 'v-status--success' : 'v-status--neutral'}`;
    cs.textContent = hasData ? '✅ Получено' : '⏳ Ожидается';
  }
  const cc = document.getElementById(`collector-card-${roleKey}`);
  if (cc) cc.classList.toggle('v-collector-card--filled', hasData);
}

function clearFeedback(roleKey) {
  store.setState({
    feedbacks: { [roleKey]: '' },
    lastAction: `Очищено: ${roleKey}`
  });
  const r = document.getElementById(`routing-feedback-${roleKey}`);
  if (r) r.value = '';
  const c = document.getElementById(`feedback-${roleKey}`);
  if (c) c.value = '';
  updateFeedbackStatus(roleKey, false);
}

function copyPrompt(roleKey) {
  const ta = document.getElementById(`prompt-${roleKey}`);
  if (ta) {
    copyToClipboard(ta.value)
      .then(() => showToast('Промпт скопирован', TOAST_TYPES.SUCCESS))
      .catch(() => showToast('Ошибка копирования', TOAST_TYPES.ERROR));
  }
}

function openKimi() {
  window.open('https://kimi.moonshot.cn', '_blank');
  showToast('Kimi открыт', TOAST_TYPES.INFO);
}

function extractContext(need, full) {
  if (!need || need === 'весь файл') return full;
  const safe = need.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`(function\s+${safe}[\s\S]*?\n\})`, 'i'),
    new RegExp(`(const\s+${safe}\s*=\s*[\s\S]*?\n\})`, 'i'),
    new RegExp(`(class\s+${safe}[\s\S]*?\n\})`, 'i'),
    new RegExp(`(\`\`\`[\s\S]*?${safe}[\s\S]*?\`\`\`)`, 'i')
  ];
  for (const p of patterns) {
    const m = full.match(p);
    if (m) return m[1];
  }
  const lines = full.split('\n');
  const idx = lines.findIndex(l => l.includes(need));
  if (idx >= 0) return lines.slice(Math.max(0, idx - 3), Math.min(lines.length, idx + 10)).join('\n');
  return full;
}

function generateCombinedReport(state) {
  let combined = "# 📊 Combined Feedback Report\n\n";
  let hasConflicts = false;
  const issuesList = [];
  const entityMap = new Map();

  for (const [roleKey, feedback] of Object.entries(state.feedbacks)) {
    if (!feedback.trim()) continue;
    const lines = feedback.split('\n');
    lines.forEach(line => {
      const lineNum = line.match(/(?:строка|line)\s*(\d+)/i)?.[1];
      const entities = [
        ...line.matchAll(/(?:логирование|logging|log)/gi),
        ...line.matchAll(/(?:кэш|cache|caching)/gi),
        ...line.matchAll(/(?:валидация|validation|validate)/gi),
        ...line.matchAll(/(?:хэш|hash|hashing)/gi),
        ...line.matchAll(/(?:таймаут|timeout|retry)/gi)
      ];
      entities.forEach(e => {
        const ent = e[0].toLowerCase();
        if (!entityMap.has(ent)) entityMap.set(ent, []);
        entityMap.get(ent).push({ role: roleKey, text: line.trim(), lineNum });
      });
      if (lineNum) issuesList.push({ role: roleKey, text: line.trim(), lineNum: parseInt(lineNum, 10) });
    });
  }

  const conflicts = [];
  const lineGroups = new Map();
  issuesList.forEach(issue => {
    if (!lineGroups.has(issue.lineNum)) lineGroups.set(issue.lineNum, []);
    lineGroups.get(issue.lineNum).push(issue);
  });

  for (const [lineNum, items] of lineGroups) {
    if (items.length < 2) continue;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.role === b.role) continue;
        const addA = /(?:добавь|включи|enable|add|внедри|implement)/i.test(a.text);
        const remA = /(?:убери|отключи|disable|remove|удал|убрать)/i.test(a.text);
        const addB = /(?:добавь|включи|enable|add|внедри|implement)/i.test(b.text);
        const remB = /(?:убери|отключи|disable|remove|удал|убрать)/i.test(b.text);
        if ((addA && remB) || (remA && addB)) {
          conflicts.push(`🔴 **Конфликт строка ${lineNum}**\n- ${a.role}: ${a.text}\n- ${b.role}: ${b.text}`);
          hasConflicts = true;
        }
      }
    }
  }

  for (const [ent, items] of entityMap) {
    if (items.length < 2) continue;
    const adds = items.filter(x => /(?:добавь|включи|enable|add)/i.test(x.text));
    const rems = items.filter(x => /(?:убери|отключи|disable|remove)/i.test(x.text));
    if (adds.length && rems.length) {
      const a = adds[0], b = rems[0];
      if (a.role !== b.role) {
        conflicts.push(`🟡 **Конфликт '${ent}'**\n- ${a.role}: ${a.text}\n- ${b.role}: ${b.text}`);
        hasConflicts = true;
      }
    }
  }

  if (hasConflicts) {
    combined += "## ⚠️ Conflicts Detected\n\n";
    combined += "Мастер, разреши противоречия:\n\n";
    combined += conflicts.join("\n\n") + "\n\n---\n\n";
  }

  combined += "## 📝 Detailed Feedback by Role\n\n";
  for (const [roleKey, feedback] of Object.entries(state.feedbacks)) {
    if (feedback.trim()) combined += `### 🔹 Role: ${roleKey.toUpperCase()}\n${feedback}\n\n`;
  }

  combined += "---\n## 🎯 Инструкция для Мастера\n\n";
  combined += "1. Проанализируй отчёт\n";
  if (hasConflicts) combined += "2. **Разреши конфликты**: безопасность → стабильность → производительность → читаемость\n";
  combined += "3. Сгенерируй финальный код с комментариями\n";
  combined += "4. Выведи новый [ORCHESTRATOR_PLAN] при необходимости\n";

  return combined;
}

// ===== ZIP HANDLING =====

async function handleZipSelect(e) {
  const file = e.target.files[0];
  if (file) await processZipFile(file);
}

async function processZipFile(file) {
  showToast('Чтение ZIP...', TOAST_TYPES.INFO);
  try {
    const buffer = await file.arrayBuffer();
    const files = await parseZip(buffer);
    store.setState({
      projectFiles: files,
      dependencyGraph: null,
      lastAction: `Загружено ${files.length} файлов из ZIP`
    });
    showToast(`${files.length} файлов загружено`, TOAST_TYPES.SUCCESS);
  } catch (e) {
    showToast('Ошибка ZIP: ' + e.message, TOAST_TYPES.ERROR);
    console.error(e);
  }
}

function runDependencyAnalysis() {
  const state = store.getState();
  if (!state.projectFiles.length) {
    showToast('Сначала загрузите проект', TOAST_TYPES.WARN);
    return;
  }
  showToast('Анализ зависимостей...', TOAST_TYPES.INFO);
  try {
    const analysis = analyzeProject(state.projectFiles);
    store.setState({
      dependencyGraph: analysis,
      lastAction: `Анализ завершён: ${analysis.cycles.length} циклов, ${Object.keys(analysis.deadCode).length} dead code`
    });
    showToast('Анализ завершён', TOAST_TYPES.SUCCESS);
  } catch (e) {
    showToast('Ошибка анализа: ' + e.message, TOAST_TYPES.ERROR);
    console.error(e);
  }
}

// ===== GLOBAL EVENTS =====

function bindGlobalEvents() {
  // Base URL input
  const baseUrlInput = document.getElementById('baseUrl');
  if (baseUrlInput) {
    baseUrlInput.addEventListener('change', (e) => {
      store.setState({ baseUrl: e.target.value.replace(/\/?$/, '/') });
    });
  }

  // Task/Master inputs with debounce
  const taskInput = document.getElementById('taskInput');
  const masterResponse = document.getElementById('masterResponse');
  const ds = debounce((task, response) => {
    store.setState({ task, masterResponse: response });
  }, 300);
  if (taskInput) taskInput.addEventListener('input', () => ds(taskInput.value, masterResponse?.value || ''));
  if (masterResponse) masterResponse.addEventListener('input', () => ds(taskInput?.value || '', masterResponse.value));
}

// ===== TOAST =====

function showToast(msg, type = TOAST_TYPES.INFO) {
  const t = _ui.toast;
  if (!t) return;
  t.textContent = msg;
  const c = {
    [TOAST_TYPES.ERROR]: 'v-toast--error',
    [TOAST_TYPES.SUCCESS]: 'v-toast--success',
    [TOAST_TYPES.WARN]: 'v-toast--warning',
    [TOAST_TYPES.INFO]: 'v-toast--info'
  };
  t.className = 'v-toast ' + (c[type] || c[TOAST_TYPES.INFO]);
  t.classList.add('v-toast--visible');
  setTimeout(() => t.classList.remove('v-toast--visible'), 3500);
}

/* exports */;


// ===== APP ENTRY =====
// ============================================
// VOYAGE APP v3 — Entry point
// ============================================


// Expose to window for inline onclick handlers
window.app = {
  store,
  goToScreen,
  loadRoles,
  loadRolesFromFile,
  exportSession,
  importSession,
  resetSession,
  parsePlan,
  copyToClipboard,
  openKimi,
  showToast
};

function parsePlan() {
  const state = store.getState();
  const taskInput = document.getElementById('taskInput');
  const masterResponse = document.getElementById('masterResponse');
  const task = taskInput?.value || '';
  const response = masterResponse?.value || '';

  store.setState({ task, masterResponse: response });

  const m = response.match(/\[ORCHESTRATOR_PLAN\]([\s\S]*?)\[\/ORCHESTRATOR_PLAN\]/);
  if (!m) {
    showToast('Тег [ORCHESTRATOR_PLAN] не найден', 'error');
    return;
  }

  let j = m[1].trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
  j = j.replace(/,\s*([}\]])/g, '$1');

  try {
    const plan = JSON.parse(j);
    validatePlan(plan);
    store.setState({ plan, lastAction: `План: ${Object.keys(plan.roles || {}).length} ролей` });
    goToScreen('screen-routing');
    showToast(`План: ${Object.keys(plan.roles || {}).length} ролей`, 'success');
  } catch (e) {
    showToast('Ошибка плана: ' + e.message, 'error');
  }
}

function validatePlan(plan) {
  const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low'];
  if (!plan || typeof plan !== 'object') throw new Error('План не объект');
  if (!plan.roles || typeof plan.roles !== 'object') throw new Error('Нет поля roles');
  const keys = Object.keys(plan.roles);
  if (!keys.length) throw new Error('Пустой план');
  for (const [k, v] of Object.entries(plan.roles)) {
    if (!v || typeof v !== 'object') throw new Error(`Роль ${k}: не объект`);
    if (!Array.isArray(v.focus_areas)) throw new Error(`Роль ${k}: focus_areas не массив`);
    if (!v.context_needed) throw new Error(`Роль ${k}: нет context_needed`);
    if (!SEVERITY_LEVELS.includes(v.severity)) throw new Error(`Роль ${k}: неверный severity`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('Voyage Orchestrator v3 initialized');
  initUI();
});


})();
