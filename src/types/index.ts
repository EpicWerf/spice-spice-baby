// Environment variables available to the worker
export interface Env {
  ANTHROPIC_API_KEY: string;
  PAPRIKA_EMAIL: string;
  PAPRIKA_PASSWORD: string;
  RAPIDAPI_KEY: string;
  AI: Ai; // Cloudflare Workers AI binding
}

// Recipe structure matching Paprika's API format
export interface PaprikaRecipe {
  uid: string;
  name: string;
  ingredients: string;
  directions: string;
  description: string;
  notes: string;
  nutritional_info: string;
  prep_time: string;
  cook_time: string;
  total_time: string;
  difficulty: string;
  servings: string;
  rating: number;
  source: string;
  source_url: string;
  photo: string | null;
  photo_hash: string | null;
  photo_large: string | null;
  photo_url: string | null;
  image_url: string | null;
  categories: string[];
  hash: string;
  created: string;
  on_favorites: boolean;
  on_grocery_list: boolean;
  in_trash: boolean;
  is_pinned: boolean;
  scale: string | null;
}

// What Claude Vision extracts from the image
export interface ExtractedRecipe {
  name: string;
  ingredients: string;
  directions: string;
  prep_time: string;
  cook_time: string;
  servings: string;
  source: string;
  source_url: string;
  notes: string;
  image_url?: string;  // URL to recipe image (for URL-based extraction)
}

// Content item that can be processed (image, PDF, URL, or video)
export interface ContentItem {
  type: 'image' | 'pdf' | 'url' | 'video';
  data: ArrayBuffer | string;  // ArrayBuffer for files, string for URLs
  mimeType?: string;
  filename?: string;
  platform?: 'tiktok' | 'instagram';  // For video URLs
}

// Paprika API authentication response
export interface PaprikaAuthResponse {
  result: {
    token: string;
  };
}

// Paprika sync response
export interface PaprikaSyncResponse {
  result: {
    recipes?: Array<{ uid: string; hash: string }>;
  };
}

// Email attachment structure
export interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: ArrayBuffer;
}

// Processing result
export interface ProcessingResult {
  success: boolean;
  recipeName?: string;
  error?: string;
}
