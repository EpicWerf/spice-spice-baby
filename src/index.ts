import type { Env, ProcessingResult, ExtractedRecipe } from './types';
import { PaprikaClient } from './services/paprika';
import { ClaudeVisionClient } from './services/claude';
import { parseEmailContent } from './services/email-parser';
import { downloadVideo, fetchVideoContent } from './services/video-downloader';
import { transcribeAudio } from './services/transcriber';

export default {
  /**
   * Handle incoming emails
   * Supports: images, PDFs, and URLs in email body
   */
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log(`Received email from: ${message.from}`);
    console.log(`Subject: ${message.headers.get('subject') || '(no subject)'}`);

    try {
      // Parse the email and extract all content
      const { images, pdfs, urls, videos } = await parseEmailContent(message.raw);

      const totalItems = images.length + pdfs.length + urls.length + videos.length;
      if (totalItems === 0) {
        console.log('No processable content found in email');
        return;
      }

      console.log(`Found: ${images.length} image(s), ${pdfs.length} PDF(s), ${urls.length} URL(s), ${videos.length} video(s)`);

      // Initialize clients
      const claude = new ClaudeVisionClient(env.ANTHROPIC_API_KEY);
      const paprika = new PaprikaClient(env.PAPRIKA_EMAIL, env.PAPRIKA_PASSWORD);

      const results: ProcessingResult[] = [];

      // Helper function to save a recipe to Paprika
      const saveRecipe = async (recipe: ExtractedRecipe, sourceDesc: string): Promise<void> => {
        console.log(`Extracted recipe: ${recipe.name}`);

        if (recipe.name === 'UNREADABLE' || recipe.name === 'NO_RECIPE') {
          results.push({
            success: false,
            error: `Could not extract recipe from ${sourceDesc}: ${recipe.notes}`,
          });
          return;
        }

        const { name: recipeName } = await paprika.createRecipe(recipe);
        console.log(`Created recipe in Paprika: ${recipeName}`);
        results.push({ success: true, recipeName });
      };

      // Process all images together as ONE recipe (e.g., page 1 and page 2)
      if (images.length > 0) {
        console.log(`Processing ${images.length} image(s) as a single recipe`);
        try {
          const imageData = images.map((img) => ({
            data: img.data as ArrayBuffer,
            mimeType: img.mimeType || 'image/jpeg',
          }));
          const recipe = await claude.extractFromMultipleImages(imageData);
          await saveRecipe(recipe, `${images.length} image(s)`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('Error processing images:', errorMessage);
          results.push({ success: false, error: errorMessage });
        }
      }

      // Process each PDF individually (may contain multiple recipes)
      for (const pdf of pdfs) {
        console.log(`Processing PDF: ${pdf.filename || 'document.pdf'}`);
        try {
          const recipes = await claude.extractFromPDF(pdf.data as ArrayBuffer);
          for (const recipe of recipes) {
            await saveRecipe(recipe, pdf.filename || 'PDF');
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('Error processing PDF:', errorMessage);
          results.push({ success: false, error: errorMessage });
        }
      }

      // Process each URL individually
      for (const urlItem of urls) {
        const url = urlItem.data as string;
        console.log(`Processing URL: ${url}`);
        try {
          const recipe = await claude.extractFromURL(url);
          await saveRecipe(recipe, url);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('Error processing URL:', errorMessage);
          results.push({ success: false, error: errorMessage });
        }
      }

      // Process each video URL (TikTok/Instagram)
      for (const videoItem of videos) {
        const url = videoItem.data as string;
        const platform = videoItem.platform || 'unknown';
        console.log(`Processing ${platform} video: ${url}`);
        try {
          // Download video info
          const videoInfo = await downloadVideo(url, env.RAPIDAPI_KEY);
          console.log(`Got video URL: ${videoInfo.videoUrl.substring(0, 50)}...`);

          // Fetch video content
          const videoContent = await fetchVideoContent(videoInfo.videoUrl);
          console.log(`Downloaded video: ${videoContent.byteLength} bytes`);

          // Transcribe audio
          const transcription = await transcribeAudio(env.AI, videoContent);
          console.log(`Transcribed: ${transcription.text.substring(0, 100)}...`);

          // Extract recipe from transcript and caption
          const recipe = await claude.extractFromTranscript(
            transcription.text,
            url,
            videoInfo.author,
            videoInfo.caption  // Include caption for better extraction
          );
          await saveRecipe(recipe, `${platform} video`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Error processing ${platform} video:`, errorMessage);
          results.push({ success: false, error: errorMessage });
        }
      }

      // Log summary
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      console.log(`Processing complete: ${successful.length} succeeded, ${failed.length} failed`);

      if (successful.length > 0) {
        console.log('Added recipes:', successful.map((r) => r.recipeName).join(', '));
      }

      if (failed.length > 0) {
        console.log('Failed:', failed.map((r) => r.error).join('; '));
      }
    } catch (error) {
      console.error('Fatal error processing email:', error);
      throw error;
    }
  },

  /**
   * HTTP handler for health checks and manual testing
   */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'spice-spice-baby' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Test endpoint - verify Paprika authentication
    if (url.pathname === '/test-paprika' && request.method === 'POST') {
      try {
        const paprika = new PaprikaClient(env.PAPRIKA_EMAIL, env.PAPRIKA_PASSWORD);
        await paprika.authenticate();
        return new Response(JSON.stringify({ status: 'ok', message: 'Paprika authentication successful' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ status: 'error', message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Debug endpoint - list all recipe UIDs from Paprika
    if (url.pathname === '/list-recipes' && request.method === 'GET') {
      try {
        const paprika = new PaprikaClient(env.PAPRIKA_EMAIL, env.PAPRIKA_PASSWORD);
        const recipes = await paprika.listRecipes();

        return new Response(JSON.stringify({
          status: 'ok',
          totalRecipes: recipes.length,
          recipes: recipes
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ status: 'error', message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Get recipe details by UID
    if (url.pathname.startsWith('/recipe/') && request.method === 'GET') {
      try {
        const uid = url.pathname.replace('/recipe/', '');
        const paprika = new PaprikaClient(env.PAPRIKA_EMAIL, env.PAPRIKA_PASSWORD);
        const recipe = await paprika.getRecipe(uid);

        return new Response(JSON.stringify({
          status: 'ok',
          recipe
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ status: 'error', message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Delete recipe by UID
    if (url.pathname.startsWith('/delete-recipe/') && request.method === 'DELETE') {
      try {
        const uid = url.pathname.replace('/delete-recipe/', '');
        const paprika = new PaprikaClient(env.PAPRIKA_EMAIL, env.PAPRIKA_PASSWORD);

        // Get recipe name first for confirmation
        const recipe = await paprika.getRecipe(uid);
        const name = recipe.name as string;

        await paprika.deleteRecipe(uid);

        return new Response(JSON.stringify({
          status: 'ok',
          message: `Recipe "${name}" moved to trash`
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ status: 'error', message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Test endpoint - extract recipe from uploaded image
    if (url.pathname === '/test-extract' && request.method === 'POST') {
      try {
        const contentType = request.headers.get('content-type') || 'image/jpeg';
        const imageData = await request.arrayBuffer();

        const claude = new ClaudeVisionClient(env.ANTHROPIC_API_KEY);
        const recipe = await claude.extractRecipe(imageData, contentType);

        return new Response(JSON.stringify({ status: 'ok', recipe }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ status: 'error', message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Test endpoint - full pipeline with uploaded image
    if (url.pathname === '/test-full' && request.method === 'POST') {
      try {
        const contentType = request.headers.get('content-type') || 'image/jpeg';
        const imageData = await request.arrayBuffer();

        const claude = new ClaudeVisionClient(env.ANTHROPIC_API_KEY);
        const recipe = await claude.extractRecipe(imageData, contentType);

        if (recipe.name === 'UNREADABLE') {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'Could not read recipe from image',
            notes: recipe.notes
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const paprika = new PaprikaClient(env.PAPRIKA_EMAIL, env.PAPRIKA_PASSWORD);
        const { name: recipeName, paprikaResponse } = await paprika.createRecipe(recipe);

        return new Response(JSON.stringify({
          status: 'ok',
          message: `Recipe "${recipeName}" added to Paprika`,
          recipe,
          paprikaResponse: JSON.parse(paprikaResponse || '{}')
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ status: 'error', message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // NEW: Test endpoint - extract recipe from URL
    if (url.pathname === '/test-url' && request.method === 'POST') {
      try {
        const body = await request.json() as { url: string };
        if (!body.url) {
          return new Response(JSON.stringify({ status: 'error', message: 'Missing url in request body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const claude = new ClaudeVisionClient(env.ANTHROPIC_API_KEY);
        const recipe = await claude.extractFromURL(body.url);

        if (recipe.name === 'NO_RECIPE') {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'No recipe found at URL',
            notes: recipe.notes
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const paprika = new PaprikaClient(env.PAPRIKA_EMAIL, env.PAPRIKA_PASSWORD);
        const { name: recipeName, paprikaResponse } = await paprika.createRecipe(recipe);

        return new Response(JSON.stringify({
          status: 'ok',
          message: `Recipe "${recipeName}" added to Paprika`,
          recipe,
          paprikaResponse: JSON.parse(paprikaResponse || '{}')
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ status: 'error', message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // NEW: Test endpoint - extract recipes from PDF
    if (url.pathname === '/test-pdf' && request.method === 'POST') {
      try {
        const pdfData = await request.arrayBuffer();

        const claude = new ClaudeVisionClient(env.ANTHROPIC_API_KEY);
        const recipes = await claude.extractFromPDF(pdfData);

        const paprika = new PaprikaClient(env.PAPRIKA_EMAIL, env.PAPRIKA_PASSWORD);
        const results: Array<{ name: string; status: string }> = [];

        for (const recipe of recipes) {
          if (recipe.name === 'UNREADABLE' || recipe.name === 'NO_RECIPE') {
            results.push({ name: recipe.name, status: 'skipped' });
            continue;
          }

          const { name: recipeName } = await paprika.createRecipe(recipe);
          results.push({ name: recipeName, status: 'created' });
        }

        return new Response(JSON.stringify({
          status: 'ok',
          message: `Processed ${recipes.length} recipe(s) from PDF`,
          results
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ status: 'error', message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // NEW: Test endpoint - extract recipe from TikTok/Instagram video
    if (url.pathname === '/test-video' && request.method === 'POST') {
      try {
        const body = await request.json() as { url: string };
        if (!body.url) {
          return new Response(JSON.stringify({ status: 'error', message: 'Missing url in request body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Step 1: Download video info
        console.log(`Downloading video info for: ${body.url}`);
        const videoInfo = await downloadVideo(body.url, env.RAPIDAPI_KEY);
        console.log(`Got video from ${videoInfo.platform}: ${videoInfo.title || 'untitled'}`);

        // Step 2: Fetch video content
        console.log(`Fetching video content...`);
        const videoContent = await fetchVideoContent(videoInfo.videoUrl);
        console.log(`Downloaded ${videoContent.byteLength} bytes`);

        // Step 3: Transcribe audio
        console.log(`Transcribing audio...`);
        const transcription = await transcribeAudio(env.AI, videoContent);
        console.log(`Transcription: ${transcription.text.substring(0, 200)}...`);

        // Step 4: Extract recipe from transcript and caption
        const claude = new ClaudeVisionClient(env.ANTHROPIC_API_KEY);
        const recipe = await claude.extractFromTranscript(
          transcription.text,
          body.url,
          videoInfo.author,
          videoInfo.caption  // Include caption for better extraction
        );

        if (recipe.name === 'NO_RECIPE') {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'No recipe found in video',
            caption: videoInfo.caption,
            transcript: transcription.text,
            notes: recipe.notes
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Step 5: Save to Paprika
        const paprika = new PaprikaClient(env.PAPRIKA_EMAIL, env.PAPRIKA_PASSWORD);
        const { name: recipeName, paprikaResponse } = await paprika.createRecipe(recipe);

        return new Response(JSON.stringify({
          status: 'ok',
          message: `Recipe "${recipeName}" added to Paprika`,
          platform: videoInfo.platform,
          videoTitle: videoInfo.title,
          author: videoInfo.author,
          caption: videoInfo.caption,
          transcript: transcription.text,
          recipe,
          paprikaResponse: JSON.parse(paprikaResponse || '{}')
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ status: 'error', message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Default response with all endpoints
    return new Response(
      JSON.stringify({
        service: 'spice-spice-baby',
        description: 'Email-to-Paprika recipe extraction agent',
        endpoints: {
          '/health': 'GET - Health check',
          '/test-paprika': 'POST - Test Paprika authentication',
          '/list-recipes': 'GET - List all recipes in Paprika',
          '/test-extract': 'POST - Extract recipe from image (send image as body)',
          '/test-full': 'POST - Full pipeline: image → extract → Paprika',
          '/test-url': 'POST - Extract recipe from URL: { "url": "https://..." }',
          '/test-pdf': 'POST - Extract recipes from PDF (send PDF as body)',
          '/test-video': 'POST - Extract recipe from TikTok/Instagram: { "url": "https://..." }',
        },
        email: 'Send emails with images, PDFs, recipe URLs, or TikTok/Instagram videos to process',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },
};
