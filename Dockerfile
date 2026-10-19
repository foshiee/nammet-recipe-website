# nginx and the import service in one image. Paths mirror the VM install in docs/install.md.
# See docs/docker.md for running it.
FROM node:22-alpine

RUN apk add --no-cache nginx tini su-exec \
 && rm -f /etc/nginx/http.d/default.conf \
 && mkdir -p /run/nginx \
 && ln -sf /dev/stdout /var/log/nginx/access.log \
 && ln -sf /dev/stderr /var/log/nginx/error.log

# Service code and its two dependencies
WORKDIR /opt/nomnoms-api
COPY opt/nomnoms-api/package.json opt/nomnoms-api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY opt/nomnoms-api/ ./
RUN rm -f dev-*.json

# The site, plus the example recipe and its photo. A named volume is filled from these
# the first time it's used, so a new site shows the example.
COPY var/www/nomnoms/index.html var/www/nomnoms/app.js var/www/nomnoms/style.css var/www/nomnoms/robots.txt /var/www/nomnoms/
COPY var/www/nomnoms/recipes/example-recipe.json /var/www/nomnoms/recipes/
COPY var/www/nomnoms/photos/example-recipe.jpg /var/www/nomnoms/photos/
RUN install -d -m 0755 -o node -g node /var/www/nomnoms/theme \
 && install -d -m 0700 -o node -g node /var/lib/nomnoms \
 && chown node:node /var/www/nomnoms/recipes /var/www/nomnoms/photos

# The unchanged server block, rendered into /etc/nginx/http.d/ by the entrypoint
COPY etc/nginx/conf.d/nginx-nomnoms.conf /etc/nginx/nomnoms.conf.template
COPY docker/entrypoint.sh /usr/local/bin/nomnoms-entrypoint
COPY docker/add-user /usr/local/bin/add-user
RUN chmod 0755 /usr/local/bin/nomnoms-entrypoint /usr/local/bin/add-user

# The same settings as etc/nomnoms/api.env.example
ENV RECIPES_DIR=/var/www/nomnoms/recipes \
    PHOTOS_DIR=/var/www/nomnoms/photos \
    USERS_FILE=/var/lib/nomnoms/users.json \
    SETTINGS_FILE=/var/lib/nomnoms/settings.json \
    THEME_DIR=/var/www/nomnoms/theme \
    HOST=127.0.0.1 \
    PORT=3000 \
    COOKIE_SECURE=true

# theme/ needs no volume: the service rewrites it from settings.json at startup
VOLUME ["/var/www/nomnoms/recipes", "/var/www/nomnoms/photos", "/var/lib/nomnoms"]
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1/api/me >/dev/null || exit 1

WORKDIR /
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/nomnoms-entrypoint"]
