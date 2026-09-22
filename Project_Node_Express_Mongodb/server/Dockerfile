# ============================================================
# 🧠 CONCEPT: A MULTI-STAGE Dockerfile
# WHY IT MATTERS (interview angle): a classic "how do you optimise a
#   container image?" question. A naive Node image is 1.2GB+; this one is
#   ~180MB. Size matters because it is deploy speed, registry cost, cold
#   start time, and attack surface — every package in the image is
#   something that can have a CVE.
#
#   THE TECHNIQUES, in order of impact:
#   1. MULTI-STAGE BUILD — compile in a fat stage, copy only the artifacts
#      into a slim final stage. Build tools (gcc, python, dev headers)
#      never reach production.
#   2. ALPINE (or distroless) base — ~50MB vs ~400MB for the Debian image.
#   3. `npm ci --omit=dev` — no dev dependencies (jest, nodemon) in prod.
#   4. LAYER CACHING — copy package.json BEFORE the source (see below).
#   5. .dockerignore — keep node_modules and .git out of the build context.
# ============================================================

# ------------------------------------------------------------------
# STAGE 1: dependencies
# ------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# ============================================================
# 🧠 CONCEPT: ⭐ LAYER CACHING — copy the manifest before the source
# WHY IT MATTERS (interview angle): the highest-value Dockerfile trick.
#   Docker caches each instruction as a layer and invalidates every layer
#   AFTER the first changed one.
#   ❌ If you `COPY . .` and then `npm ci`, ANY source change — a typo fix
#      in a comment — invalidates the copy layer, so npm ci re-runs and
#      re-downloads every dependency. Two minutes per build.
#   ✅ Copying ONLY package*.json first means the expensive npm ci layer
#      is reused unless the DEPENDENCIES actually changed. Source edits
#      then rebuild in seconds.
#   This one reordering is often the difference between a 2-minute and a
#   10-second rebuild.
# ============================================================
COPY package*.json ./

# ============================================================
# 🧠 CONCEPT: npm ci vs npm install
# WHY IT MATTERS (interview angle):
#   • npm install  — may UPDATE package-lock.json to satisfy ranges in
#     package.json. So two builds a week apart can install different
#     versions. Non-deterministic, which is the opposite of what an image
#     is for.
#   • npm ci       — installs EXACTLY what the lockfile says, errors if
#     package.json and the lock disagree, and deletes node_modules first.
#     Deterministic and faster. ⭐ Always npm ci in CI and in Docker.
# ============================================================
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------------
# STAGE 2: development
# ------------------------------------------------------------------
# ============================================================
# 🧠 CONCEPT: BUILD TARGETS — one Dockerfile, several images
# WHY IT MATTERS (interview angle): `docker build --target dev` stops at a
#   named stage. That lets ONE Dockerfile produce both a fat development
#   image (dev dependencies, nodemon, source bind-mounted for live reload)
#   and a slim production one — with no duplicated Dockerfile to drift out
#   of sync.
#   ⚠️ And note WHY a separate stage is necessary: the runtime stage below
#   installs with `--omit=dev`, so nodemon is NOT in it. docker-compose
#   targets THIS stage precisely so `npm run dev` works. Pointing compose
#   at the production image and then trying to run nodemon is a mistake
#   that fails with a confusing "nodemon: not found".
# ============================================================
FROM node:20-alpine AS dev

RUN apk add --no-cache dumb-init
WORKDIR /app

COPY package*.json ./
# All dependencies this time, including jest and nodemon.
RUN npm ci

COPY . .
RUN mkdir -p /app/uploads

ENV NODE_ENV=development
EXPOSE 5000
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "dev"]

# ------------------------------------------------------------------
# STAGE 3: production runtime
# ------------------------------------------------------------------
FROM node:20-alpine AS runtime

# ============================================================
# 🧠 CONCEPT: dumb-init as PID 1 — proper signal handling
# WHY IT MATTERS (interview angle): a subtle but real production issue.
#   A process running as PID 1 in a container does NOT get the default
#   signal handlers, and it must reap zombie child processes. The practical
#   symptom: your SIGTERM handler never fires, so graceful shutdown never
#   happens, and Docker waits the full 10s timeout before SIGKILL on every
#   single deploy — killing in-flight requests each time.
#   dumb-init (or `docker run --init`) sits at PID 1 and forwards signals
#   correctly, which is what makes the SIGTERM draining in
#   middleware/errorHandler.js actually work.
# ============================================================
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production

WORKDIR /app

# ============================================================
# 🧠 CONCEPT: Run as a NON-ROOT user
# WHY IT MATTERS (interview angle): containers run as root BY DEFAULT.
#   If an attacker achieves RCE in your app, they are root inside the
#   container — and a container escape (a kernel CVE, a careless
#   privileged mount) then means root on the HOST. Dropping privileges
#   costs nothing and is a standard audit requirement.
#   The `node` image conveniently ships a `node` user (uid 1000) already.
# ============================================================
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# Create the uploads directory with the right ownership BEFORE dropping
# privileges — the non-root user cannot mkdir in a root-owned WORKDIR.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node

EXPOSE 5000

# ============================================================
# 🧠 CONCEPT: A container HEALTHCHECK
# WHY IT MATTERS (interview angle): lets the orchestrator know the
#   difference between "the process is running" and "the app works". A
#   Node process can be alive with a completely wedged event loop.
#   ⚠️ Point it at the LIVENESS endpoint, not readiness — see the
#   liveness-vs-readiness block in routes/index.js. A healthcheck that
#   pings the database will restart every container during a brief DB
#   blip, turning a hiccup into an outage.
# ============================================================
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# ============================================================
# 🧠 CONCEPT: ENTRYPOINT + CMD, and exec vs shell form
# WHY IT MATTERS (interview angle): use the EXEC form (a JSON array), not
#   the shell form (`CMD node server.js`). The shell form wraps your
#   process in `/bin/sh -c`, so the SHELL becomes PID 1 and does not
#   forward SIGTERM to node — breaking graceful shutdown again. The exec
#   form makes node the direct child of dumb-init.
# ============================================================
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
