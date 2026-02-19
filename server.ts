import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("sync.db");
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS synced_posts (
      post_id TEXT PRIMARY KEY,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
} catch (err) {
  console.error("Database Initialization Error:", err);
}

const getSetting = (key: string) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value || process.env[key];
};

const setSetting = (key: string, value: string) => {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
};

const app = express();
app.use(express.json());

export { app };

const PORT = 3000;

// Gemini Setup
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function extractMovieDetails(content: string) {
  const model = "gemini-3-flash-preview";
  const prompt = `
    Extract movie details from the following Blogger post content. 
    Return the data in the following format:
    🎬 Title
    ⭐ IMDb: Rating (or N/A)
    📅 Release Date: YYYY-MM-DD (or N/A)
    🎭 Genre: Genres
    🌍 Language: Language
    🎬 Director: Director Name
    💰 Budget: Budget (or N/A)
    🎭 Cast: Cast Names
    📝 Plot: A short summary of the plot.

    Content:
    ${content}
  `;

  try {
    const response = await genAI.models.generateContent({
      model: model,
      contents: [{ parts: [{ text: prompt }] }],
    });
    return response.text || "Failed to extract details.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Error extracting details.";
  }
}

async function sendToTelegram(message: string, url: string, imageUrl?: string) {
  const botToken = getSetting("TELEGRAM_BOT_TOKEN");
  const chatId = getSetting("TELEGRAM_CHANNEL_ID");

  if (!botToken || !chatId) {
    throw new Error("Telegram credentials missing");
  }

  const fullMessage = `${message}\n\n🔗 Download Now: ${url}`;
  
  let telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let body: any = {
    chat_id: chatId,
    text: fullMessage,
    parse_mode: "HTML",
  };

  if (imageUrl) {
    telegramUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;
    body = {
      chat_id: chatId,
      photo: imageUrl,
      caption: fullMessage,
      parse_mode: "HTML",
    };
  }

  const response = await fetch(telegramUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Telegram API Error:", errorData);
    // If photo fails (e.g. invalid URL), try sending as text only
    if (imageUrl) {
      console.log("Retrying as text message...");
      return sendToTelegram(message, url);
    }
    throw new Error(`Telegram failed: ${JSON.stringify(errorData)}`);
  }
}

app.get("/api/status", (req, res) => {
  const countRow = db.prepare("SELECT COUNT(*) as count FROM synced_posts").get() as { count: number };
  const recentPosts = db.prepare("SELECT post_id, synced_at FROM synced_posts ORDER BY synced_at DESC LIMIT 5").all();
  
  const settings = {
    BLOGGER_API_KEY: getSetting("BLOGGER_API_KEY") || "",
    BLOGGER_BLOG_ID: getSetting("BLOGGER_BLOG_ID") || "",
    TELEGRAM_BOT_TOKEN: getSetting("TELEGRAM_BOT_TOKEN") || "",
    TELEGRAM_CHANNEL_ID: getSetting("TELEGRAM_CHANNEL_ID") || "",
  };

  res.json({ 
    syncedCount: countRow.count,
    recentPosts,
    settings,
    configured: !!(settings.BLOGGER_API_KEY && settings.BLOGGER_BLOG_ID && settings.TELEGRAM_BOT_TOKEN && settings.TELEGRAM_CHANNEL_ID)
  });
});

app.post("/api/sync", async (req, res) => {
  try {
    // Allow credentials to be passed in the request body (from client localStorage)
    const { BLOGGER_API_KEY, BLOGGER_BLOG_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID } = req.body;
    
    // Temporarily override settings for this request if provided
    const apiKey = BLOGGER_API_KEY || getSetting("BLOGGER_API_KEY");
    const blogId = BLOGGER_BLOG_ID || getSetting("BLOGGER_BLOG_ID");
    const botToken = TELEGRAM_BOT_TOKEN || getSetting("TELEGRAM_BOT_TOKEN");
    const chatId = TELEGRAM_CHANNEL_ID || getSetting("TELEGRAM_CHANNEL_ID");

    if (!apiKey || !blogId || !botToken || !chatId) {
      return res.status(400).json({ error: "Missing configuration" });
    }

    const bloggerUrl = `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts?key=${apiKey}&maxResults=10`;
    const response = await fetch(bloggerUrl);
    const data = await response.json();

    if (!data.items) return res.json({ message: "No posts found", synced: 0 });

    let syncedCount = 0;
    for (const post of data.items) {
      const exists = db.prepare("SELECT 1 FROM synced_posts WHERE post_id = ?").get(post.id);
      
      if (!exists) {
        console.log(`Syncing post: ${post.title}`);
        
        let imageUrl = post.images?.[0]?.url;
        if (!imageUrl) {
          const imgMatch = post.content.match(/<img[^>]+src="([^">]+)"/);
          if (imgMatch) imageUrl = imgMatch[1];
        }

        const details = await extractMovieDetails(post.content);
        
        // Manual send to Telegram using provided tokens
        const fullMessage = `${details}\n\n🔗 Download Now: ${post.url}`;
        let telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        let body: any = { chat_id: chatId, text: fullMessage, parse_mode: "HTML" };

        if (imageUrl) {
          telegramUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;
          body = { chat_id: chatId, photo: imageUrl, caption: fullMessage, parse_mode: "HTML" };
        }

        const telRes = await fetch(telegramUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (telRes.ok) {
          db.prepare("INSERT INTO synced_posts (post_id) VALUES (?)").run(post.id);
          syncedCount++;
        }
      }
    }
    res.json({ message: "Sync complete", synced: syncedCount });
  } catch (error: any) {
    console.error("Sync Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Vite middleware setup
async function setupVite(app: express.Express) {
  if (process.env.NODE_ENV !== "production" && !process.env.NETLIFY) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (!process.env.NETLIFY) {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }
}

async function startServer() {
  await setupVite(app);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== "production" && !process.env.NETLIFY) {
  startServer();
}
