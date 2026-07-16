FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
# Next's file tracer doesn't follow drizzle-orm's dynamic driver resolution
# (drizzle-orm/node-postgres), so it's dropped from the standalone bundle.
# pg is traced correctly and doesn't need this. Copy drizzle-orm explicitly.
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY scripts/migrate.mjs ./scripts/migrate.mjs
COPY docker/entrypoint.sh ./entrypoint.sh
EXPOSE 3000
CMD ["sh", "./entrypoint.sh"]
