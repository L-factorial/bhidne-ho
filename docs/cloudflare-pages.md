# Scalability frontend on Cloudflare Pages

This project deploys the frontend from `bhidne-ho-scalability-prod` to
`https://prod.bhidne-ho.lfactorial.com`. GitHub Pages continues publishing `main`
to `https://bhidne-ho.lfactorial.com`. No login toggle is used.

## Repository configuration

From `client`, `npm run build:cloudflare` type-checks and exports the Expo web app
with these public build variables fixed by `scripts/build-cloudflare.mjs`:

```text
EXPO_PUBLIC_API_URL=https://api.prod.bhidne-ho.lfactorial.com
EXPO_PUBLIC_WEB_URL=https://prod.bhidne-ho.lfactorial.com
EXPO_PUBLIC_RUNTIME_MODE=distributed-integration
```

This selects the existing distributed client, including its distinct login/lobby.
These are public settings, not credentials. No API token or database secret is
needed in the frontend. The script refuses a different `CF_PAGES_BRANCH` and removes
only the exported GitHub CNAME file; the source CNAME and main workflow stay intact.

## One-time setup

1. Commit and push the build script, package.json change, and these instructions to
   `bhidne-ho-scalability-prod` before starting the Cloudflare build. Other backend
   deployment changes can be released separately; inspect the commit contents.
2. Sign in to Cloudflare. Open **Workers & Pages → Create application → Pages →
   Connect to Git**. Authorize the Cloudflare GitHub integration for
   `L-factorial/bhidne-ho`, and select that repository. Use Git integration so
   subsequent pushes build automatically.
3. Set these build settings:

   | Setting | Value |
   | --- | --- |
   | Project name | `bhidne-ho-prod` (or another available name) |
   | Production branch | `bhidne-ho-scalability-prod` |
   | Framework preset | None |
   | Root directory | `client` |
   | Build command | `npm ci && npm run build:cloudflare` |
   | Build output directory | `dist` |
   | Environment variable | `NODE_VERSION=22` |
   | Environment variable | `SKIP_DEPENDENCY_INSTALL=true` |

   The command installs exactly the lockfile dependencies; the skip variable avoids
   Cloudflare's separate automatic dependency installation. The three Expo settings
   above are supplied by the script, so no dashboard duplication is needed.
4. Save and deploy. Under **Settings → Builds & deployments → Branch control**,
   keep production deployments enabled and disable preview deployments for other
   branches. Preview origins are not configured for production API access.
5. Open **Custom domains → Set up a custom domain** and add
   `prod.bhidne-ho.lfactorial.com`. Follow Cloudflare's verification instructions.
6. At the existing DNS provider, create the CNAME Cloudflare requests:

   ```text
   prod.bhidne-ho.lfactorial.com → <actual-project-name>.pages.dev
   ```

   If editing the `lfactorial.com` zone, the record name is usually `prod.bhidne-ho`.
   Use the actual hostname shown in the Pages dashboard. Add the domain to Pages
   before creating the record. An externally managed subdomain can use CNAME without
   moving the entire zone's nameservers. Wait for domain activation and HTTPS.
7. Once the backend is live, verify the custom domain's login, room creation,
   gameplay, and reconnects against the production API. The generated `pages.dev`
   address can show the static frontend but is not an allowed production API origin.

The API domain belongs on the backend load balancer, not on Pages. Provisioning
already declares `https://prod.bhidne-ho.lfactorial.com` as its client origin, but
application provisioning, API DNS/TLS and deployment are still outstanding. A
successful frontend build does not mean the backend or games are production-ready.
Social sign-in additionally requires provider configuration and approved redirects.

## Local verification

```sh
cd client
npm ci
npm run build:cloudflare
```

Only `client/dist` is published. This is a static Pages deployment; no Pages Functions
or Cloudflare-hosted backend is required. Future pushes to the configured production
branch redeploy the frontend automatically. The build configuration has been prepared
locally; account connection, cloud project creation and DNS require account access.

References: [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/),
[build image settings](https://developers.cloudflare.com/pages/configuration/build-image/),
[custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/),
[branch controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).
