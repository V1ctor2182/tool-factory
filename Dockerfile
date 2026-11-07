FROM node:24-slim
ENV TOOL_FACTORY_HOME=/data
WORKDIR /app
COPY factory/dashboard/hosted.mjs factory/dashboard/http.mjs factory/dashboard/flows.html factory/dashboard/index.html factory/dashboard/
COPY factory/lib/hosted-store.mjs factory/lib/public-flows.mjs factory/lib/loops.json factory/lib/home.mjs factory/lib/
RUN mkdir -p /data && chown node:node /data
# Railway mounts a volume over /data as root at run time, after any build-time chown. So the container starts
# as root only to hand /data to the node user, then the server runs unprivileged.
CMD ["sh", "-c", "chown -R node:node /data && exec setpriv --reuid=node --regid=node --init-groups node factory/dashboard/hosted.mjs"]
