const http = require('http');
const { webtalk } = require('./middleware');

const PORT = process.env.PORT || 8080;

// Minimal express-like app for standalone use (no express dependency)
function createApp() {
  const routes = { GET: [], USE: [] };

  function app(req, res) {
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    res.status = (code) => { res.statusCode = code; return res; };
    res.sendFile = (filePath) => {
      const fs = require('fs');
      const path = require('path');
      const ext = path.extname(filePath).toLowerCase();
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      require('fs').createReadStream(filePath).pipe(res);
    };

    const url = require('url');
    const parsed = url.parse(req.url);
    req.path = parsed.pathname;

    let idx = 0;
    const allHandlers = [];

    // Collect USE middleware
    for (const { prefix, handler } of routes.USE) {
      allHandlers.push({ prefix, handler });
    }

    // Collect GET routes
    if (req.method === 'GET') {
      for (const { path: p, handler } of routes.GET) {
        allHandlers.push({ exactPath: p, handler });
      }
    }

    // OPTIONS handling
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    function next() {
      if (idx >= allHandlers.length) {
        // Default: serve app.html at root
        if (req.path === '/' || req.path === '') {
          const path = require('path');
          res.sendFile(path.join(__dirname, 'app.html'));
          return;
        }
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      const h = allHandlers[idx++];
      if (h.exactPath) {
        if (req.path === h.exactPath) {
          h.handler(req, res, next);
        } else {
          next();
        }
      } else if (h.prefix) {
        if (req.path.startsWith(h.prefix)) {
          const originalPath = req.path;
          req.path = req.path.slice(h.prefix.length) || '/';
          req.url = req.path;
          h.handler(req, res, () => {
            req.path = originalPath;
            req.url = originalPath;
            next();
          });
        } else {
          next();
        }
      } else {
        h.handler(req, res, next);
      }
    }

    next();
  }

  app.get = (p, handler) => routes.GET.push({ path: p, handler });
  app.use = (prefixOrHandler, handler) => {
    if (typeof prefixOrHandler === 'function') {
      routes.USE.push({ prefix: null, handler: prefixOrHandler });
    } else {
      routes.USE.push({ prefix: prefixOrHandler, handler });
    }
  };

  return app;
}

const app = createApp();
const { init } = webtalk(app);

const server = http.createServer(app);

async function startServer() {
  await init();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n=================================`);
    console.log(`Webtalk running at http://localhost:${PORT}`);
    console.log(`  - Whisper STT (Speech-to-Text)`);
    console.log(`  - Pocket TTS (Text-to-Speech)`);
    console.log(`  - SDK: http://localhost:${PORT}/webtalk/sdk.js`);
    console.log(`  - Demo: http://localhost:${PORT}/webtalk/demo`);
    console.log(`\nPress Ctrl+C to stop`);
    console.log(`=================================\n`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('\nShutting down');
  server.close(() => process.exit(0));
});
