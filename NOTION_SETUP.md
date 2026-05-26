# Notion Intake Setup (Vercel)

This repo includes a Vercel Serverless Function endpoint:

- `POST /api/intake` -> writes a lead to Notion database `Website Leads`
- `GET /api/health`

The contact page submits to `/api/intake`, with a mailto fallback if the API fails.

## Notion Database

- Database name: `Website Leads`
- Database ID: `315df510155d8143b37af5c2016102ee`

## Required Vercel Environment Variables

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID` = `315df510155d8143b37af5c2016102ee`
- `ALLOWED_ORIGINS` = `https://skydataservice.com,https://www.skydataservice.com`

## Deploy

From `d:\\SkyDataService\\_deploy_skydataservice`:

```powershell
npx vercel
npx vercel env add NOTION_TOKEN production
npx vercel env add NOTION_DATABASE_ID production
npx vercel env add ALLOWED_ORIGINS production
npx vercel --prod
```

After deploy, submit the form at `/contact.html` and confirm a new entry appears in Notion `Website Leads`.
