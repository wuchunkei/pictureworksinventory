# Inventory Borrowing API — container image for Render / any Docker host.
# Debian-slim Node base so we can apt-install qpdf, which the ACF export shells
# out to (src/acfGenerator.js → spawn("qpdf", ...)) for PDF owner-password
# encryption. The plain Node runtime can't install qpdf, hence Docker.
FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends qpdf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --omit=dev

# App source.
COPY . .

# Render injects PORT; the server reads API_PORT || PORT.
ENV NODE_ENV=production
EXPOSE 10000

CMD ["node", "src/server.js"]
