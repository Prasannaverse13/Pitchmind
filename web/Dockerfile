# Build context: the web folder.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# The browser talks straight to the API. This value is baked in at build time.
ARG NEXT_PUBLIC_API=""
ENV NEXT_PUBLIC_API=$NEXT_PUBLIC_API
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app .
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
