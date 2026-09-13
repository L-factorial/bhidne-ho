# One-week test: GitHub Pages frontend + existing Droplet backend

## Current deployment

The backend runs on `root@64.227.86.254`, Compose project `bhidne-ho-test`, localhost:18080. Nginx and Certbot serve its HTTPS hostname; public HTTPS and WSS checks pass. Soccer-agent retains its separate port and site.

GitHub Actions deploys frontend and backend on every `main` push. See [automatic deployments](automatic-deployments.md) for credentials, workflow behavior, rollback and in-memory resets. The earlier `gh-pages` artifact branch is retained as history and is no longer the publishing source once Actions is enabled.

Both GoDaddy DNS records are configured. GitHub's frontend certificate provisioning is still pending as of setup; enforce HTTPS and verify the public browser flow once issued.

## Addresses

| Component | URL | DNS record in lfactorial.com |
| --- | --- | --- |
| Frontend | https://bhidne-ho.lfactorial.com | CNAME `bhidne-ho` → `l-factorial.github.io` |
| Backend | https://api-bhidne-ho.lfactorial.com | A `api-bhidne-ho` → `64.227.86.254` |

Only add an AAAA record if the Droplet's IPv6 address is configured and reachable. Preserve records for other applications.

## Backend (deploy first)

Before changing the Droplet, inspect its existing proxy, listening ports and available memory. The prepared Compose service uses localhost port 18080; confirm that port is free. Do not replace another application's proxy configuration.

From a checkout containing the reviewed changes on the Droplet:

```sh
docker compose -f deploy/compose.yaml up -d --build
curl --fail http://127.0.0.1:18080/health
```

This builds the `backend` Docker target without Node or the frontend. One container runs one Uvicorn worker. CORS permits the exact frontend HTTPS origin; guest bearer tokens authenticate HTTP and WebSocket requests.

If the existing proxy is Caddy, merge `deploy/Caddyfile.snippet` into its configuration, validate it and reload it. Caddy obtains TLS and supports WebSocket upgrades. If the proxy is Nginx or something else, adapt that existing proxy instead of installing a competing service. The public backend hostname must serve HTTPS and forward WebSockets to localhost:18080. Expose no additional public backend port.

Check `https://api-bhidne-ho.lfactorial.com/health` before publishing the frontend.

## Frontend

1. Push the reviewed source and `.github/workflows/pages.yml` to `L-factorial/bhidne-ho`.
2. In repository Settings → Pages, select GitHub Actions as the publishing source and set the custom domain to `bhidne-ho.lfactorial.com`. The CNAME artifact alone does not configure the repository domain for an Actions deployment.
3. Add the frontend DNS record above and enable Enforce HTTPS once GitHub provisions its certificate. Domain verification in the GitHub account/organization is recommended.
4. Push to `main`, or run **Deploy frontend** manually from Actions on `main`. It exports Expo with `EXPO_PUBLIC_API_URL=https://api-bhidne-ho.lfactorial.com` and uploads only `client/dist`.
5. Open the custom domain in independent browser profiles; test creating/joining a room, all three games, profile access, and reconnects. Confirm requests go to the API hostname and sockets use WSS.

The custom domain serves the app at `/`, so no `/bhidne-ho` asset prefix is used. Both components deploy automatically on pushes to `main`. A different API hostname requires updating the workflow environment and rebuilding the frontend; it is embedded at build time.

## During and after the week

All authentication, room, profile and game data remains in RAM. Backend restarts erase it. Keep one instance and one worker, and schedule backend deployments between games. Existing unrelated Droplet services can continue running.

No automatic shutdown date is set. At the end of testing, stop only this Compose project (`docker compose -f deploy/compose.yaml down`). If retiring the website, remove its DNS record and disable Pages/custom-domain association together; leave other applications untouched.

References:
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
