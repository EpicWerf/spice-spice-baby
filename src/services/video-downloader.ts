/**
 * Video downloader service for TikTok and Instagram
 * Uses RapidAPI services to download videos
 */

export type VideoPlatform = 'tiktok' | 'instagram' | 'unknown';

export interface VideoDownloadResult {
  platform: VideoPlatform;
  videoUrl: string;
  title?: string;
  caption?: string;  // Full caption/description text
  author?: string;
  thumbnail?: string;
}

/**
 * Detect which platform a URL belongs to
 */
export function detectPlatform(url: string): VideoPlatform {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('tiktok.com') || lowerUrl.includes('vm.tiktok.com')) {
    return 'tiktok';
  }

  if (lowerUrl.includes('instagram.com')) {
    return 'instagram';
  }

  return 'unknown';
}

/**
 * Check if a URL is a supported video platform
 */
export function isVideoUrl(url: string): boolean {
  return detectPlatform(url) !== 'unknown';
}

/**
 * Download video info from TikTok
 */
async function downloadTikTokVideo(url: string, apiKey: string): Promise<VideoDownloadResult> {
  const response = await fetch(
    `https://tiktok-download-video-no-watermark.p.rapidapi.com/tiktok/info?url=${encodeURIComponent(url)}`,
    {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'tiktok-download-video-no-watermark.p.rapidapi.com',
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TikTok API error: ${response.status} - ${text}`);
  }

  const data = await response.json() as {
    data?: {
      play?: string;
      wmplay?: string;
      title?: string;
      desc?: string;  // Full description/caption
      author?: { nickname?: string };
      cover?: string;
    };
  };

  if (!data.data?.play && !data.data?.wmplay) {
    throw new Error('No video URL found in TikTok response');
  }

  return {
    platform: 'tiktok',
    videoUrl: data.data.play || data.data.wmplay || '',
    title: data.data.title,
    caption: data.data.desc || data.data.title,  // Use description, fall back to title
    author: data.data.author?.nickname,
    thumbnail: data.data.cover,
  };
}

/**
 * Download video info from Instagram
 */
async function downloadInstagramVideo(url: string, apiKey: string): Promise<VideoDownloadResult> {
  const response = await fetch(
    `https://instagram-reels-downloader2.p.rapidapi.com/download-reels?url=${encodeURIComponent(url)}`,
    {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'instagram-reels-downloader2.p.rapidapi.com',
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instagram API error: ${response.status} - ${text}`);
  }

  const data = await response.json() as {
    status?: string;
    data?: {
      video_url?: string;
      thumbnail_url?: string;
      caption?: string;
      owner?: { username?: string };
    };
  };

  if (!data.data?.video_url) {
    throw new Error('No video URL found in Instagram response');
  }

  return {
    platform: 'instagram',
    videoUrl: data.data.video_url,
    title: data.data.caption?.substring(0, 100),
    caption: data.data.caption,  // Full caption text
    author: data.data.owner?.username,
    thumbnail: data.data.thumbnail_url,
  };
}

/**
 * Download video from any supported platform
 */
export async function downloadVideo(url: string, apiKey: string): Promise<VideoDownloadResult> {
  const platform = detectPlatform(url);

  switch (platform) {
    case 'tiktok':
      return downloadTikTokVideo(url, apiKey);
    case 'instagram':
      return downloadInstagramVideo(url, apiKey);
    default:
      throw new Error(`Unsupported video platform: ${url}`);
  }
}

/**
 * Fetch the actual video content as ArrayBuffer
 */
export async function fetchVideoContent(videoUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(videoUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch video: ${response.status}`);
  }

  return response.arrayBuffer();
}
