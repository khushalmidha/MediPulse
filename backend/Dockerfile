FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# CPU ONNX binaries are bundled; use system FFmpeg rather than install-time downloads.
RUN npm ci --omit=dev --ignore-scripts
ENV REELS_FFMPEG_PATH=/usr/bin/ffmpeg REELS_FFPROBE_PATH=/usr/bin/ffprobe

COPY . .

RUN mkdir -p /var/lib/medipulse/reels /var/lib/medipulse/models \
    && chown -R node:node /var/lib/medipulse
USER node

EXPOSE 8080

CMD ["npm", "start"]
