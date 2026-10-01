# Krative T3ch

Krative T3ch is the public technology and innovation brand of Krative Technology Limited.

## Services in this repository

- **Kranova** — learning and opportunity platform (`server.js` + `index.html`)
- **KIA** — Krative Intelligence Assistant (`kia/`)
- **KLGI** — Krative LeadGen Intelligence (`klgi/`)

**Krative Core** and **NOETICA Intelligence** are maintained as separate services and are connected through authenticated APIs.

## Runtime

Use **Node.js 24+**.

### Kranova

```bash
npm install
npm test
npm start
```

### KIA

```bash
cd kia
npm install
npm run check
npm start
```

KIA requires PostgreSQL via `DATABASE_URL`.

### KLGI

```bash
cd klgi
npm install
npm run check
npm start
```

KLGI should use PostgreSQL in production.

## Configuration

Use the supplied `.env.example` files as the configuration reference. Put real secrets only in your local environment or deployment provider; never commit API keys, OAuth secrets, database credentials, or admin tokens.

## Architecture boundary

Product services should consume Krative Core and NOETICA Intelligence rather than implementing duplicate intelligence engines. Krative Core remains the foundational intelligence engine; NOETICA Intelligence remains the intelligence runtime.

## Quality gate

Before merging changes:

```bash
npm test
cd kia && npm run check
cd ../klgi && npm run check
```
