'use strict';

/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  HireEdge — Career Intelligence API
 *  v1.0.0
 *
 *  Production-ready REST API powered by career-intelligence-engine.js.
 *  Zero external dependencies — built on Node.js built-in http module.
 *
 *  START
 *  ─────
 *  node career-api-server.js
 *  node career-api-server.js --port 4000
 *  PORT=4000 node career-api-server.js
 *
 *  ENDPOINTS
 *  ─────────
 *  POST /api/career-advisor    recommendNextRoles  — goal-weighted role recs
 *  GET  /api/role-analysis     analyzeCareer       — full career profile
 *  GET  /api/career-path       findHighGrowthPaths — salary growth paths
 *  GET  /api/skill-gap         analyzeSkillGap     — skill delta + learning plan
 *  GET  /api/salary-growth     findBestCareerSwitch + findHighGrowthPaths
 *  GET  /api/role-compare      compareRoles        — head-to-head comparison
 *
 *  UTILITY
 *  ───────
 *  GET  /health
 *  GET  /api/goals
 *
 *  CONFIGURATION (env vars or CLI flags)
 *  ──────────────────────────────────────
 *  PORT                   Server port (default: 3000)
 *  DATA_DIR               Directory containing JSON datasets
 *  RATE_LIMIT_MAX         Max requests per window per IP (default: 60)
 *  RATE_LIMIT_WINDOW_MS   Rate-limit window in ms (default: 60000)
 * ══════════════════════════════════════════════════════════════════════════════
 */

const http    = require('http');
const url     = require('url');
const path    = require('path');
const { StringDecoder } = require('string_decoder');

// ── Configuration ─────────────────────────────────────────────────────────────

const argv    = process.argv.slice(2);
const argPort = argv.includes('--port') ? parseInt(argv[argv.indexOf('--port') + 1]) : null;

const CONFIG = {
  PORT:               argPort || parseInt(process.env.PORT) || 3000,
  DATA_DIR:           process.env.DATA_DIR || __dirname,
  RATE_LIMIT_MAX:     parseInt(process.env.RATE_LIMIT_MAX)     || 60,
  RATE_LIMIT_WINDOW:  parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  REQUEST_TIMEOUT_MS: 10_000,
};

// ── Engine bootstrap ──────────────────────────────────────────────────────────

const ci = require('./career-intelligence-engine');

try {
  ci.load({
    knowledgeGraph: path.join(CONFIG.DATA_DIR, 'career-knowledge-graph.json'),
    salary:         path.join(CONFIG.DATA_DIR, 'career-salary-intelligence.json'),
    progression:    path.join(CONFIG.DATA_DIR, 'career-skill-progression.json'),
    roles:          path.join(CONFIG.DATA_DIR, 'roles-expanded.json'),
  });
} catch (err) {
  console.error('[API] Failed to load intelligence engine:', err.message);
  process.exit(1);
}

const ENGINE_STATS = ci.engineStats();
const START_TIME   = Date.now();

// ── In-memory rate limiter ────────────────────────────────────────────────────
// Keyed by IP; automatically pruned each window.

const rateLimitStore = new Map();   // { ip: { count, windowStart } }

function isRateLimited(ip) {
  const now    = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now - record.windowStart > CONFIG.RATE_LIMIT_WINDOW) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return false;
  }

  record.count++;
  if (record.count > CONFIG.RATE_LIMIT_MAX) return true;
  return false;
}

// Prune stale entries every window to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of rateLimitStore) {
    if (now - rec.windowStart > CONFIG.RATE_LIMIT_WINDOW) {
      rateLimitStore.delete(ip);
    }
  }
}, CONFIG.RATE_LIMIT_WINDOW);

// ── Request helpers ───────────────────────────────────────────────────────────

/** Extract the real client IP (supports X-Forwarded-For for reverse proxies) */
function getClientIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  return fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress;
}

/** Parse JSON body from an incoming request */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let body = '';

    req.on('data', (chunk) => {
      body += decoder.write(chunk);
      if (body.length > 1_048_576) { // 1 MB guard
        reject(new Error('Request body too large'));
      }
    });

    req.on('end',   () => {
      body += decoder.end();
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });

    req.on('error', reject);
  });
}

/** Parse query string into a plain object */
function parseQuery(reqUrl) {
  return Object.fromEntries(new url.URL(reqUrl, 'http://localhost').searchParams);
}

/** Send a JSON response */
function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type':                'application/json; charset=utf-8',
    'Content-Length':              Buffer.byteLength(body),
    'X-Powered-By':                'HireEdge Intelligence API',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Cache-Control':               'no-store',
  });
  res.end(body);
}

/** Send a standardised error response */
function sendError(res, code, message, details = null) {
  const body = { error: { code, message } };
  if (details) body.error.details = details;
  sendJSON(res, code, body);
}

/** Require a string query/body parameter; return null and send 400 if missing */
function requireParam(res, value, name) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    sendError(res, 400, `Missing required parameter: "${name}"`,
      `Provide "${name}" as a query string parameter or in the request body.`);
    return null;
  }
  return value.trim();
}

/** Wrap a handler to catch unhandled errors and apply request timeout */
function safeHandle(handler) {
  return async (req, res, params) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        sendError(res, 504, 'Request timed out', 'The intelligence engine took too long to respond.');
      }
    }, CONFIG.REQUEST_TIMEOUT_MS);

    try {
      await handler(req, res, params);
    } catch (err) {
      if (!res.headersSent) {
        console.error('[API] Unhandled error:', err.message);
        sendError(res, 500, 'Internal server error', err.message);
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

// ── Response envelope ─────────────────────────────────────────────────────────

function envelope(data, meta = {}) {
  return {
    success: true,
    data,
    meta: {
      timestamp:    new Date().toISOString(),
      api_version:  '1.0.0',
      ...meta,
    },
  };
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/career-advisor
 *
 * Recommend the top 5 next roles tailored to a user's goals.
 *
 * Body (JSON):
 *   { "role": "data-analyst", "goals": ["salary", "technical"], "limit": 5 }
 *
 * Goals: salary | leadership | technical | stability | remote
 */
const handleCareerAdvisor = safeHandle(async (req, res) => {
  const body = await parseBody(req);

  const role  = requireParam(res, body.role,  'role');
  if (!role) return;

  // goals: accept array or comma-separated string
  let goals = body.goals;
  if (typeof goals === 'string') goals = goals.split(',').map(g => g.trim());
  if (!Array.isArray(goals) || goals.length === 0) {
    return sendError(res, 400,
      'Missing required parameter: "goals"',
      'Provide an array of goals. Valid values: salary, leadership, technical, stability, remote'
    );
  }

  const limit = Math.min(parseInt(body.limit) || 5, 10);
  const result = ci.recommendNextRoles(role, goals, { limit });

  if (result.error) return sendError(res, 404, result.error);
  if (result.valid_goals) {
    return sendError(res, 400, result.error, {
      valid_goals: result.valid_goals,
      descriptions: result.goal_descriptions,
    });
  }

  sendJSON(res, 200, envelope(result, {
    endpoint:    '/api/career-advisor',
    role,
    goals_used:  result.goals,
  }));
});


/**
 * GET /api/role-analysis?role=data-analyst
 *
 * Full career profile: salary band, seniority, similar roles, future roles,
 * skill breakdown, best moves, and AI context.
 */
const handleRoleAnalysis = safeHandle(async (req, res) => {
  const { role } = parseQuery(req.url);

  const resolvedRole = requireParam(res, role, 'role');
  if (!resolvedRole) return;

  const result = ci.analyzeCareer(resolvedRole);
  if (result.error) return sendError(res, 404, result.error);

  sendJSON(res, 200, envelope(result, {
    endpoint: '/api/role-analysis',
    role:     resolvedRole,
  }));
});


/**
 * GET /api/career-path?role=junior-data-analyst&depth=4&limit=5
 *
 * Career paths ranked by salary growth potential. Traces multiple
 * branches through the progression graph and surfaces the highest-earning routes.
 *
 * Query params:
 *   role    (required)
 *   depth   Maximum hops per path (default: 4, max: 6)
 *   limit   Number of paths to return (default: 5, max: 10)
 */
const handleCareerPath = safeHandle(async (req, res) => {
  const { role, depth, limit } = parseQuery(req.url);

  const resolvedRole = requireParam(res, role, 'role');
  if (!resolvedRole) return;

  const maxDepth = Math.min(parseInt(depth) || 4, 6);
  const maxPaths = Math.min(parseInt(limit) || 5, 10);

  const result = ci.findHighGrowthPaths(resolvedRole, { maxDepth, limit: maxPaths });
  if (result.error) return sendError(res, 404, result.error);

  sendJSON(res, 200, envelope(result, {
    endpoint:   '/api/career-path',
    role:       resolvedRole,
    max_depth:  maxDepth,
  }));
});


/**
 * GET /api/skill-gap?from=data-analyst&to=machine-learning-engineer
 *
 * Skill gap analysis between two roles.
 * Returns missing skills, transferable skills, a prioritised learning path,
 * estimated months to bridge the gap, and salary impact.
 *
 * Query params:
 *   from  (required) — current role slug or title
 *   to    (required) — target role slug or title
 */
const handleSkillGap = safeHandle(async (req, res) => {
  const { from, to } = parseQuery(req.url);

  const fromRole = requireParam(res, from, 'from');
  if (!fromRole) return;

  const toRole = requireParam(res, to, 'to');
  if (!toRole) return;

  const result = ci.analyzeSkillGap(fromRole, toRole);
  if (result.error) return sendError(res, 404, result.error);

  sendJSON(res, 200, envelope(result, {
    endpoint:   '/api/skill-gap',
    from_role:  fromRole,
    to_role:    toRole,
  }));
});


/**
 * GET /api/salary-growth?role=data-analyst&sort=salary
 *
 * Salary intelligence for a role: cross-department switches, high-growth
 * paths, and best-value moves (efficiency score).
 *
 * Query params:
 *   role   (required)
 *   sort   Sort cross-dept moves by: "salary" | "efficiency" | "ease" (default: salary)
 *   limit  Max cross-dept moves to return (default: 5, max: 10)
 */
const handleSalaryGrowth = safeHandle(async (req, res) => {
  const { role, sort, limit } = parseQuery(req.url);

  const resolvedRole = requireParam(res, role, 'role');
  if (!resolvedRole) return;

  const sortBy  = ['salary', 'efficiency', 'ease'].includes(sort) ? sort : 'salary';
  const maxItems = Math.min(parseInt(limit) || 5, 10);

  // Run both sub-queries in parallel
  const [switches, paths] = await Promise.all([
    Promise.resolve(ci.findBestCareerSwitch(resolvedRole, { limit: maxItems, sortBy })),
    Promise.resolve(ci.findHighGrowthPaths(resolvedRole,  { maxDepth: 3, limit: 3 })),
  ]);

  if (switches.error) return sendError(res, 404, switches.error);

  // Also pull the direct salary analysis from analyzeCareer
  const profile  = ci.analyzeCareer(resolvedRole);
  const bestMoves = profile.best_moves || null;

  sendJSON(res, 200, envelope({
    role:               switches.role,
    title:              switches.title,
    category:           switches.category,
    current_salary:     switches.current_salary,
    best_moves:         bestMoves,
    cross_dept_switches:{
      total:    switches.total_cross_dept,
      sorted_by:sortBy,
      items:    switches.switches,
    },
    growth_paths: {
      paths_found: paths.paths_found,
      top_paths:   paths.top_paths,
    },
  }, {
    endpoint:   '/api/salary-growth',
    role:       resolvedRole,
    sort_by:    sortBy,
  }));
});


/**
 * GET /api/role-compare?role_a=data-analyst&role_b=data-scientist
 *
 * Head-to-head comparison of two roles across salary, skills,
 * growth potential, career mobility, and transition difficulty.
 *
 * Query params:
 *   role_a  (required)
 *   role_b  (required)
 */
const handleRoleCompare = safeHandle(async (req, res) => {
  const { role_a, role_b } = parseQuery(req.url);

  const roleA = requireParam(res, role_a, 'role_a');
  if (!roleA) return;

  const roleB = requireParam(res, role_b, 'role_b');
  if (!roleB) return;

  const result = ci.compareRoles(roleA, roleB);
  if (result.error) return sendError(res, 404, result.error);

  sendJSON(res, 200, envelope(result, {
    endpoint: '/api/role-compare',
    role_a:   roleA,
    role_b:   roleB,
  }));
});


/**
 * GET /api/goals
 *
 * Returns all valid goal keys and their descriptions.
 * Use this to populate goal-selector UIs.
 */
const handleGoals = safeHandle(async (req, res) => {
  const goals = ci.listGoals();
  sendJSON(res, 200, envelope({
    goals: Object.entries(goals).map(([key, description]) => ({ key, description })),
    usage: 'Pass goal keys in the "goals" array when calling POST /api/career-advisor',
  }, { endpoint: '/api/goals' }));
});


/**
 * GET /health
 *
 * Health check + engine stats. Returns 200 when ready, 503 if not loaded.
 */
const handleHealth = safeHandle(async (req, res) => {
  const uptime = Math.floor((Date.now() - START_TIME) / 1000);
  sendJSON(res, 200, {
    status:  'ok',
    uptime_seconds: uptime,
    engine:  ENGINE_STATS,
    config: {
      port:             CONFIG.PORT,
      rate_limit_max:   CONFIG.RATE_LIMIT_MAX,
      rate_limit_window_ms: CONFIG.RATE_LIMIT_WINDOW,
    },
  });
});

// ── Router ────────────────────────────────────────────────────────────────────

const ROUTES = new Map([
  // Method:Path → handler
  ['POST:/api/career-advisor', handleCareerAdvisor],
  ['GET:/api/role-analysis',   handleRoleAnalysis],
  ['GET:/api/career-path',     handleCareerPath],
  ['GET:/api/skill-gap',       handleSkillGap],
  ['GET:/api/salary-growth',   handleSalaryGrowth],
  ['GET:/api/role-compare',    handleRoleCompare],
  ['GET:/api/goals',           handleGoals],
  ['GET:/health',              handleHealth],
]);

// ── Request logger ────────────────────────────────────────────────────────────

function logRequest(method, pathname, statusCode, durationMs, ip) {
  const ts   = new Date().toISOString();
  const code = statusCode >= 500 ? `\x1b[31m${statusCode}\x1b[0m`  // red
             : statusCode >= 400 ? `\x1b[33m${statusCode}\x1b[0m`  // yellow
             :                     `\x1b[32m${statusCode}\x1b[0m`; // green
  console.log(`[${ts}] ${ip} ${method} ${pathname} ${code} ${durationMs}ms`);
}

// ── Main server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const startMs  = Date.now();
  const clientIP = getClientIP(req);
  const parsed   = new url.URL(req.url, `http://localhost`);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/'; // strip trailing slash
  const method   = req.method.toUpperCase();

  // ── CORS preflight ──
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age':       '86400',
    });
    res.end();
    return;
  }

  // ── Rate limiting ──
  if (isRateLimited(clientIP)) {
    sendError(res, 429, 'Too many requests',
      `Limit: ${CONFIG.RATE_LIMIT_MAX} requests per ${CONFIG.RATE_LIMIT_WINDOW / 1000}s`);
    logRequest(method, pathname, 429, Date.now() - startMs, clientIP);
    return;
  }

  // ── Routing ──
  const routeKey    = `${method}:${pathname}`;
  const handler     = ROUTES.get(routeKey);

  // Wrap res.end to capture status for logging
  const originalEnd = res.end.bind(res);
  res.end = (...args) => {
    logRequest(method, pathname, res.statusCode, Date.now() - startMs, clientIP);
    return originalEnd(...args);
  };

  if (!handler) {
    // Method not allowed vs not found
    const pathExists = [...ROUTES.keys()].some((k) => k.endsWith(`:${pathname}`));
    if (pathExists) {
      sendError(res, 405, 'Method not allowed',
        `${pathname} does not accept ${method} requests.`);
    } else {
      sendError(res, 404, 'Endpoint not found', {
        available_endpoints: [...new Set([...ROUTES.keys()].map((k) => {
          const [m, p] = k.split(':');
          return `${m} ${p}`;
        }))],
      });
    }
    return;
  }

  handler(req, res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[API] Port ${CONFIG.PORT} is already in use. Set a different PORT.`);
  } else {
    console.error('[API] Server error:', err.message);
  }
  process.exit(1);
});

server.listen(CONFIG.PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          HireEdge Career Intelligence API            ║
╠══════════════════════════════════════════════════════╣
║  Status   : Running                                  ║
║  Port     : ${String(CONFIG.PORT).padEnd(38)}║
║  Roles    : ${String(ENGINE_STATS.total_roles).padEnd(38)}║
║  Skills   : ${String(ENGINE_STATS.roles_with_salary + ' roles with salary data').padEnd(38)}║
╠══════════════════════════════════════════════════════╣
║  POST  /api/career-advisor   goal-weighted recs      ║
║  GET   /api/role-analysis    full career profile     ║
║  GET   /api/career-path      growth path finder      ║
║  GET   /api/skill-gap        skill gap analysis      ║
║  GET   /api/salary-growth    salary intelligence     ║
║  GET   /api/role-compare     role comparison         ║
║  GET   /api/goals            list valid goals        ║
║  GET   /health               health + engine stats   ║
╚══════════════════════════════════════════════════════╝`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[API] Received ${signal} — shutting down gracefully...`);
  server.close(() => {
    console.log('[API] Server closed. Goodbye.');
    process.exit(0);
  });
  // Force exit after 5s if connections linger
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = server; // allows programmatic use / testing
