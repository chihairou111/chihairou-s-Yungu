This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Security notes

- **Writes come only from this site's own pages.** Every non-GET `/api/*` request passes `isSameOriginWrite` (`src/lib/same-origin.ts`): the proxy runs it for all Route Handlers except the upload route `/api/files`, which runs it itself (the proxy copies a request body and cuts it at 10 MB, under the 50 MB upload limit). `Sec-Fetch-Site` must be `same-origin` when sent, `Origin` must match the host when sent, and the body must be JSON or none.
- **Uploads need a browser that sends `Sec-Fetch-Site`** (Chrome/Edge 76+, Firefox 90+, Safari 16.4+). Multipart is accepted only with `Sec-Fetch-Site: same-origin` and a matching `Origin`; older browsers fail closed with "Forbidden.".
- No page may be framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), except `/api/files/*`, which the PDF viewer frames from our own pages (`SAMEORIGIN`).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
