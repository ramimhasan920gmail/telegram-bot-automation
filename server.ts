import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import dotenv from "dotenv";

dotenv.config();

const getDirname = () => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch (e) {
    return process.cwd();
  }
};

const __dirname = getDirname();

let db: Database.Database;
try {
  const isNetlify = process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME;
  const dbPath = isNetlify ? "/tmp/sync.db" : path.join(__dirname, "sync.db");
  
  // Ensure directory exists for local dev
  if (!isNetlify && !fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  
  db = new Database(dbPath);
} catch (err) {
  console.error("Failed to initialize file-based database, using in-memory:", err);
  db = new Database(":memory:");
}

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

async function extractMovieDetails(post: any) {
  // Simple extraction without Gemini AI
  const title = post.title || "New Movie Post";
  const content = post.content || "";
  const snippet = content.replace(/<[^>]*>/g, "").substring(0, 200) + "...";
  
  return `<b>${title}</b>\n\n${snippet}`;
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
  try {
    const countRow = db.prepare("SELECT COUNT(*) as count FROM synced_posts").get() as { count: number };
    const recentPosts = db.prepare("SELECT post_id, synced_at FROM synced_posts ORDER BY synced_at DESC LIMIT 5").all();
    
    res.json({ 
      syncedCount: countRow.count,
      recentPosts,
      dbStatus: "ok"
    });
  } catch (err: any) {
    console.error("Status DB Error:", err);
    res.json({ 
      syncedCount: 0,
      recentPosts: [],
      dbStatus: "error",
      dbError: err.message
    });
  }
});

app.post("/api/sync", async (req, res) => {
  try {
    console.log("Sync request received with body keys:", Object.keys(req.body));
    const { BLOGGER_API_KEY, BLOGGER_BLOG_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID } = req.body;
    
    const apiKey = BLOGGER_API_KEY || getSetting("BLOGGER_API_KEY");
    const blogId = BLOGGER_BLOG_ID || getSetting("BLOGGER_BLOG_ID");
    const botToken = TELEGRAM_BOT_TOKEN || getSetting("TELEGRAM_BOT_TOKEN");
    const chatId = TELEGRAM_CHANNEL_ID || getSetting("TELEGRAM_CHANNEL_ID");

    if (!apiKey || !blogId || !botToken || !chatId) {
      console.error("Sync failed: Missing configuration", { apiKey: !!apiKey, blogId: !!blogId, botToken: !!botToken, chatId: !!chatId });
      return res.status(400).json({ error: "Missing configuration. Please check your settings." });
    }

    const bloggerUrl = `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts?key=${apiKey}&maxResults=10`;
    console.log("Fetching from Blogger...");
    const response = await fetch(bloggerUrl);
    const data = await response.json();

    if (data.error) {
      console.error("Blogger API Error:", data.error);
      return res.status(400).json({ error: `Blogger API Error: ${data.error.message || "Unknown error"}` });
    }

    if (!data.items) {
      console.log("No posts found in Blogger response.");
      return res.json({ message: "No posts found", synced: 0 });
    }

    console.log(`Found ${data.items.length} posts. Processing top 3...`);
    let syncedCount = 0;
    const postsToProcess = data.items.slice(0, 3);
    
    for (const post of postsToProcess) {
      try {
        const exists = db.prepare("SELECT 1 FROM synced_posts WHERE post_id = ?").get(post.id);
        
        if (!exists) {
          console.log(`Syncing post: ${post.title} (${post.id})`);
          
          let imageUrl = post.images?.[0]?.url;
          if (!imageUrl) {
            const imgMatch = post.content.match(/<img[^>]+src="([^">]+)"/);
            if (imgMatch) imageUrl = imgMatch[1];
          }

          console.log("Formatting post details...");
          const details = await extractMovieDetails(post);
          
          const fullMessage = `${details}\n\n🔗 Download Now: ${post.url}`;
          let telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
          let body: any = { chat_id: chatId, text: fullMessage, parse_mode: "HTML" };

          if (imageUrl) {
            telegramUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;
            body = { chat_id: chatId, photo: imageUrl, caption: fullMessage, parse_mode: "HTML" };
          }

          console.log("Sending to Telegram...");
          const telRes = await fetch(telegramUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (telRes.ok) {
            console.log("Successfully sent to Telegram.");
            db.prepare("INSERT INTO synced_posts (post_id) VALUES (?)").run(post.id);
            syncedCount++;
          } else {
            const telError = await telRes.json();
            console.error("Telegram Send Failed:", telError);
            // If it's a photo error, try text only as fallback
            if (imageUrl) {
              console.log("Retrying Telegram as text only...");
              const textOnlyBody = { chat_id: chatId, text: fullMessage, parse_mode: "HTML" };
              const textOnlyRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(textOnlyBody),
              });
              if (textOnlyRes.ok) {
                db.prepare("INSERT INTO synced_posts (post_id) VALUES (?)").run(post.id);
                syncedCount++;
              }
            }
          }
        }
      } catch (postError) {
        console.error(`Error processing post ${post.id}:`, postError);
      }
    }
    res.json({ message: "Sync complete", synced: syncedCount });
  } catch (error: any) {
    console.error("Global Sync Error:", error);
    res.status(500).json({ error: `Sync failed: ${error.message}` });
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
