# DigitalOcean testing deployment

For the selected GitHub Pages frontend + existing Droplet setup, use [the split deployment guide](github-pages-droplet-testing.md). The combined App Platform option below is an alternative.

The root Dockerfile builds Expo web, then serves the exported files and FastAPI from one non-root container on port 8080. API calls and WebSockets use the page origin (HTTPS/WSS behind DigitalOcean). Local Expo on ports 8081/8083 continues to use the API on port 8000. `EXPO_PUBLIC_API_URL` can override this at frontend build time.

## In-memory constraints

Run exactly **one instance and one Uvicorn worker**. Do not enable autoscaling or reload in the hosted deployment. Authentication, profiles, rooms, chats, balances, and games are all temporary. Restarts and deployments reset them; testers must sign out and start a fresh session. Deploy between test sessions: a rolling deployment can temporarily route players to different old/new processes.

## App Platform

1. Push the reviewed application and deployment changes to the branch specified in `.do/app.yaml` (currently `main`). Local uncommitted files are not included in a GitHub deployment.
2. Connect `L-factorial/bhidne-ho` to DigitalOcean App Platform and import `.do/app.yaml`, or with an authenticated `doctl` installation run `doctl apps create --spec .do/app.yaml`.
3. Review the selected region and instance plan/cost in DigitalOcean before creating the service. The example uses SFO, `basic-xxs`, one instance. Increase memory if test load needs it, retaining a single instance.
4. Wait for the Docker build and `/health` check to pass. Open the generated HTTPS app URL in separate browser profiles, create a room, join it, and test all games.
5. Auto-deployment on push is disabled so commits do not interrupt test games. Redeploy deliberately between sessions.

DigitalOcean handles public TLS and routes the service to port 8080. No separate frontend origin or CORS setting is required. Do not set a localhost `EXPO_PUBLIC_API_URL` in the hosted build.

## Local deployment rehearsal

With Docker installed:

```sh
docker build -t bhidne-ho-test .
docker run --rm -p 127.0.0.1:8090:8080 bhidne-ho-test
```

Open http://localhost:8090 and verify `/health` on that same origin.

Without Docker, after `npm --prefix client run build:web`:

```sh
BHIDNE_WEB_DIR="$PWD/client/dist" .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8090 --workers 1
```

This checks built frontend/API/WebSocket integration but does not validate the Linux Docker build.

## Existing Droplet alternative

The same image can run behind a TLS reverse proxy on a Droplet; publish the container only on localhost and forward HTTP and WebSocket upgrades from the proxy. The Droplet address, SSH identity and public hostname are needed before configuring this target. The image trusts forwarded headers, so its port should be reachable only through the trusted proxy.

Reference: https://docs.digitalocean.com/products/app-platform/reference/app-spec/
