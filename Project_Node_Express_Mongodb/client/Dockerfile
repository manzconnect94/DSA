# ============================================================
# 🧠 CONCEPT: Building a FRONTEND container — fundamentally different
# WHY IT MATTERS (interview angle): a common interview trap. People
#   containerise a React app the same way they containerise an API, and it
#   is wrong.
#
#   ⭐ A React SPA COMPILES TO STATIC FILES. `vite build` produces HTML,
#   JS and CSS. Those need a WEB SERVER, not a Node runtime. Shipping a
#   Node process to serve static files means:
#     • ~180MB image instead of ~25MB (nginx:alpine),
#     • Node's single thread serving bytes instead of nginx's optimised
#       sendfile path,
#     • a much larger attack surface for zero benefit.
#
#   So: build WITH Node (stage 1), serve WITH nginx (stage 3). The Node
#   toolchain never reaches the final image.
#
#   ⭐ AND THE BIGGEST POINT: in most real deployments you do not
#   containerise the frontend at all. You upload dist/ to S3 + CloudFront,
#   or Vercel/Netlify/Cloudflare Pages. A CDN serves static assets from an
#   edge location near the user — faster and cheaper than any container
#   you can run. Containerising the frontend makes sense when you need it
#   colocated with the API behind one ingress, or in an air-gapped
#   environment. Knowing when NOT to use a container is the better answer.
# ============================================================

# ------------------------------------------------------------------
# STAGE 1: development (what docker-compose uses)
# ------------------------------------------------------------------
FROM node:20-alpine AS dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5173

# --host 0.0.0.0 is REQUIRED in a container. Vite binds to localhost by
# default, which is only reachable from inside the container's own network
# namespace — so the port mapping appears to do nothing. A very common
# "why can't I reach my dev server?" moment.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ------------------------------------------------------------------
# STAGE 2: build the static bundle
# ------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# ============================================================
# 🧠 CONCEPT: Frontend env vars are BAKED IN AT BUILD TIME
# WHY IT MATTERS (interview angle): a genuinely important difference from
#   the backend. The API reads process.env AT RUNTIME, so one image works
#   in every environment. A Vite/CRA build SUBSTITUTES import.meta.env
#   values INTO THE BUNDLE at build time — so the same image cannot serve
#   staging and production with different API URLs. You either build once
#   per environment, or load config at runtime from a /config.json the
#   container serves.
#   ⚠️ THE SECURITY COROLLARY: NEVER put a secret in a VITE_ variable. It
#   is compiled into JavaScript that every visitor downloads. "But it's an
#   env var" has leaked a lot of API keys.
# ============================================================
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ------------------------------------------------------------------
# STAGE 3: serve with nginx (~25MB total)
# ------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Only the compiled assets are copied. No Node, no npm, no node_modules.
COPY --from=build /app/dist /usr/share/nginx/html

# ============================================================
# 🧠 CONCEPT: try_files — the SPA routing requirement
# WHY IT MATTERS (interview angle): a classic deployment bug that only
#   appears AFTER you deploy. React Router handles /tasks entirely in the
#   browser, so navigating there via a link works perfectly. But if the
#   user REFRESHES on /tasks, the browser asks the SERVER for /tasks —
#   and there is no such file on disk. nginx returns 404.
#   THE FIX: `try_files $uri $uri/ /index.html` — serve the real file if it
#   exists, otherwise fall back to index.html and let React Router read
#   the URL. Every SPA needs this rewrite, in nginx, CloudFront, or
#   whatever fronts it.
#   Note the /api proxy too: it keeps the frontend and API on the SAME
#   ORIGIN in production, so there is no CORS and no cross-origin cookie
#   problem — mirroring what the Vite dev proxy does locally.
# ============================================================
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  server_name _;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '' \
  '  # Hashed asset filenames are immutable — cache them hard.' \
  '  location /assets/ {' \
  '    expires 1y;' \
  '    add_header Cache-Control "public, immutable";' \
  '  }' \
  '' \
  '  # index.html must NEVER be cached, or users keep loading an old' \
  '  # bundle that references deleted asset hashes.' \
  '  location = /index.html {' \
  '    add_header Cache-Control "no-cache, no-store, must-revalidate";' \
  '  }' \
  '' \
  '  # Same-origin API proxy: no CORS needed in production.' \
  '  location /api/ {' \
  '    proxy_pass http://api:5000;' \
  '    proxy_set_header Host $host;' \
  '    proxy_set_header X-Real-IP $remote_addr;' \
  '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
  '    proxy_set_header X-Forwarded-Proto $scheme;' \
  '  }' \
  '' \
  '  # ⭐ The SPA fallback. Without this, refreshing on /tasks gives a 404.' \
  '  location / {' \
  '    try_files $uri $uri/ /index.html;' \
  '  }' \
  '}' \
  > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
