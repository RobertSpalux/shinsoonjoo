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

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Environment

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SHOW_SITE_NOTICE` | **사이트 심의 캡처 전용.** `1`이면 푸터에 사이트 골격 필수안내사항(공란 플레이스홀더)을 표시한다. 심의 제출용 화면 캡처 시 로컬(`.env.local`)에서만 켠다. **라이브/Vercel에는 설정하지 않는다** → 라이브에서는 심의필 없는 필수안내사항이 자동으로 숨겨진다(미심의 광고물 심의필 표기 방지, CLAUDE.md §6.3). 실제 심의필 수령 후에는 `src/lib/brand.ts`의 `SITE_REVIEW`를 채우면 이 변수와 무관하게 상시 표시된다. |
