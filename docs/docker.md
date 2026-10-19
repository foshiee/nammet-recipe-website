# Running the site with Docker

The image `ghcr.io/foshiee/nomnoms-recipe-website` holds the whole site: nginx, the static front end and the import service, set up the same way as the VM install in [install.md](install.md). It runs on amd64 and arm64.

Like the VM install, it serves plain HTTP and expects an HTTPS reverse proxy, such as Traefik, in front of it. Signing in only works over HTTPS.

## Quick start

With Docker Compose, copy [docker-compose.yml](../docker-compose.yml) from the repo into an empty folder, then:

```sh
docker compose up -d
docker compose exec nomnoms add-user yourname --role admin
```

Or with plain `docker run`:

```sh
docker run -d --name nomnoms --restart unless-stopped -p 8080:80 \
  -v nomnoms-recipes:/var/www/nomnoms/recipes \
  -v nomnoms-photos:/var/www/nomnoms/photos \
  -v nomnoms-data:/var/lib/nomnoms \
  ghcr.io/foshiee/nomnoms-recipe-website:latest
docker exec -it nomnoms add-user yourname --role admin
```

`add-user` asks for a password of at least 12 characters, with a lowercase letter, an uppercase letter, a number and a symbol. It's temporary: you'll choose your own the first time you sign in. Add `--permanent` to skip that. Everyone else can be added from the admin page.

The site is now on port 8080. Point your reverse proxy at it, then work through the [security checklist](install.md#security-checklist-traefik-in-front); the parts about the real-IP lines are handled by `REAL_IP_FROM` below.

## Trying it locally

Over plain `http://localhost:8080` the browser won't keep the session cookie, so signing in fails. For a local trial only, turn the secure cookie off:

```sh
docker run -d --name nomnoms-test -p 8080:80 -e COOKIE_SECURE=false ghcr.io/foshiee/nomnoms-recipe-website:latest
docker exec -it nomnoms-test add-user tester --role admin --permanent
```

Never use `COOKIE_SECURE=false` on a site other people can reach.

## Volumes and backups

| Path in the container | Holds |
|---|---|
| `/var/www/nomnoms/recipes` | The recipe files |
| `/var/www/nomnoms/photos` | The recipe photos |
| `/var/lib/nomnoms` | `users.json` and `settings.json` (the admin page's settings, including an API key saved there) |

A new named volume starts with the example recipe. A bind-mounted host folder starts as it is, so you can point the recipes volume at a folder of recipes you already have:

```sh
-v /srv/recipes:/var/www/nomnoms/recipes
```

The container makes each of the three folders writable by the service (user `node`, uid 1000) when it starts. Files already inside keep their owners, and nginx needs to be able to read them (`chmod 644`).

The site's look (`theme/`) needs no volume: the service writes it from `settings.json` each time it starts.

To back up, copy the three volumes. For example, for named volumes:

```sh
docker run --rm -v nomnoms-recipes:/r -v nomnoms-photos:/p -v nomnoms-data:/d -v "$PWD":/backup alpine \
  tar czf /backup/nomnoms-backup.tar.gz /r /p /d
```

## Settings

Set these with `-e` or under `environment:` in the compose file.

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | Needed only for PDF, photo and text imports. You can add it on the admin page instead, which takes priority. |
| `MODEL`, `EFFORT` | `claude-sonnet-5-5`, `medium` | Also settable on the admin page. See [what imports cost](install.md#cost-of-claude-imports). |
| `REAL_IP_FROM` | empty | The reverse proxy's addresses or CIDR ranges, comma-separated. See below. |
| `COOKIE_SECURE` | `true` | Keep it on. Turn it off only for a local trial. |
| `SESSION_HOURS` | `168` | How long a sign-in lasts. |
| `MAX_UPLOAD_MB`, `MAX_FETCH_MB` | `20`, `5` | Size limits for uploads and fetched web pages. |

The other variables in [api.env.example](../etc/nomnoms/api.env.example) are set by the image and shouldn't need changing.

## Behind a reverse proxy

Docker's published port hides the visitor's address: nginx in the container sees every request coming from the proxy, or from Docker's gateway. The login rate limit and the recipe rate limit then count all visitors as one, so a few wrong passwords from anyone lock everyone out for 15 minutes.

Set `REAL_IP_FROM` to the address the proxy's requests arrive from, so nginx trusts the `X-Forwarded-For` header it sends, and only from there:

- **Traefik in Docker on the same host**, on a shared network: that network's subnet, such as `172.18.0.0/16` (`docker network inspect <network>` shows it).
- **Traefik on the host or another machine**, through the published port: Docker's gateway for this container's network, usually `172.17.0.1` or `172.18.0.1`. Often the subnet is simpler.

To check, run `docker logs -f nomnoms` while loading the site. With `REAL_IP_FROM` right, the first column shows your own address rather than the proxy's.

**Behind Cloudflare** as well, add Cloudflare's ranges (from [cloudflare.com/ips](https://www.cloudflare.com/ips/)) to `REAL_IP_FROM`, separated by commas.

Don't publish the container's port anywhere but to the proxy. Docker's published ports go around host firewalls such as firewalld and ufw, so publish it on an address only the proxy can reach (for example `-p 127.0.0.1:8080:80` when the proxy runs on the host), or leave out `-p` and put the container on the proxy's Docker network.

## Updating

```sh
docker compose pull && docker compose up -d
```

Or, with `docker run`, pull the image, remove the container and run it again with the same volumes. The recipes, photos, users and settings live in the volumes, so they're kept. Restarting signs everyone out, because sessions are kept in memory.

## Logs and user changes

- `docker logs -f nomnoms` shows nginx's access and error logs and the service's log together. Each import logs who imported what.
- `docker exec -it nomnoms add-user <name> [--role admin|importer] [--permanent]` adds a user or resets a password, `--remove` removes one and `--list` lists them. Changes reach sessions that are already open only after they expire or the container restarts.

## Building it yourself

```sh
git clone https://github.com/foshiee/nomnoms-recipe-website.git
cd nomnoms-recipe-website
docker build -t nomnoms .
```

In the compose file, swap `image:` for `build: .`.

## Releasing

Pushing a tag such as `v1.2.0` runs the tests, then builds the image for amd64 and arm64 and publishes it as `1.2.0`, `1.2`, `1` and `latest`. The workflow is `.github/workflows/docker.yml`. GitHub makes a new package private, so after the first release, set its visibility to public in the package's settings.
