# nginx and the import service in one image. Paths mirror the VM install in docs/install.md.
# See docs/docker.md for running it.
FROM node:22-alpine

RUN apk add --no-cache nginx tini su-exec \
 && rm -f /etc/nginx/http.d/default.conf \
 && mkdir -p /run/nginx \
 && ln -sf /dev/stdout /var/log/nginx/access.log \
 && ln -sf /dev/stderr /var/log/nginx/error.log

# Service code and its two dependencies
WORKDIR /opt/nammet-api
COPY opt/nammet-api/package.json opt/nammet-api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY opt/nammet-api/ ./
RUN rm -f dev-*.json

# The site, plus the example recipe and its photo. A named volume is filled from these
# the first time it's used, so a new site shows the example.
COPY var/www/nammet/index.html var/www/nammet/app.js var/www/nammet/style.css var/www/nammet/robots.txt /var/www/nammet/
COPY var/www/nammet/recipes/example-recipe.json /var/www/nammet/recipes/
COPY var/www/nammet/photos/example-recipe.jpg /var/www/nammet/photos/
RUN install -d -m 0755 -o node -g node /var/www/nammet/theme \
 && install -d -m 0700 -o node -g node /var/lib/nammet \
 && chown node:node /var/www/nammet/recipes /var/www/nammet/photos

# The unchanged server block, rendered into /etc/nginx/http.d/ by the entrypoint
COPY etc/nginx/conf.d/nginx-nammet.conf /etc/nginx/nammet.conf.template
COPY docker/entrypoint.sh /usr/local/bin/nammet-entrypoint
COPY docker/add-user /usr/local/bin/add-user
RUN chmod 0755 /usr/local/bin/nammet-entrypoint /usr/local/bin/add-user

# The same settings as etc/nammet/api.env.example
ENV RECIPES_DIR=/var/www/nammet/recipes \
    PHOTOS_DIR=/var/www/nammet/photos \
    USERS_FILE=/var/lib/nammet/users.json \
    SETTINGS_FILE=/var/lib/nammet/settings.json \
    THEME_DIR=/var/www/nammet/theme \
    HOST=127.0.0.1 \
    PORT=3000 \
    COOKIE_SECURE=true

# theme/ needs no volume: the service rewrites it from settings.json at startup
VOLUME ["/var/www/nammet/recipes", "/var/www/nammet/photos", "/var/lib/nammet"]
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1/api/me >/dev/null || exit 1

WORKDIR /
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/nammet-entrypoint"]
