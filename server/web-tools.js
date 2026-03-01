/**
 * AMS Web Tools - Web search and URL fetching functionality
 */

/**
 * Search the web using DuckDuckGo
 * @param {string} query - The search query
 * @returns {Object} Search results
 */
async function webSearch(query) {
  try {
    // Use DuckDuckGo HTML search (more reliable than API)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const html = await response.text();
    const results = parseSearchResults(html);

    if (results.length === 0) {
      return {
        success: true,
        query,
        results: [],
        message: 'No results found. Try a different search query.'
      };
    }

    return {
      success: true,
      query,
      results: results.slice(0, 8), // Return top 8 results
      message: `Found ${results.length} results for "${query}"`
    };
  } catch (err) {
    return {
      success: false,
      error: `Search failed: ${err.message}`,
      query
    };
  }
}

/**
 * Parse DuckDuckGo HTML search results
 */
function parseSearchResults(html) {
  const results = [];
  
  // Match result blocks - DuckDuckGo uses <a class="result__a"> for links
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/gi;
  
  // Simpler approach: find result divs
  const resultBlocks = html.split(/class="result\s/i).slice(1);
  
  for (const block of resultBlocks) {
    // Extract URL
    const urlMatch = block.match(/href="([^"]*uddg=[^"]*)"/i) || 
                     block.match(/href="(https?:\/\/[^"]*)"/i);
    
    // Extract title
    const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</i);
    
    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([^<]+)/i);

    if (urlMatch && titleMatch) {
      let url = urlMatch[1];
      
      // Decode DuckDuckGo redirect URL
      if (url.includes('uddg=')) {
        const uddgMatch = url.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          url = decodeURIComponent(uddgMatch[1]);
        }
      }

      results.push({
        title: decodeHtmlEntities(titleMatch[1].trim()),
        url: url,
        snippet: snippetMatch ? decodeHtmlEntities(snippetMatch[1].trim()) : ''
      });
    }
  }

  return results;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, ''); // Strip remaining HTML tags
}

/**
 * Fetch and extract content from a URL
 * @param {string} url - The URL to fetch
 * @returns {Object} Fetched content
 */
async function fetchUrl(url) {
  try {
    // Validate URL
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { success: false, error: 'Invalid URL protocol. Use http or https.' };
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000
    });

    if (!response.ok) {
      return { success: false, error: `Failed to fetch: HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    let content = await response.text();

    // If HTML, extract text content
    if (contentType.includes('text/html')) {
      content = extractTextFromHtml(content);
    }

    // Truncate if too long
    const maxLength = 15000;
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '\n\n[Content truncated...]';
    }

    return {
      success: true,
      url,
      contentType: contentType.split(';')[0],
      content,
      length: content.length
    };
  } catch (err) {
    return {
      success: false,
      error: `Fetch failed: ${err.message}`,
      url
    };
  }
}

/**
 * Extract readable text content from HTML
 */
function extractTextFromHtml(html) {
  // Remove script and style tags
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Extract main content areas
  const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                    text.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                    text.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  
  if (mainMatch) {
    text = mainMatch[1];
  }

  // Convert common elements to text
  text = text
    .replace(/<h[1-6][^>]*>([^<]*)<\/h[1-6]>/gi, '\n\n## $1\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)')
    .replace(/<code[^>]*>([^<]*)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
    .replace(/<[^>]+>/g, '') // Remove remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (title) {
    text = `# ${title}\n\n${text}`;
  }

  return text;
}

module.exports = { webSearch, fetchUrl };
