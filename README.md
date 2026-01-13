# Spice Spice Baby

An AI-powered recipe extraction agent that receives recipes via email and automatically adds them to your [Paprika](https://www.paprikaapp.com/) recipe manager.

## Features

- **Email Integration** - Send recipes to a dedicated email address
- **Multiple Input Formats**:
  - **Images** - Photos of recipe cards, cookbook pages, screenshots
  - **PDFs** - Recipe documents, scanned cookbooks
  - **URLs** - Links to recipe websites (with automatic scraping)
  - **TikTok Videos** - Recipe videos with audio transcription
  - **Instagram Reels** - Recipe videos with audio transcription
- **Smart Extraction** - Uses Claude AI to extract structured recipe data
- **Caption Support** - For TikTok/Instagram, extracts from both audio AND captions
- **Multi-Image Support** - Send multiple images of the same recipe (e.g., page 1 & 2)

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────────────┐
│                 │     │           Cloudflare Worker                       │
│  Email/HTTP     │────▶│                                                  │
│                 │     │  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │
└─────────────────┘     │  │ Email       │  │ Claude AI   │  │ Paprika  │ │
                        │  │ Parser      │──▶│ Extraction  │──▶│ API      │ │
┌─────────────────┐     │  └─────────────┘  └─────────────┘  └──────────┘ │
│ TikTok/IG Video │────▶│         │                                        │
└─────────────────┘     │         ▼                                        │
                        │  ┌─────────────┐  ┌─────────────┐                │
                        │  │ RapidAPI    │  │ Cloudflare  │                │
                        │  │ Downloader  │──▶│ Whisper AI  │                │
                        │  └─────────────┘  └─────────────┘                │
                        └──────────────────────────────────────────────────┘
```

## Setup

### Prerequisites

- [Cloudflare account](https://cloudflare.com)
- [Anthropic API key](https://console.anthropic.com/)
- [Paprika account](https://www.paprikaapp.com/)
- [RapidAPI account](https://rapidapi.com) (for TikTok/Instagram support)
- Domain with email routing configured in Cloudflare

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/spice-spice-baby.git
   cd spice-spice-baby
   npm install
   ```

2. **Configure secrets**
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put PAPRIKA_EMAIL
   npx wrangler secret put PAPRIKA_PASSWORD
   npx wrangler secret put RAPIDAPI_KEY
   ```

3. **Deploy**
   ```bash
   npx wrangler deploy
   ```

4. **Set up email routing**
   - Go to Cloudflare Dashboard → Email → Email Routing
   - Add a custom address (e.g., `recipes@yourdomain.com`)
   - Route it to your deployed worker

### RapidAPI Setup (for TikTok/Instagram)

1. Create account at [rapidapi.com](https://rapidapi.com)
2. Subscribe to these APIs (free tiers available):
   - [TikTok Download Video No Watermark](https://rapidapi.com/godownloaderofficial/api/tiktok-download-video-no-watermark) - 10 free requests/month
   - [Instagram Reels Downloader](https://rapidapi.com/codecrest8/api/instagram-reels-downloader2) - 500 free requests/month
3. Copy your API key from any subscribed API's code examples

## Usage

### Via Email

Send an email to your configured address (e.g., `recipes@yourdomain.com`) with any of:

- **Image attachments** - Recipe photos (multiple images = one recipe)
- **PDF attachments** - Recipe documents
- **URLs in the body** - Recipe website links
- **TikTok/Instagram links** - Video recipe links

### Via HTTP API

#### Test Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/test-paprika` | POST | Test Paprika authentication |
| `/list-recipes` | GET | List all recipes in Paprika |
| `/test-extract` | POST | Extract recipe from image (body = image) |
| `/test-full` | POST | Full pipeline: image → Paprika |
| `/test-url` | POST | Extract from URL: `{"url": "..."}` |
| `/test-pdf` | POST | Extract from PDF (body = PDF) |
| `/test-video` | POST | Extract from TikTok/Instagram: `{"url": "..."}` |
| `/recipe/:uid` | GET | Get recipe details by UID |
| `/delete-recipe/:uid` | DELETE | Delete a recipe |

#### Examples

**Extract from URL:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"url":"https://www.kingarthurbaking.com/recipes/chocolate-chip-cookies-recipe"}' \
  https://your-worker.workers.dev/test-url
```

**Extract from TikTok:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@user/video/123456"}' \
  https://your-worker.workers.dev/test-video
```

**Extract from image:**
```bash
curl -X POST -H "Content-Type: image/jpeg" \
  --data-binary @recipe.jpg \
  https://your-worker.workers.dev/test-full
```

## How It Works

### Image/PDF Processing
1. Email received → parsed with `postal-mime`
2. Images/PDFs extracted from attachments
3. Sent to Claude Vision API for recipe extraction
4. Structured recipe data returned as JSON
5. Recipe created in Paprika via API

### URL Processing
1. URL detected in email body
2. Page fetched and JSON-LD schema extracted
3. If structured data found, recipe parsed directly
4. Otherwise, HTML sent to Claude for extraction
5. Recipe created in Paprika

### Video Processing (TikTok/Instagram)
1. Video URL detected in email
2. Video info fetched via RapidAPI (includes caption)
3. Video downloaded
4. Audio transcribed via Cloudflare Workers AI (Whisper)
5. Both transcript AND caption sent to Claude
6. Recipe extracted (prioritizes caption for exact measurements)
7. Recipe created in Paprika

## Project Structure

```
src/
├── index.ts              # Main worker entry point
├── types/
│   └── index.ts          # TypeScript interfaces
└── services/
    ├── paprika.ts        # Paprika API client
    ├── claude.ts         # Claude AI extraction
    ├── email-parser.ts   # Email parsing utilities
    ├── video-downloader.ts # TikTok/Instagram download
    └── transcriber.ts    # Whisper transcription
```

## Costs

| Service | Free Tier | Overage |
|---------|-----------|---------|
| Cloudflare Workers | 100k requests/day | $0.50/million |
| Cloudflare Workers AI (Whisper) | - | $0.00045/minute |
| Claude API | - | ~$0.003/recipe |
| TikTok API (RapidAPI) | 10/month | $0.005/request |
| Instagram API (RapidAPI) | 500/month | $0.003/request |

**Estimated cost for 50 recipes/month:** ~$0.50

## Supported Recipe Sites

URL extraction works best with sites that include JSON-LD structured data:
- King Arthur Baking
- Serious Eats
- Simply Recipes
- Budget Bytes
- And many more...

Some sites (like AllRecipes) use JavaScript rendering and may only extract partial data.

## Limitations

- TikTok/Instagram require RapidAPI subscription
- Some recipe websites block Cloudflare Workers
- Video processing limited by Cloudflare Workers memory (~128MB)
- Very long videos may fail transcription

## License

MIT
