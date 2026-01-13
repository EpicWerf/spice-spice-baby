import type { PaprikaRecipe, ExtractedRecipe } from '../types';

// V1 API works better for third-party clients
const PAPRIKA_API_V1 = 'https://www.paprikaapp.com/api/v1';
const PAPRIKA_API_V2 = 'https://www.paprikaapp.com/api/v2';

/**
 * Paprika API client for creating recipes
 * Based on reverse-engineered API documentation
 */
export class PaprikaClient {
  private email: string;
  private password: string;
  private basicAuth: string;
  private bearerToken: string | null = null;

  constructor(email: string, password: string) {
    this.email = email;
    this.password = password;
    // Basic Auth for V1 API
    this.basicAuth = btoa(`${email}:${password}`);
  }

  /**
   * Login to V2 API and get Bearer token
   */
  private async loginV2(): Promise<string> {
    const response = await fetch(`${PAPRIKA_API_V2}/account/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: this.email,
        password: this.password,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Paprika V2 login failed: ${response.status} - ${text}`);
    }

    const data = await response.json() as { result?: { token?: string } };
    if (!data.result?.token) {
      throw new Error('No token received from Paprika V2 login');
    }

    return data.result.token;
  }

  /**
   * Get bearer token, logging in if necessary
   */
  private async getBearerToken(): Promise<string> {
    if (!this.bearerToken) {
      this.bearerToken = await this.loginV2();
    }
    return this.bearerToken;
  }

  /**
   * Test authentication by fetching the recipe list (V1 for testing)
   */
  async authenticate(): Promise<void> {
    // V1 API with Basic Auth - just test we can access the API
    const response = await fetch(`${PAPRIKA_API_V1}/sync/recipes/`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${this.basicAuth}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Paprika authentication failed: ${response.status} - ${text}`);
    }

    // If we get here, auth works
    const data = await response.json() as { result?: unknown };
    if (!data.result) {
      throw new Error('Invalid response from Paprika API');
    }
  }

  /**
   * List all recipes (for debugging)
   */
  async listRecipes(): Promise<Array<{ uid: string; hash: string }>> {
    const response = await fetch(`${PAPRIKA_API_V1}/sync/recipes/`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${this.basicAuth}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to list recipes: ${response.status} - ${text}`);
    }

    const data = await response.json() as { result: Array<{ uid: string; hash: string }> };
    return data.result || [];
  }

  /**
   * Get a single recipe by UID (for debugging)
   */
  async getRecipe(uid: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${PAPRIKA_API_V1}/sync/recipe/${uid}/`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${this.basicAuth}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get recipe: ${response.status} - ${text}`);
    }

    const data = await response.json() as { result: Record<string, unknown> };
    return data.result;
  }

  /**
   * Delete a recipe by marking it as trashed
   */
  async deleteRecipe(uid: string): Promise<void> {
    // First get the existing recipe
    const existing = await this.getRecipe(uid);

    // Mark it as trashed
    const recipe = {
      ...existing,
      in_trash: true,
    };

    // Gzip compress and upload
    const recipeJson = JSON.stringify(recipe);
    const compressedData = await this.gzipCompress(recipeJson);

    const formData = new FormData();
    const blob = new Blob([compressedData], { type: 'application/gzip' });
    formData.append('data', blob, `${uid}.paprikarecipe`);

    const response = await fetch(`${PAPRIKA_API_V1}/sync/recipe/${uid}/`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${this.basicAuth}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to delete recipe: ${response.status} - ${text}`);
    }
  }

  /**
   * Ensure credentials are valid (test on first use)
   */
  private authenticated = false;
  private async ensureAuthenticated(): Promise<void> {
    if (!this.authenticated) {
      await this.authenticate();
      this.authenticated = true;
    }
  }

  /**
   * Generate a UUID for the recipe (uppercase to match Paprika format)
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16).toUpperCase();
    });
  }

  /**
   * Generate a hash for the recipe (uppercase to match Paprika format)
   */
  private generateHash(): string {
    return Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16).toUpperCase()
    ).join('');
  }

  /**
   * Gzip compress data using CompressionStream
   */
  private async gzipCompress(data: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const inputBytes = encoder.encode(data);

    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(inputBytes);
    writer.close();

    const compressedChunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) compressedChunks.push(value);
    }

    // Combine chunks
    const totalLength = compressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of compressedChunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * Create a new recipe from extracted data
   * Returns object with recipe name and Paprika API response for debugging
   */
  async createRecipe(extracted: ExtractedRecipe): Promise<{ name: string; paprikaResponse: string }> {
    // V2 API with Bearer token - no need for V1 auth

    const uid = this.generateUUID();
    // Paprika uses "YYYY-MM-DD HH:mm:ss" format
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    // Build the full recipe object that Paprika expects
    const recipe: PaprikaRecipe = {
      uid,
      name: extracted.name,
      ingredients: extracted.ingredients,
      directions: extracted.directions,
      description: '',
      notes: extracted.notes,
      nutritional_info: '',
      prep_time: extracted.prep_time,
      cook_time: extracted.cook_time,
      total_time: '',
      difficulty: '',
      servings: extracted.servings,
      rating: 0,
      source: extracted.source,
      source_url: extracted.source_url || '',
      photo: null,
      photo_hash: null,
      photo_large: null,
      photo_url: null,
      image_url: extracted.image_url || null,
      categories: [],
      hash: this.generateHash(),
      created: now,
      on_favorites: false,
      on_grocery_list: false,
      in_trash: false,
      is_pinned: false,
      scale: null,
    };

    console.log(`Creating recipe with UID: ${uid}`);
    console.log(`Recipe name: ${recipe.name}`);

    // Gzip compress the recipe JSON (matching Python library format)
    const recipeJson = JSON.stringify(recipe);
    const compressedData = await this.gzipCompress(recipeJson);

    console.log(`Compressed size: ${compressedData.length} bytes`);

    // Create multipart form data with the gzipped recipe
    const formData = new FormData();
    const blob = new Blob([compressedData], { type: 'application/gzip' });
    formData.append('data', blob, `${uid}.paprikarecipe`);

    // Try V1 API with gzip format and Basic Auth
    const response = await fetch(`${PAPRIKA_API_V1}/sync/recipe/${uid}/`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${this.basicAuth}`,
      },
      body: formData,
    });

    const responseText = await response.text();
    console.log(`Paprika API response status: ${response.status}`);
    console.log(`Paprika API response body: ${responseText}`);

    if (!response.ok) {
      throw new Error(`Failed to create recipe: ${response.status} - ${responseText}`);
    }

    return { name: recipe.name, paprikaResponse: responseText };
  }
}
