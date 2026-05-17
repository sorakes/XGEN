FROM node:20-bullseye

# Instala dependências do SO: Redis, Supervisor e ferramentas do Chromium (para PDF)
RUN apt-get update && apt-get install -y \
    redis-server \
    supervisor \
    chromium \
    fonts-liberation \
    libasound2 \
    libnss3 \
    libxss1 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

# Força o Puppeteer a usar o Chromium seguro do nível do sistema Operacional
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copia manifestos primeiro (Otimização do cache do Docker)
COPY package*.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Instala todas as dependências do Monorepo
RUN npm install

# Copia todo o código fonte
COPY . .

# Inicializa o Prisma SQLite e Compila TypeScript + Next.js
RUN cd apps/api && npx prisma generate && npx prisma db push
RUN npm run build

# Copia e injeta o cérebro orquestrador
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Painel Web (3000) | API/MCP HTTP (3001)
EXPOSE 3000 3001

# Container boot process
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
