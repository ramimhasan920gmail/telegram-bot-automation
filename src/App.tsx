import React, { useState, useEffect } from "react";
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Send, 
  LayoutDashboard,
  Settings,
  History,
  ExternalLink
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Status {
  syncedCount: number;
  recentPosts: Array<{ post_id: string; synced_at: string }>;
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [formData, setFormData] = useState({
    BLOGGER_API_KEY: "",
    BLOGGER_BLOG_ID: "",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_CHANNEL_ID: "",
  });

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem("blogger_sync_settings");
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setFormData(parsed);
      } catch (e) {
        console.error("Failed to parse saved settings");
      }
    }
    fetchStatus();
  }, []);

  // Save settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("blogger_sync_settings", JSON.stringify(formData));
  }, [formData]);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("Failed to fetch status", err);
    }
  };

  const handleSync = async () => {
    if (!formData.BLOGGER_API_KEY || !formData.BLOGGER_BLOG_ID || !formData.TELEGRAM_BOT_TOKEN || !formData.TELEGRAM_CHANNEL_ID) {
      setMessage({ text: "Please fill in all configuration fields first.", type: "error" });
      return;
    }

    setSyncing(true);
    setMessage({ text: "Checking for new posts...", type: "info" });
    try {
      const res = await fetch("/api/sync", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (res.ok) {
        if (data.synced > 0) {
          setMessage({ 
            text: `Sync complete! ${data.synced} new posts sent to Telegram.`, 
            type: "success" 
          });
        } else {
          setMessage({ text: "No new posts found.", type: "info" });
        }
        fetchStatus();
      } else {
        setMessage({ text: data.error || "Sync failed", type: "error" });
      }
    } catch (err) {
      setMessage({ text: "Network error during sync", type: "error" });
    } finally {
      setSyncing(false);
    }
  };

  // Client-side auto-sync every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const isConfigured = formData.BLOGGER_API_KEY && formData.BLOGGER_BLOG_ID && formData.TELEGRAM_BOT_TOKEN && formData.TELEGRAM_CHANNEL_ID;
      if (isConfigured && !syncing) {
        console.log("Auto-syncing...");
        handleSync();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [formData, syncing]);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: "Settings updated! These are saved in your browser and will be used for all syncs.", type: "success" });
    // Trigger a status refresh to update the UI if needed
    fetchStatus();
  };

  const isConfigured = !!(formData.BLOGGER_API_KEY && formData.BLOGGER_BLOG_ID && formData.TELEGRAM_BOT_TOKEN && formData.TELEGRAM_CHANNEL_ID);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-indigo-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Send className="text-white w-5 h-5" />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">BloggerSync</h1>
          </div>
          <div className="flex items-center gap-4">
            {isConfigured ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Configured
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
                <AlertCircle className="w-3.5 h-3.5" />
                Setup Required
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Left Column: Stats & Action */}
          <div className="md:col-span-2 space-y-8">
            <section>
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <LayoutDashboard className="w-6 h-6 text-indigo-600" />
                Dashboard
              </h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm"
                >
                  <p className="text-sm font-medium text-gray-500 mb-1">Total Synced Posts</p>
                  <p className="text-4xl font-bold text-indigo-600">{status?.syncedCount ?? "..."}</p>
                </motion.div>

                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-500 mb-1">Last Sync Status</p>
                    <p className="text-sm font-medium text-gray-900">
                      {syncing ? "Syncing now..." : "Idle"}
                    </p>
                  </div>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className={`mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-all ${
                    syncing 
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed" 
                      : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] shadow-lg shadow-indigo-200"
                  }`}
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing..." : "Sync Now"}
                </button>
                </motion.div>
              </div>
            </section>

            <AnimatePresence mode="wait">
              {message && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`p-4 rounded-xl border flex items-start gap-3 ${
                    message.type === "success" ? "bg-emerald-50 border-emerald-100 text-emerald-800" :
                    message.type === "error" ? "bg-rose-50 border-rose-100 text-rose-800" :
                    "bg-indigo-50 border-indigo-100 text-indigo-800"
                  }`}
                >
                  {message.type === "success" ? <CheckCircle2 className="w-5 h-5 shrink-0" /> :
                   message.type === "error" ? <AlertCircle className="w-5 h-5 shrink-0" /> :
                   <RefreshCw className="w-5 h-5 shrink-0 animate-spin" />}
                  <p className="text-sm font-medium">{message.text}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold flex items-center gap-2">
                  <History className="w-5 h-5 text-indigo-600" />
                  Recent Activity
                </h3>
              </div>
              <div className="divide-y divide-gray-100">
                {status?.recentPosts && status.recentPosts.length > 0 ? (
                  status.recentPosts.map((post) => (
                    <div key={post.post_id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-emerald-50 rounded-full flex items-center justify-center">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">Post ID: {post.post_id}</p>
                          <p className="text-xs text-gray-500">{new Date(post.synced_at).toLocaleString()}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded uppercase">Synced</span>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center py-12">
                    <p className="text-sm text-gray-500 italic">No recent activity to show. Click "Sync Now" to start.</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right Column: Configuration Form */}
          <div className="space-y-8">
            <section className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-600" />
                Configuration
              </h3>
              
              <form onSubmit={handleSaveSettings} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Blogger API Key</label>
                  <input
                    type="password"
                    value={formData.BLOGGER_API_KEY}
                    onChange={(e) => setFormData({ ...formData, BLOGGER_API_KEY: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Enter API Key"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Blogger Blog ID</label>
                  <input
                    type="text"
                    value={formData.BLOGGER_BLOG_ID}
                    onChange={(e) => setFormData({ ...formData, BLOGGER_BLOG_ID: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Enter Blog ID"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Telegram Bot Token</label>
                  <input
                    type="password"
                    value={formData.TELEGRAM_BOT_TOKEN}
                    onChange={(e) => setFormData({ ...formData, TELEGRAM_BOT_TOKEN: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Enter Bot Token"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Telegram Channel ID</label>
                  <input
                    type="text"
                    value={formData.TELEGRAM_CHANNEL_ID}
                    onChange={(e) => setFormData({ ...formData, TELEGRAM_CHANNEL_ID: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="@channel or -100..."
                  />
                </div>
                
                <button
                  type="submit"
                  className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors"
                >
                  Update Settings
                </button>
              </form>
              
              <div className="mt-8 pt-6 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-900 mb-2">How it works</h4>
                <ol className="text-xs text-gray-500 space-y-2 list-decimal ml-4">
                  <li>Auto-syncs every 30 seconds.</li>
                  <li>Fetches latest 10 posts from Blogger.</li>
                  <li>Uses Gemini AI to extract movie metadata.</li>
                  <li>Sends with image to Telegram Channel.</li>
                </ol>
              </div>
            </section>

            <section className="bg-indigo-600 p-6 rounded-2xl text-white shadow-xl shadow-indigo-200">
              <h3 className="font-bold mb-2">Need Help?</h3>
              <p className="text-xs text-indigo-100 mb-4 leading-relaxed">
                Make sure your Telegram Bot is an administrator in your channel to post messages.
              </p>
              <p className="text-[10px] text-indigo-200 mb-4 leading-relaxed italic">
                Note: On Netlify, the local database is ephemeral. For permanent sync history, consider connecting a remote database.
              </p>
              <a 
                href="https://t.me/BotFather" 
                target="_blank" 
                className="inline-flex items-center gap-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg transition-colors"
              >
                Open BotFather
                <ExternalLink className="w-3 h-3" />
              </a>
            </section>
          </div>

        </div>
      </main>
    </div>
  );
}
