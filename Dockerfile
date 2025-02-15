FROM node:20-alpine@sha256:ba8312129a193a1f1a781d93afcf6e641956d6e48e3ddefa9b64cd86790ee64c as base
RUN apk add --no-cache libc6-compat curl

WORKDIR /app

# Rebuild the source code only when needed
FROM base AS builder

# install deps
COPY yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN yarn fetch --immutable

# build
COPY . .
RUN yarn build

# Production image, copy all the files
FROM base AS runner

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 nextjs

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/dist /app/dist
COPY entrypoint.sh .

USER 1001
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

ENTRYPOINT ["./entrypoint.sh"]
