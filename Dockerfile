FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

# Install all deps (including devDeps) needed for the build
# NODE_ENV must NOT be set to production here or npm will skip devDeps
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build && ./node_modules/.bin/prisma generate

# Set production env only at runtime, after build is complete
ENV NODE_ENV=production

CMD ["/bin/sh", "-c", "echo '=== NODE VERSION ===' && node --version && echo '=== FREE MEMORY ===' && free -m && ./node_modules/.bin/prisma migrate deploy && echo '=== MIGRATE DONE, LOADING SERVER MODULE ===' && node -e 'import(\"./build/server/index.js\").then(() => console.log(\"MODULE LOADED OK\")).catch(e => { console.error(\"MODULE LOAD FAILED:\", e.message, e.stack); process.exit(1); })' && echo '=== STARTING SERVER ===' && node ./node_modules/.bin/react-router-serve ./build/server/index.js"]
