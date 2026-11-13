"use strict";
// Minimal static server for browser tests. Serves the app folder without caching.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const port = Number(process.env.PORT) || 4173;
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

http
  .createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.normalize(path.join(root, pathname === "/" ? "index.html" : pathname));
    if (!file.startsWith(root + path.sep) || file.includes(`${path.sep}node_modules${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, {
          "content-type": types[path.extname(file)] || "application/octet-stream",
          "cache-control": "no-store",
        })
        .end(data);
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`Serving ${root} on http://127.0.0.1:${port}`));
