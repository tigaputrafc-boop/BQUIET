FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade yt-dlp \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/yt-dlp/bin:${PATH}" \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000
WORKDIR /app
COPY --chown=node:node server.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p /app/storage /app/data && chown -R node:node /app
USER node
EXPOSE 10000
CMD ["node", "server.mjs"]
