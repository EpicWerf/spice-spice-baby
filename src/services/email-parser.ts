import PostalMime from 'postal-mime';
import type { ContentItem } from '../types';

// Supported image MIME types
const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
];

// PDF MIME type
const PDF_MIME_TYPE = 'application/pdf';

// URL pattern for recipe websites
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

// Common recipe website domains (to prioritize)
const RECIPE_DOMAINS = [
  'allrecipes.com',
  'foodnetwork.com',
  'epicurious.com',
  'bonappetit.com',
  'seriouseats.com',
  'simplyrecipes.com',
  'budgetbytes.com',
  'delish.com',
  'tasty.co',
  'food52.com',
  'cookinglight.com',
  'myrecipes.com',
  'tasteofhome.com',
  'kingarthurbaking.com',
  'smittenkitchen.com',
  'minimalistbaker.com',
  'thekitchn.com',
  'recipetineats.com',
  'halfbakedharvest.com',
  'pinchofyum.com',
  'damndelicious.net',
  'therecipecritic.com',
  'gimmesomeoven.com',
  'cafedelites.com',
  'hostthetoast.com',
  'skinnytaste.com',
  'wellplated.com',
  'cookieandkate.com',
  'loveandlemons.com',
];

export interface ParsedEmailContent {
  images: ContentItem[];
  pdfs: ContentItem[];
  urls: ContentItem[];
  videos: ContentItem[];  // TikTok and Instagram video URLs
}

/**
 * Parse an email and extract all content items (images, PDFs, URLs)
 */
export async function parseEmailContent(
  rawEmail: ReadableStream<Uint8Array> | string
): Promise<ParsedEmailContent> {
  const parser = new PostalMime();

  // Parse the raw email
  let email;
  if (typeof rawEmail === 'string') {
    email = await parser.parse(rawEmail);
  } else {
    // Convert ReadableStream to ArrayBuffer
    const reader = rawEmail.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    email = await parser.parse(combined);
  }

  const images: ContentItem[] = [];
  const pdfs: ContentItem[] = [];
  const urls: ContentItem[] = [];

  // Check attachments for images and PDFs
  if (email.attachments) {
    for (const attachment of email.attachments) {
      const mimeType = attachment.mimeType?.toLowerCase() || '';

      // Handle content conversion
      let content: ArrayBuffer;
      if (typeof attachment.content === 'string') {
        const encoder = new TextEncoder();
        content = encoder.encode(attachment.content).buffer as ArrayBuffer;
      } else {
        content = attachment.content;
      }

      // Check for images
      if (SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
        images.push({
          type: 'image',
          data: content,
          mimeType: mimeType,
          filename: attachment.filename || 'image',
        });
      }

      // Check for PDFs
      if (mimeType === PDF_MIME_TYPE) {
        pdfs.push({
          type: 'pdf',
          data: content,
          mimeType: mimeType,
          filename: attachment.filename || 'document.pdf',
        });
      }
    }
  }

  const videos: ContentItem[] = [];

  // Extract URLs from email body (text and HTML)
  const bodyText = (email.text || '') + ' ' + (email.html || '');
  const foundUrls = bodyText.match(URL_PATTERN) || [];

  // Deduplicate and filter URLs
  const seenUrls = new Set<string>();
  for (const url of foundUrls) {
    // Clean up URL (remove trailing punctuation)
    let cleanUrl = url.replace(/[.,;:!?)\]]+$/, '');

    // Skip already seen URLs
    if (seenUrls.has(cleanUrl)) continue;
    seenUrls.add(cleanUrl);

    // Check if it's a video URL (TikTok or Instagram)
    const videoPlatform = detectVideoPlatform(cleanUrl);
    if (videoPlatform) {
      videos.push({
        type: 'video',
        data: cleanUrl,
        platform: videoPlatform,
      });
      continue;
    }

    // Skip common non-recipe URLs
    if (isLikelyRecipeUrl(cleanUrl)) {
      urls.push({
        type: 'url',
        data: cleanUrl,
      });
    }
  }

  return { images, pdfs, urls, videos };
}

/**
 * Detect if a URL is a TikTok or Instagram video
 */
function detectVideoPlatform(url: string): 'tiktok' | 'instagram' | null {
  const lowerUrl = url.toLowerCase();

  // TikTok patterns
  if (lowerUrl.includes('tiktok.com') || lowerUrl.includes('vm.tiktok.com')) {
    return 'tiktok';
  }

  // Instagram patterns (reels, posts with video)
  if (lowerUrl.includes('instagram.com/reel/') ||
      lowerUrl.includes('instagram.com/p/') ||
      lowerUrl.includes('instagram.com/tv/')) {
    return 'instagram';
  }

  return null;
}

/**
 * Check if a URL is likely to be a recipe page
 */
function isLikelyRecipeUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // Skip common non-recipe URLs
  const skipPatterns = [
    'unsubscribe',
    'mailto:',
    'javascript:',
    'facebook.com',
    'twitter.com',
    'instagram.com',
    'pinterest.com',
    'youtube.com',
    'tiktok.com',
    'linkedin.com',
    'apple.com',
    'google.com/search',
    'amazon.com',
    '.css',
    '.js',
    '.png',
    '.jpg',
    '.gif',
    'privacy',
    'terms',
    'login',
    'signup',
    'cart',
    'checkout',
  ];

  for (const pattern of skipPatterns) {
    if (lowerUrl.includes(pattern)) return false;
  }

  // Check if it's a known recipe domain
  for (const domain of RECIPE_DOMAINS) {
    if (lowerUrl.includes(domain)) return true;
  }

  // Check for recipe-related keywords in URL
  const recipeKeywords = ['recipe', 'cook', 'bake', 'food', 'dish', 'meal', 'ingredient'];
  for (const keyword of recipeKeywords) {
    if (lowerUrl.includes(keyword)) return true;
  }

  // Default: include if it looks like a content URL (not a homepage)
  const urlParts = new URL(url).pathname.split('/').filter(Boolean);
  return urlParts.length >= 1;
}

/**
 * Legacy function for backward compatibility
 */
export async function parseEmailForImages(
  rawEmail: ReadableStream<Uint8Array> | string
): Promise<Array<{ filename: string; mimeType: string; content: ArrayBuffer }>> {
  const { images } = await parseEmailContent(rawEmail);
  return images.map((img) => ({
    filename: img.filename || 'image',
    mimeType: img.mimeType || 'image/jpeg',
    content: img.data as ArrayBuffer,
  }));
}

/**
 * Extract sender information from parsed email
 */
export function getSenderFromEmail(rawEmail: string): string {
  const fromMatch = rawEmail.match(/^From:\s*(.+)$/im);
  return fromMatch ? fromMatch[1].trim() : 'unknown';
}
