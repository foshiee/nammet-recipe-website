# Security

## Reporting a vulnerability

Please don't open a public issue for a security problem. Report it privately through GitHub instead: on the repo's **Security** tab, choose **Report a vulnerability**, or go straight to [the private report form](https://github.com/foshiee/nammet-recipe-website/security/advisories/new). Only the maintainer can see it.

A useful report says:

- what the problem is and what an attacker could do with it;
- the steps to reproduce it, against a local copy (see "Trying it locally" in [docs/install.md](docs/install.md));
- the commit you tested.

This is a one-person hobby project, so replies are best effort and there's no bug bounty. Once a fix is out, the advisory is published, with credit to you if you'd like it.

## Supported versions

Only the latest commit on `master` and the latest published Docker image are supported. Fixes go straight to `master`, and a new image follows.

## In scope

- The import service (`opt/nammet-api`): sign-in, sessions, roles and the rate limits; the admin and import routes; fetching web addresses (it should refuse private and internal addresses); file uploads; and where it writes files.
- The front end (`var/www/nammet`): for example, recipe data or admin settings that can run script in a visitor's browser.
- The nginx and systemd configuration in `etc/`, when it's installed as described in [docs/install.md](docs/install.md).
- `install.sh`, and the Docker image (`Dockerfile`, `docker/`) run as described in [docs/docker.md](docs/docker.md).

## Out of scope

- Servers set up differently from the install guide, or without the steps in its security checklist.
- Denial of service through sheer volume of traffic.
- Getting past the AI-crawler block. It only catches crawlers that say who they are.
- Problems in Anthropic's API, nginx, Node.js or the npm dependencies themselves. Report those to their own projects. A way this site uses them unsafely is in scope.
