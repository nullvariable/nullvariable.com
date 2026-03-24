# [nullvariable.com](https://nullvariable.com)

AI & Web Consulting — making the internet since 1997.

## Stack

- [Parcel 2](https://parceljs.org/) — build, bundling, dev server
- [PostHTML](https://posthtml.org/) — HTML component includes
- Hand-rolled CSS — no frameworks, ~5KB total
- [Cloudflare R2](https://developers.cloudflare.com/r2/) — static hosting
- [Cloudflare Workers](https://workers.cloudflare.com/) — contact form backend
- [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) — bot protection
- [Resend](https://resend.com/) — transactional email

## Scripts

```
npm start     # Dev server with HMR
npm run build # Production build
npm run upload # Deploy to R2
```

## Worker

Contact form handler lives in `worker/`. Deploy with:

```
cd worker && npx wrangler deploy
```

Secrets (set via `npx wrangler secret put`):
- `TURNSTILE_SECRET_KEY`
- `RESEND_API_KEY`
