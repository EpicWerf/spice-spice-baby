import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedRecipe, ContentItem } from '../types';

const IMAGE_RECIPE_PROMPT = `Extract the recipe from this image. Return ONLY valid JSON with no additional text or markdown formatting.

{
  "name": "Recipe title exactly as shown",
  "ingredients": "Each ingredient on its own line, include quantities and units",
  "directions": "Step by step instructions, each step on its own line, numbered",
  "prep_time": "Prep time if visible, otherwise empty string",
  "cook_time": "Cook time if visible, otherwise empty string",
  "servings": "Number of servings if visible, otherwise empty string",
  "source": "Source or attribution if visible, otherwise empty string",
  "source_url": "",
  "notes": "Any additional notes, tips, or variations mentioned"
}

Important:
- Preserve exact ingredient quantities and measurements
- Keep instruction steps in order
- If text is unclear, make your best interpretation
- If you absolutely cannot read the recipe, set name to "UNREADABLE" and explain in notes`;

const PDF_RECIPE_PROMPT = `Extract all recipes from this PDF document. Return ONLY valid JSON with no additional text or markdown formatting.

If there are multiple recipes, return an array. If there's only one recipe, still return it as a single-element array.

[
  {
    "name": "Recipe title",
    "ingredients": "Each ingredient on its own line, include quantities and units",
    "directions": "Step by step instructions, each step on its own line, numbered",
    "prep_time": "Prep time if visible, otherwise empty string",
    "cook_time": "Cook time if visible, otherwise empty string",
    "servings": "Number of servings if visible, otherwise empty string",
    "source": "Source or attribution if visible, otherwise empty string",
    "source_url": "",
    "notes": "Any additional notes, tips, or variations mentioned"
  }
]

Important:
- Extract ALL recipes from the document
- Preserve exact ingredient quantities and measurements
- Keep instruction steps in order`;

const URL_RECIPE_PROMPT = `Extract the recipe from this webpage content. Return ONLY valid JSON with no additional text or markdown formatting.

{
  "name": "Recipe title",
  "ingredients": "Each ingredient on its own line, include quantities and units",
  "directions": "Step by step instructions, each step on its own line, numbered",
  "prep_time": "Prep time if visible, otherwise empty string",
  "cook_time": "Cook time if visible, otherwise empty string",
  "servings": "Number of servings if visible, otherwise empty string",
  "source": "Website or author name",
  "source_url": "The original URL",
  "notes": "Any additional notes, tips, or variations mentioned",
  "image_url": "URL of the main recipe image if found, otherwise empty string"
}

Important:
- Look for structured recipe data (JSON-LD, schema.org markup) first
- Extract the main recipe image URL if available
- Preserve exact ingredient quantities and measurements
- Keep instruction steps in order
- If no recipe is found, set name to "NO_RECIPE" and explain in notes`;

const TRANSCRIPT_RECIPE_PROMPT = `Extract the recipe from this video content. You have been given:
1. The audio transcript from the video (what the person says)
2. The caption/description (text the creator wrote under the video)

IMPORTANT: The caption often contains the FULL RECIPE with exact measurements, while the video audio may be more casual. Prioritize the caption for exact measurements when available.

Return ONLY valid JSON with no additional text or markdown formatting.

{
  "name": "Recipe title (infer from context if not explicitly stated)",
  "ingredients": "Each ingredient on its own line, include quantities and units as mentioned",
  "directions": "Step by step instructions, each step on its own line, numbered",
  "prep_time": "Prep time if mentioned, otherwise empty string",
  "cook_time": "Cook time if mentioned, otherwise empty string",
  "servings": "Number of servings if mentioned, otherwise empty string",
  "source": "Creator name if mentioned",
  "source_url": "",
  "notes": "Any tips, variations, or additional context mentioned"
}

Important:
- Check BOTH the transcript AND caption for recipe information
- The caption often has the complete ingredient list with exact measurements - use these!
- If the caption has structured recipe data, prefer that over casual verbal mentions
- People in videos often speak casually - interpret measurements like "a pinch", "some", "a bit" as best you can
- If exact quantities aren't in the caption, use reasonable estimates and note this
- Instructions may be given out of order - reorganize them logically
- If no recipe is found in either source, set name to "NO_RECIPE" and explain in notes`;

/**
 * Claude client for extracting recipes from various content types
 */
export class ClaudeVisionClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Extract recipe(s) from a content item (image, PDF, or URL)
   */
  async extractFromContent(item: ContentItem): Promise<ExtractedRecipe[]> {
    switch (item.type) {
      case 'image':
        const imageRecipe = await this.extractFromImage(
          item.data as ArrayBuffer,
          item.mimeType || 'image/jpeg'
        );
        return [imageRecipe];

      case 'pdf':
        return await this.extractFromPDF(item.data as ArrayBuffer);

      case 'url':
        const urlRecipe = await this.extractFromURL(item.data as string);
        return [urlRecipe];

      default:
        throw new Error(`Unknown content type: ${item.type}`);
    }
  }

  /**
   * Extract recipe data from an image
   */
  async extractFromImage(
    imageData: ArrayBuffer,
    mimeType: string
  ): Promise<ExtractedRecipe> {
    return this.extractFromMultipleImages([{ data: imageData, mimeType }]);
  }

  /**
   * Extract a single recipe from multiple images (e.g., page 1 and page 2 of a recipe)
   */
  async extractFromMultipleImages(
    images: Array<{ data: ArrayBuffer; mimeType: string }>
  ): Promise<ExtractedRecipe> {
    const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    const imageBlocks = images.map((img) => {
      const base64 = this.arrayBufferToBase64(img.data);
      const mediaType = validMimeTypes.includes(img.mimeType)
        ? (img.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')
        : 'image/jpeg';

      return {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: mediaType,
          data: base64,
        },
      };
    });

    const prompt = images.length > 1
      ? `These ${images.length} images are pages of the SAME recipe. Combine all the information into a single recipe.\n\n${IMAGE_RECIPE_PROMPT}`
      : IMAGE_RECIPE_PROMPT;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });

    return this.parseRecipeResponse(response);
  }

  /**
   * Extract recipe data from an image (legacy method for compatibility)
   */
  async extractRecipe(
    imageData: ArrayBuffer,
    mimeType: string
  ): Promise<ExtractedRecipe> {
    return this.extractFromImage(imageData, mimeType);
  }

  /**
   * Extract recipe from a video transcript and caption (TikTok/Instagram)
   */
  async extractFromTranscript(
    transcript: string,
    sourceUrl: string,
    authorName?: string,
    caption?: string
  ): Promise<ExtractedRecipe> {
    console.log(`Extracting recipe from transcript: ${transcript.length} characters`);
    if (caption) {
      console.log(`Caption provided: ${caption.length} characters`);
    }

    // Build the content with both transcript and caption
    let content = `## Audio Transcript (what the person says in the video):\n\n${transcript}`;

    if (caption) {
      content += `\n\n## Video Caption/Description (text written by creator):\n\n${caption}`;
    }

    content += `\n\n${TRANSCRIPT_RECIPE_PROMPT}`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    });

    const recipe = this.parseRecipeResponse(response);
    recipe.source_url = sourceUrl;
    if (authorName && !recipe.source) {
      recipe.source = authorName;
    }

    return recipe;
  }

  /**
   * Extract recipes from a PDF document
   */
  async extractFromPDF(pdfData: ArrayBuffer): Promise<ExtractedRecipe[]> {
    const base64 = this.arrayBufferToBase64(pdfData);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            {
              type: 'text',
              text: PDF_RECIPE_PROMPT,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const jsonText = textBlock.text.trim();

    try {
      const recipes = JSON.parse(jsonText) as ExtractedRecipe[];
      return Array.isArray(recipes)
        ? recipes.map((r) => this.validateRecipe(r))
        : [this.validateRecipe(recipes)];
    } catch {
      const jsonMatch = jsonText.match(/\[[\s\S]*\]/) || jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const recipes = Array.isArray(parsed) ? parsed : [parsed];
        return recipes.map((r: ExtractedRecipe) => this.validateRecipe(r));
      }
      throw new Error(`Failed to parse PDF recipe JSON: ${jsonText.substring(0, 200)}`);
    }
  }

  /**
   * Extract recipe from a URL by fetching and parsing the page
   */
  async extractFromURL(url: string): Promise<ExtractedRecipe> {
    console.log(`Fetching URL: ${url}`);

    // Fetch the webpage with a realistic browser User-Agent
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Try to extract and parse JSON-LD recipe data first
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
    let recipeFromSchema: ExtractedRecipe | null = null;

    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const jsonContent = match.replace(/<script type="application\/ld\+json">/i, '').replace(/<\/script>/i, '');
          const parsed = JSON.parse(jsonContent);
          recipeFromSchema = this.extractRecipeFromJsonLd(parsed, url);
          if (recipeFromSchema && recipeFromSchema.name !== 'NO_RECIPE') {
            console.log('Found recipe in JSON-LD schema');
            break;
          }
        } catch {
          // Continue to next JSON-LD block
        }
      }
    }

    // If we found a complete recipe in schema, return it
    if (recipeFromSchema && recipeFromSchema.ingredients && recipeFromSchema.directions) {
      return recipeFromSchema;
    }

    // Fall back to Claude extraction from HTML
    console.log('No complete recipe in JSON-LD, using Claude extraction');

    // Extract meta tags for image
    const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
    const twitterImageMatch = html.match(/<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"/i);
    const imageUrl = ogImageMatch?.[1] || twitterImageMatch?.[1] || '';

    // Extract a reasonable portion of the HTML for Claude
    const truncatedHtml = html.length > 50000 ? html.substring(0, 50000) + '...' : html;

    const claudeResponse = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `Here is the HTML content from ${url}:\n\n${truncatedHtml}\n\n${URL_RECIPE_PROMPT}`,
        },
      ],
    });

    const recipe = this.parseRecipeResponse(claudeResponse);
    recipe.source_url = url;
    if (!recipe.image_url && imageUrl) {
      recipe.image_url = imageUrl;
    }

    return recipe;
  }

  /**
   * Extract recipe data from JSON-LD schema.org format
   */
  private extractRecipeFromJsonLd(data: unknown, sourceUrl: string): ExtractedRecipe | null {
    // Handle arrays (common in JSON-LD)
    if (Array.isArray(data)) {
      for (const item of data) {
        const recipe = this.extractRecipeFromJsonLd(item, sourceUrl);
        if (recipe && recipe.name !== 'NO_RECIPE') return recipe;
      }
      return null;
    }

    const obj = data as Record<string, unknown>;

    // Check if this is a Recipe type
    const type = obj['@type'];
    const isRecipe = type === 'Recipe' ||
      (Array.isArray(type) && type.includes('Recipe'));

    if (!isRecipe) {
      // Check @graph property (common wrapper)
      if (obj['@graph']) {
        return this.extractRecipeFromJsonLd(obj['@graph'], sourceUrl);
      }
      return null;
    }

    // Extract recipe fields
    const name = String(obj.name || '');
    if (!name) return null;

    // Extract ingredients
    let ingredients = '';
    if (Array.isArray(obj.recipeIngredient)) {
      ingredients = obj.recipeIngredient.join('\n');
    }

    // Extract directions
    let directions = '';
    if (Array.isArray(obj.recipeInstructions)) {
      directions = obj.recipeInstructions.map((step: unknown, idx: number) => {
        if (typeof step === 'string') return `${idx + 1}. ${step}`;
        const stepObj = step as Record<string, unknown>;
        const text = stepObj.text || stepObj.name || '';
        return `${idx + 1}. ${text}`;
      }).join('\n');
    }

    // Extract times
    const prepTime = this.formatDuration(obj.prepTime as string);
    const cookTime = this.formatDuration(obj.cookTime as string);

    // Extract servings
    let servings = '';
    if (obj.recipeYield) {
      servings = Array.isArray(obj.recipeYield)
        ? String(obj.recipeYield[0])
        : String(obj.recipeYield);
    }

    // Extract image
    let imageUrl = '';
    if (obj.image) {
      if (typeof obj.image === 'string') {
        imageUrl = obj.image;
      } else if (Array.isArray(obj.image)) {
        imageUrl = typeof obj.image[0] === 'string' ? obj.image[0] : (obj.image[0] as Record<string, unknown>)?.url as string || '';
      } else {
        imageUrl = (obj.image as Record<string, unknown>).url as string || '';
      }
    }

    // Extract source/author
    let source = '';
    if (obj.author) {
      if (typeof obj.author === 'string') {
        source = obj.author;
      } else if (Array.isArray(obj.author)) {
        source = (obj.author[0] as Record<string, unknown>)?.name as string || '';
      } else {
        source = (obj.author as Record<string, unknown>).name as string || '';
      }
    }

    return {
      name,
      ingredients,
      directions,
      prep_time: prepTime,
      cook_time: cookTime,
      servings,
      source,
      source_url: sourceUrl,
      notes: '',
      image_url: imageUrl,
    };
  }

  /**
   * Format ISO 8601 duration to readable string
   */
  private formatDuration(duration: string | undefined): string {
    if (!duration) return '';
    // Parse ISO 8601 duration like PT30M, PT1H30M
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!match) return duration;
    const hours = match[1] ? parseInt(match[1]) : 0;
    const minutes = match[2] ? parseInt(match[2]) : 0;
    if (hours && minutes) return `${hours} hour${hours > 1 ? 's' : ''} ${minutes} min`;
    if (hours) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes) return `${minutes} min`;
    return '';
  }

  /**
   * Download an image from a URL
   */
  async downloadImage(imageUrl: string): Promise<{ data: ArrayBuffer; mimeType: string } | null> {
    try {
      console.log(`Downloading image: ${imageUrl}`);

      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
        },
      });

      if (!response.ok) {
        console.log(`Failed to download image: ${response.status}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const data = await response.arrayBuffer();

      return { data, mimeType: contentType };
    } catch (error) {
      console.log(`Error downloading image: ${error}`);
      return null;
    }
  }

  /**
   * Parse Claude's response into a recipe
   */
  private parseRecipeResponse(response: Anthropic.Message): ExtractedRecipe {
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const jsonText = textBlock.text.trim();

    try {
      const recipe = JSON.parse(jsonText) as ExtractedRecipe;
      return this.validateRecipe(recipe);
    } catch {
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const recipe = JSON.parse(jsonMatch[0]) as ExtractedRecipe;
        return this.validateRecipe(recipe);
      }
      throw new Error(`Failed to parse recipe JSON: ${jsonText.substring(0, 200)}`);
    }
  }

  /**
   * Validate and normalize the extracted recipe
   */
  private validateRecipe(recipe: ExtractedRecipe): ExtractedRecipe {
    return {
      name: recipe.name || 'Untitled Recipe',
      ingredients: recipe.ingredients || '',
      directions: recipe.directions || '',
      prep_time: recipe.prep_time || '',
      cook_time: recipe.cook_time || '',
      servings: recipe.servings || '',
      source: recipe.source || '',
      source_url: recipe.source_url || '',
      notes: recipe.notes || '',
      image_url: recipe.image_url || undefined,
    };
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
