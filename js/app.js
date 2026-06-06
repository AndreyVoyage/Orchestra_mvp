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

const ZIP_MAX_FILES = 1000;
const ZIP_MAX_EXTRACT_SIZE = 50 * 1024 * 1024; // 50 MB

function getData(buffer, offset, size) {
  if (offset < 0 || offset + size > buffer.byteLength) {
    throw new RangeError(`ZIP bounds error: offset=${offset}, size=${size}, length=${buffer.byteLength}`);
  }
  return buffer.slice(offset, offset + size);
}

function readString(buffer, offset, len) {
  return new TextDecoder('utf-8').decode(getData(buffer, offset, len));
}

async function decompressDeflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream не поддерживается в этом браузере');
  }
  try {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  } catch (e) {
    throw new Error('ZIP decompression failed: ' + e.message);
  }
}

function findEOCD(buffer) {
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
  if (eocd.cdOffset >= buffer.byteLength) {
    throw new Error('ZIP: Invalid Central Directory offset');
  }
  const files = [];
  const view = new DataView(buffer);
  let offset = eocd.cdOffset;
  for (let i = 0; i < eocd.cdRecords; i++) {
    if (offset + CDFH_OFFS.FIXED > buffer.byteLength) {
      throw new Error('ZIP: Central Directory exceeds buffer bounds at offset ' + offset);
    }
    if (view.getUint32(offset, true) !== CDFH_SIG) {
      throw new Error('ZIP: Invalid Central Directory File Header at offset ' + offset);
    }
    const nameLen = view.getUint16(offset + CDFH_OFFS.NAME_LEN, true);
    const extraLen = view.getUint16(offset + CDFH_OFFS.EXTRA_LEN, true);
    const commentLen = view.getUint16(offset + CDFH_OFFS.COMMENT_LEN, true);
    const totalLen = CDFH_OFFS.FIXED + nameLen + extraLen + commentLen;
    if (offset + totalLen > buffer.byteLength) {
      throw new Error('ZIP: Central Directory entry exceeds buffer bounds');
    }
    const name = readString(buffer, offset + CDFH_OFFS.FIXED, nameLen);
    const compMethod = view.getUint16(offset + CDFH_OFFS.COMP_METHOD, true);
    const compSize = view.getUint32(offset + CDFH_OFFS.COMP_SIZE, true);
    const uncompSize = view.getUint32(offset + CDFH_OFFS.UNCOMP_SIZE, true);
    const fhOffset = view.getUint32(offset + CDFH_OFFS.FH_OFFSET, true);
    files.push({ name, compMethod, compSize, uncompSize, fhOffset });
    offset += totalLen;
  }
  return files;
}

async function extractFile(buffer, fileInfo) {
  const view = new DataView(buffer);
  const fhOffset = fileInfo.fhOffset;
  if (fhOffset + FH_OFFS.FIXED > buffer.byteLength) {
    throw new Error('ZIP: File header out of bounds for ' + fileInfo.name);
  }
  if (view.getUint32(fhOffset, true) !== FH_SIG) {
    throw new Error('ZIP: Invalid File Header for ' + fileInfo.name);
  }
  const nameLen = view.getUint16(fhOffset + FH_OFFS.NAME_LEN, true);
  const extraLen = view.getUint16(fhOffset + FH_OFFS.EXTRA_LEN, true);
  const dataOffset = fhOffset + FH_OFFS.FIXED + nameLen + extraLen;
  const endOffset = dataOffset + fileInfo.compSize;
  if (endOffset > buffer.byteLength) {
    throw new Error('ZIP: Compressed data exceeds buffer for ' + fileInfo.name);
  }
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
  if (files.length > ZIP_MAX_FILES) {
    throw new Error(`ZIP: Too many files (${files.length} > ${ZIP_MAX_FILES})`);
  }
  const result = [];
  let extractedSize = 0;
  for (const info of files) {
    if (info.name.endsWith('/')) continue;
    if (info.name.startsWith('__MACOSX/')) continue;
    if (info.name.startsWith('.')) continue;
    try {
      const raw = await extractFile(buffer, info);
      extractedSize += raw.byteLength;
      if (extractedSize > ZIP_MAX_EXTRACT_SIZE) {
        throw new Error(`ZIP: Total extracted size exceeds ${ZIP_MAX_EXTRACT_SIZE} bytes`);
      }
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
  if (/^\s*import\s+.+\s+from\s+['"]/.test(content)) return 'javascript';
  if (/^\s*def\s+\w+\s*\(/.test(content)) return 'python';
  if (/^\s*package\s+main\b/.test(content)) return 'go';
  if (/^\s*<\?php/.test(content)) return 'php';
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
    exports: null
  },
  go: {
    imports: [
      /import\s+\(\s*([^)]+)\)/gs,
      /import\s+['"]([^'"]+)['"]/g
    ],
    functions: /func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/g,
    classes: null,
    exports: /func\s+(\w+)[^(]*\(/g
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
    functions: /<script[^>]*>([\s\S]*?)<\/script>/gi,
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
  path = path.split('?')[0].split('#')[0];
  if (/^https?:\/\//.test(path)) return null;
  path = path.replace(/^\.\//, '').replace(/^\//, '');
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
    if (!regex.global) {
      console.warn('Regex without global flag in extractImports:', regex);
      const match = regex.exec(content);
      if (match) {
        const dep = match[1] || match[2];
        if (dep) deps.add(cleanPath(dep));
      }
      continue;
    }
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const dep = match[1] || match[2];
      if (dep) {
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
    if (!patterns.functions.global) {
      console.warn('Regex without global flag in functions:', patterns.functions);
      const m = patterns.functions.exec(content);
      if (m) symbols.functions.push(m[1] || m[2]);
    } else {
      patterns.functions.lastIndex = 0;
      let m;
      while ((m = patterns.functions.exec(content)) !== null) {
        symbols.functions.push(m[1] || m[2]);
      }
    }
  }
  if (patterns.classes) {
    if (!patterns.classes.global) {
      console.warn('Regex without global flag in classes:', patterns.classes);
      const m = patterns.classes.exec(content);
      if (m) symbols.classes.push(m[1]);
    } else {
      patterns.classes.lastIndex = 0;
      let m;
      while ((m = patterns.classes.exec(content)) !== null) {
        symbols.classes.push(m[1]);
      }
    }
  }
  if (patterns.exports) {
    if (!patterns.exports.global) {
      console.warn('Regex without global flag in exports:', patterns.exports);
      const m = patterns.exports.exec(content);
      if (m) symbols.exports.push(m[1] || 'default');
    } else {
      patterns.exports.lastIndex = 0;
      let m;
      while ((m = patterns.exports.exec(content)) !== null) {
        symbols.exports.push(m[1] || 'default');
      }
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

  files.forEach(f => {
    const cleanName = f.name.replace(/\.[^.]+$/, '');
    if (fileMap.has(cleanName)) {
      console.warn('File name collision (clean):', cleanName, f.name);
    }
    fileMap.set(cleanName, f);
    fileMap.set(f.name, f);
    const patterns = LANGUAGE_PATTERNS[f.language] || LANGUAGE_PATTERNS.javascript;
    symbols[f.name] = extractSymbols(f.content, patterns);
    graph[f.name] = {
      dependencies: [],
      dependents: [],
      language: f.language,
      symbols: symbols[f.name],
      size: f.content.length,
      _content: f.content
    };
  });

  files.forEach(f => {
    const patterns = LANGUAGE_PATTERNS[f.language] || LANGUAGE_PATTERNS.javascript;
    const imports = extractImports(f.content, patterns);
    graph[f.name].dependencies = imports.map(dep => {
      const resolved = resolveDependency(dep, f.name, fileMap);
      return { raw: dep, resolved };
    });
  });

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
  if (fileMap.has(dep)) return fileMap.get(dep).name;
  for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java']) {
    if (fileMap.has(dep + ext)) return fileMap.get(dep + ext).name;
  }
  const currentDir = currentFile.split('/').slice(0, -1).join('/');
  const relativePath = currentDir ? currentDir + '/' + dep : dep;
  if (fileMap.has(relativePath)) return fileMap.get(relativePath).name;
  for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java']) {
    if (fileMap.has(relativePath + ext)) return fileMap.get(relativePath + ext).name;
  }
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
  const recStack = new Set();
  const path = [];

  function dfs(node, visited) {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const deps = (graph[node]?.dependencies || [])
      .map(d => d.resolved)
      .filter(Boolean);

    for (const dep of deps) {
      if (!visited.has(dep)) {
        dfs(dep, visited);
      } else if (recStack.has(dep)) {
        const cycleStart = path.indexOf(dep);
        const cycle = path.slice(cycleStart).concat([dep]);
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
    const visited = new Set();
    dfs(node, visited);
  });

  return cycles;
}

function normalizeCycle(cycle) {
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
      const deps = otherInfo.dependencies || [];
      if (deps.some(d => d.resolved === file)) {
        const otherContent = otherInfo._content || '';
        info.symbols.exports.forEach(exp => {
          if (exp === 'default') {
            used.add('default');
            return;
          }
          const namedImportRe = new RegExp('import\\s+\\{[^}]*\\b' + escapeRegExp(exp) + '\\b[^}]*\\}');
          const nsImportRe = new RegExp('import\\s+\\*\\s+as\\s+\\w+.*?from\\s+["\'][^"\']*' + escapeRegExp(file.replace(/\.[^.]+$/, '')) + '[^"\']*["\']');
          if (namedImportRe.test(otherContent) || nsImportRe.test(otherContent) || otherContent.includes(exp)) {
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
  const totalSize = files.reduce((s, f) => s + f.content.length, 0);
  return {
    totalFiles: files.length,
    totalDependencies: totalDeps,
    unresolvedDependencies: unresolved,
    languages: langs,
    avgFileSize: files.length ? Math.round(totalSize / files.length) : 0,
    totalSize
  };
}

/**
 * Format analysis as markdown report
 */
function formatReport(analysis) {
  const { graph, cycles, impact, deadCode, orphans, stats } = analysis;
  let report = '# 📊 Dependency Analysis Report\n\n';

  report += '## 📈 Statistics\n\n';
  report += `- **Total files:** ${stats.totalFiles}\n`;
  report += `- **Total dependencies:** ${stats.totalDependencies}\n`;
  report += `- **Unresolved:** ${stats.unresolvedDependencies}\n`;
  report += `- **Languages:** ${Object.entries(stats.languages).map(([k,v]) => `${k}(${v})`).join(', ')}\n`;
  report += `- **Avg file size:** ${stats.avgFileSize} chars\n`;
  report += `- **Total size:** ${stats.totalSize} chars\n\n`;

  report += '## 🔄 Cycles\n\n';
  if (cycles.length) {
    cycles.forEach(c => {
      report += `- 🔴 **${c.join(' → ')}**\n`;
    });
  } else {
    report += '- ✅ No cycles detected\n';
  }
  report += '\n';

  report += '## 💥 Impact Analysis\n\n';
  report += '> "If you change X, these files may break:"\n\n';
  Object.entries(impact).forEach(([file, deps]) => {
    if (deps.length) {
      report += `- **${file}** → ${deps.slice(0, 10).join(', ')}${deps.length > 10 ? ` (+${deps.length - 10} more)` : ''}\n`;
    }
  });
  report += '\n';

  report += '## 💀 Dead Code\n\n';
  if (Object.keys(deadCode).length) {
    Object.entries(deadCode).forEach(([file, exports]) => {
      report += `- **${file}**: ${exports.join(', ')}\n`;
    });
  } else {
    report += '- ✅ No dead exports detected\n';
  }
  report += '\n';

  if (orphans.length) {
    report += '## 🏝️ Orphaned Files\n\n';
    orphans.forEach(f => report += `- ${f}\n`);
    report += '\n';
  }

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
let _rolesLoading = false;

function normalizeBaseUrl(url) {
  return (url || './prompts/').replace(/\/+$/, '') + '/';
}

async function loadRoles() {
  if (_rolesLoading) {
    showToast('Загрузка уже идёт', TOAST_TYPES.WARN);
    return;
  }
  _rolesLoading = true;

  const baseUrl = normalizeBaseUrl(document.getElementById('baseUrl')?.value);
  store.setState({ baseUrl, lastAction: 'Загрузка ролей...' });

  if (!isValidBaseUrl(baseUrl)) {
    showToast('Некорректный URL', TOAST_TYPES.ERROR);
    updateRolesStatus('error', 'Некорректный URL', 'Проверьте путь');
    _rolesLoading = false;
    return;
  }

  if (window.location.protocol === 'file:') {
    showToast('Локальный файл: используйте кнопку «Выбрать roles.json»', TOAST_TYPES.WARN);
    updateRolesStatus('warning', 'Локальный режим (file://)', 'fetch() заблокирован браузером. Нажмите кнопку «Выбрать roles.json» ниже, чтобы загрузить роли вручную.');
    _rolesLoading = false;
    return;
  }

  store.setState({ roles: {} });
  updateRolesStatus('info', 'Загрузка...', '');

  if (_rolesAbortController) _rolesAbortController.abort();
  _rolesAbortController = new AbortController();
  const to = setTimeout(() => _rolesAbortController.abort(), 10000);

  let roleFiles = [];
  try {
    const r = await fetch(baseUrl + 'roles.json', { signal: _rolesAbortController.signal });
    clearTimeout(to);
    if (r.ok) {
      const m = await r.json();
      if (m && Array.isArray(m.roles)) {
        store.setState({ manifest: m });
        roleFiles = m.roles.map(x => x.file).filter(f => typeof f === 'string');
        updateRolesStatus('success', `Манифест: ${roleFiles.length} ролей`, '');
      } else throw new Error('bad manifest');
    } else throw new Error('not found');
  } catch (e) {
    clearTimeout(to);
    if (e.name === 'AbortError') {
      updateRolesStatus('error', 'Таймаут (10с)', '');
      showToast('Таймаут загрузки', TOAST_TYPES.ERROR);
      _rolesLoading = false;
      return;
    }
    updateRolesStatus('warning', 'Fallback-список', '');
    roleFiles = ['ROLE-001-security.md', 'ROLE-002-qa.md', 'ROLE-003-performance.md', 'ROLE-004-reviewer.md'];
  } finally {
    _rolesAbortController = null;
  }

  await loadRoleFiles(roleFiles, baseUrl);
  _rolesLoading = false;
}

async function fetchRoleFile(baseUrl, file) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(baseUrl + file, { signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) return null;
    const content = await r.text();
    const m = file.match(/ROLE-\d+-(.+)\.md$/);
    const roleName = m ? m[1] : file.replace(/\.md$/, '');
    return { roleName, filename: file, content };
  } catch {
    clearTimeout(to);
    return null;
  }
}

async function loadRoleFiles(roleFiles, baseUrl) {
  const CONCURRENCY = 5;
  const results = [];

  for (let i = 0; i < roleFiles.length; i += CONCURRENCY) {
    const chunk = roleFiles.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(f => fetchRoleFile(baseUrl, f)));
    results.push(...chunkResults);
  }

  let loaded = 0;
  const roles = {};
  const seenNames = new Set();
  results.forEach(r => {
    if (!r) return;
    if (seenNames.has(r.roleName)) {
      console.warn('Duplicate role name, skipping:', r.roleName);
      return;
    }
    seenNames.add(r.roleName);
    roles[r.roleName] = { filename: r.filename, content: r.content, id: r.roleName };
    loaded++;
  });

  store.setState({ roles });

  if (loaded > 0) {
    const names = Object.keys(roles).join(', ');
    updateRolesStatus('success', `${loaded} ролей загружено`, escapeHtml(names));
    showToast(`${loaded} ролей загружено`, TOAST_TYPES.SUCCESS);
    requestAnimationFrame(() => goToScreen('screen-input'));
  } else {
    updateRolesStatus('error', 'Ошибка загрузки', 'Проверьте путь. Для локального теста запустите: python3 -m http.server 8000');
    showToast('Роли не загружены — проверьте путь', TOAST_TYPES.ERROR);
  }
}

async function loadRolesFromFile(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const manifest = JSON.parse(text);
    if (!manifest || !Array.isArray(manifest.roles)) throw new Error('Неверная структура манифеста');
    store.setState({ manifest });
    const roleFiles = manifest.roles.map(x => x.file).filter(f => typeof f === 'string');
    updateRolesStatus('success', `Манифест: ${roleFiles.length} ролей`, '');
    showToast('Манифест загружен. Выберите .md файлы ролей.', TOAST_TYPES.SUCCESS);
    promptForMdFiles(roleFiles);
  } catch (e) {
    showToast('Ошибка roles.json: ' + e.message, TOAST_TYPES.ERROR);
  }
  input.value = '';
}

function promptForMdFiles(expectedFiles) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.md';
  input.onchange = (e) => {
    loadMdFiles(e.target.files, expectedFiles);
    input.remove();
  };
  input.click();
}

async function loadMdFiles(files, expectedFiles) {
  const fileMap = new Map();
  for (const file of files) {
    if (!fileMap.has(file.name)) fileMap.set(file.name, file);
  }

  const roles = {};
  let loaded = 0;
  const seenNames = new Set();
  const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB per file

  for (const fileName of expectedFiles) {
    const file = fileMap.get(fileName);
    if (!file) continue;
    if (file.size > MAX_FILE_SIZE) {
      console.warn('File too large, skipping:', fileName, file.size);
      continue;
    }
    try {
      const content = await file.text();
      const m = fileName.match(/ROLE-\d+-(.+)\.md$/);
      const roleName = m ? m[1] : fileName.replace(/\.md$/, '');
      if (seenNames.has(roleName)) {
        console.warn('Duplicate role name, skipping:', roleName);
        continue;
      }
      seenNames.add(roleName);
      roles[roleName] = { filename: fileName, content, id: roleName };
      loaded++;
    } catch (e) { console.error('Failed to read', fileName, e); }
  }

  store.setState({ roles });

  if (loaded > 0) {
    const names = Object.keys(roles).join(', ');
    updateRolesStatus('success', `${loaded} ролей загружено`, escapeHtml(names));
    showToast(`${loaded} ролей загружено`, TOAST_TYPES.SUCCESS);
    requestAnimationFrame(() => goToScreen('screen-input'));
  } else {
    updateRolesStatus('error', 'Ошибка загрузки', 'Не найдены .md файлы из манифеста. Проверьте имена файлов.');
    showToast('Роли не загружены', TOAST_TYPES.ERROR);
  }
}

function updateRolesStatus(type, title, detail) {
  const el = document.getElementById('roles-status');
  if (!el) return;
  const icons = { success: '✅', warning: '⚠️', error: '❌', info: '⏳' };
  el.className = `v-alert v-alert--${type} v-mt-md`;
  el.innerHTML = `<span class="v-alert__icon">${icons[type] || 'ℹ️'}</span><div class="v-alert__content"><strong>${escapeHtml(title)}</strong>${detail ? `<br><span style="font-size:.75rem;color:var(--v-text-muted)">${escapeHtml(detail)}</span>` : ''}</div>`;
}

// ===== IMPORT/EXPORT SESSION =====

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


// ===== UI v3.2.1 =====
// XSS-safe DOM rendering, memory-safe debouncers, a11y, visual feedback
// ============================================

const _ui = {};
let _sectionEls = [];
const _debouncers = {};

function initUI() {
  initLogInterceptor();
  console.log('[UI] initUI() called');
  _ui.app = document.getElementById('app');
  _ui.bottomBar = document.getElementById('bottom-bar');
  _sectionEls = Array.from(document.querySelectorAll('.v-section'));
  showToast('Система готова', 'info');
}

function renderScreen(screenId) {
  console.log('[UI] renderScreen(' + screenId + ')');
  if (!_ui.app) return;
  _sectionEls.forEach(el => el.classList.toggle('v-active', el.id === screenId));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearDebouncers() {
  console.log('[UI] clearDebouncers()');
  Object.values(_debouncers).forEach(d => d.cancel && d.cancel());
  Object.keys(_debouncers).forEach(k => delete _debouncers[k]);
}

function renderSettings() {
  console.log('[UI] renderSettings()');
  const container = document.getElementById('settings-container');
  if (!container) return;
  container.innerHTML = '';
  const state = store.getState();
  
  const label = document.createElement('label');
  label.textContent = 'Base URL';
  container.appendChild(label);
  
  const input = document.createElement('input');
  input.id = 'baseUrl';
  input.type = 'text';
  input.value = state.baseUrl;
  input.setAttribute('aria-label', 'Base URL для загрузки ролей');
  container.appendChild(input);
  
  const btnServer = document.createElement('button');
  btnServer.textContent = 'Загрузить роли (с сервера)';
  btnServer.setAttribute('aria-label', 'Загрузить роли с сервера');
  btnServer.addEventListener('click', () => {
    console.log('[UI] Загрузить роли (с сервера) clicked');
    showToast('Загрузка ролей...', 'info');
    if (typeof loadRoles === 'function') {
      loadRoles();
    } else {
      console.error('[UI] loadRoles не определена');
      showToast('Ошибка: loadRoles не найдена', 'error');
    }
  });
  container.appendChild(btnServer);
  
  const btnLocal = document.createElement('button');
  btnLocal.textContent = 'Выбрать roles.json';
  btnLocal.setAttribute('aria-label', 'Загрузить манифест ролей из файла');
  btnLocal.addEventListener('click', () => {
    console.log('[UI] Выбрать roles.json clicked');
    showToast('Выбор файла...', 'info');
    if (typeof promptForMdFiles === 'function') {
      promptForMdFiles();
    } else {
      console.error('[UI] promptForMdFiles не определена');
      showToast('Ошибка: promptForMdFiles не найдена', 'error');
    }
  });
  container.appendChild(btnLocal);
  
  const roleCount = Object.keys(state.roles || {}).length;
  const statusDiv = document.createElement('div');
  statusDiv.className = roleCount > 0 ? 'v-alert v-alert--success' : 'v-alert v-alert--info';
  statusDiv.textContent = roleCount > 0 ? roleCount + ' ролей загружено' : 'Роли не загружены. Нажми «Загрузить роли».';
  container.appendChild(statusDiv);
}

function renderProject() {
  console.log('[UI] renderProject()');
  const container = document.getElementById('project-container');
  if (!container) return;
  container.innerHTML = '';
  
  const dropZone = document.createElement('div');
  dropZone.className = 'v-dropzone';
  dropZone.setAttribute('role', 'button');
  dropZone.setAttribute('tabindex', '0');
  dropZone.setAttribute('aria-label', 'Зона для загрузки ZIP файла проекта');
  dropZone.textContent = 'Перетащите ZIP сюда или нажмите для выбора';
  
  dropZone.addEventListener('click', () => {
    console.log('[UI] Drop zone clicked');
    const zipInput = document.getElementById('zip-input');
    if (zipInput) zipInput.click();
  });
  
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      console.log('[UI] Drop zone keydown: ' + e.key);
      const zipInput = document.getElementById('zip-input');
      if (zipInput) zipInput.click();
    }
  });
  
  container.appendChild(dropZone);
}

function renderRouting() {
  console.log('[UI] renderRouting()');
  clearDebouncers();
  const container = document.getElementById('routing-container');
  if (!container) return;
  container.innerHTML = '';
  
  const state = store.getState();
  const roles = Object.keys(state.roles || {});
  
  if (roles.length === 0) {
    container.textContent = 'Сначала загрузите роли';
    return;
  }
  
  roles.forEach(roleName => {
    const section = document.createElement('div');
    section.className = 'v-role-section';
    
    const h3 = document.createElement('h3');
    h3.textContent = roleName;
    section.appendChild(h3);
    
    const ta = document.createElement('textarea');
    ta.id = 'feedback-' + roleName;
    ta.setAttribute('aria-label', 'Feedback для роли ' + roleName);
    ta.placeholder = 'Введите feedback...';
    section.appendChild(ta);
    
    container.appendChild(section);
    
    _debouncers[roleName] = debounce(() => {
      store.setState({ feedbacks: { [roleName]: ta.value } });
    }, 500);
    ta.addEventListener('input', _debouncers[roleName]);
  });
}

function renderCollector() {
  console.log('[UI] renderCollector()');
  clearDebouncers();
  const container = document.getElementById('collector-container');
  if (!container) return;
  container.innerHTML = '';
  
  const state = store.getState();
  const roles = Object.keys(state.roles || {});
  
  roles.forEach(roleName => {
    const feedback = state.feedbacks[roleName] || '';
    const section = document.createElement('div');
    section.className = 'v-role-section';
    
    const h3 = document.createElement('h3');
    h3.textContent = roleName;
    section.appendChild(h3);
    
    const ta = document.createElement('textarea');
    ta.id = 'collect-' + roleName;
    ta.setAttribute('aria-label', 'Сбор данных для роли ' + roleName);
    ta.value = feedback;
    ta.readOnly = true;
    section.appendChild(ta);
    
    container.appendChild(section);
  });
}

function renderFinal() {
  console.log('[UI] renderFinal()');
  const container = document.getElementById('final-container');
  if (!container) return;
  container.innerHTML = '';
  
  const state = store.getState();
  const report = formatReport(state);
  
  const pre = document.createElement('pre');
  pre.className = 'v-report';
  pre.textContent = report;
  container.appendChild(pre);
  
  const btn = document.createElement('button');
  btn.textContent = 'Копировать отчёт';
  btn.addEventListener('click', () => {
    console.log('[UI] Копировать отчёт clicked');
    if (typeof copyToClipboard === 'function') {
      copyToClipboard(report).then(() => showToast('Отчёт скопирован!', 'success'));
    }
  });
  container.appendChild(btn);
}

function renderBottomBar() {
  if (!_ui.bottomBar) return;
  const state = store.getState();
  const screens = ['screen-settings', 'screen-project', 'screen-input', 'screen-routing', 'screen-collector', 'screen-final', 'screen-logs'];
  const current = state.activeScreen;
  const idx = screens.indexOf(current);
  
  _ui.bottomBar.innerHTML = '';
  const nav = document.createElement('nav');
  nav.className = 'v-bottom-nav';
  nav.setAttribute('role', 'navigation');
  
  screens.forEach((screen, i) => {
    const btn = document.createElement('button');
    btn.className = i === idx ? 'v-nav-btn v-nav-btn--active' : 'v-nav-btn';
    btn.textContent = screen.replace('screen-', '');
    btn.setAttribute('aria-label', 'Перейти к ' + screen.replace('screen-', ''));
    btn.addEventListener('click', () => {
      console.log('[UI] Nav clicked: ' + screen);
      goToScreen(screen);
    });
    nav.appendChild(btn);
  });
  
  _ui.bottomBar.appendChild(nav);
}

function goToScreen(screenId) {
  console.log('[UI] goToScreen(' + screenId + ')');
  store.setState({ activeScreen: screenId });
  renderScreen(screenId);
  renderBottomBar();
  
  switch (screenId) {
    case 'screen-settings': renderSettings(); break;
    case 'screen-project': renderProject(); break;
    case 'screen-input': break;
    case 'screen-routing': renderRouting(); break;
    case 'screen-collector': renderCollector(); break;
    case 'screen-final': renderFinal(); break;
    case 'screen-logs': renderLogs(); break;
  }
}

function showToast(message, type) {
  console.log('[Toast] ' + type + ': ' + message);
  const toast = document.createElement('div');
  toast.className = 'v-toast v-toast--' + type;
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3000);
}

function formatReport(analysis) {
  return JSON.stringify(analysis, null, 2);
}
// ===== LOGS / TESTING =====
const _logs = [];
const MAX_LOGS = 500;

function initLogInterceptor() {
  const origLog = console.log, origWarn = console.warn, origError = console.error, origInfo = console.info;
  function addLog(type, args) {
    const ts = new Date().toLocaleTimeString();
    const msg = Array.from(args).map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    _logs.push(`[${ts}] [${type}] ${msg}`);
    if (_logs.length > MAX_LOGS) _logs.shift();
    const lc = document.getElementById('logs-container');
    if (lc && lc.closest('.v-active')) renderLogs();
  }
  console.log = (...a) => { addLog('LOG', a); origLog.apply(console, a); };
  console.warn = (...a) => { addLog('WARN', a); origWarn.apply(console, a); };
  console.error = (...a) => { addLog('ERROR', a); origError.apply(console, a); };
  console.info = (...a) => { addLog('INFO', a); origInfo.apply(console, a); };
}

function renderLogs() {
  console.log('[UI] renderLogs()');
  const c = document.getElementById('logs-container');
  if (!c) return;
  c.innerHTML = '';
  const state = store.getState();
  const roles = Object.keys(state.roles || {}).length;

  const h = document.createElement('div');
  h.innerHTML = `<h3>📋 Тестирование и логи</h3><p>Ролей: ${roles} | Логов: ${_logs.length}</p>`;
  c.appendChild(h);

  const sys = document.createElement('div');
  sys.innerHTML = `<strong>System:</strong> ${navigator.userAgent}<br><strong>Screen:</strong> ${window.innerWidth}x${window.innerHeight}<br><strong>DecompressionStream:</strong> ${typeof DecompressionStream !== 'undefined' ? '✅' : '❌'}<<br><strong>Clipboard:</strong> ${navigator.clipboard ? '✅' : '❌'}`;
  c.appendChild(sys);

  const btns = document.createElement('div');
  const b1 = document.createElement('button'); b1.textContent = '🧪 Загрузить роли'; b1.onclick = () => { console.log('[TEST] Загрузить роли'); showToast('Тест...', 'info'); if (typeof loadRoles === 'function') loadRoles(); }; btns.appendChild(b1);
  const b2 = document.createElement('button'); b2.textContent = '🧪 Выбрать файл'; b2.onclick = () => { console.log('[TEST] Выбрать файл'); showToast('Тест...', 'info'); if (typeof promptForMdFiles === 'function') promptForMdFiles(); }; btns.appendChild(b2);
  const b3 = document.createElement('button'); b3.textContent = '🧪 ZIP парсинг'; b3.onclick = () => { console.log('[TEST] ZIP'); showToast('Перетащите ZIP', 'info'); }; btns.appendChild(b3);
  const b4 = document.createElement('button'); b4.textContent = '🗑️ Очистить логи'; b4.onclick = () => { _logs.length = 0; console.log('[TEST] Очищено'); renderLogs(); }; btns.appendChild(b4);
  c.appendChild(btns);

  const ta = document.createElement('textarea');
  ta.id = 'logs-output'; ta.className = 'v-logs-textarea'; ta.readOnly = true;
  ta.value = _logs.length === 0 ? 'Логи пусты. Нажмите кнопки тестирования.' : _logs.join('\n');
  c.appendChild(ta);

  const copyBtn = document.createElement('button');
  copyBtn.textContent = '📋 Скопировать все логи';
  copyBtn.onclick = () => {
    if (typeof copyToClipboard === 'function') {
      copyToClipboard(ta.value).then(() => showToast('Скопировано!', 'success'));
    }
  };
  c.appendChild(copyBtn);
}
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
