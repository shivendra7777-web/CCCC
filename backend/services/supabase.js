import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Current file ka path nikalo
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly 'backend' folder ke andar .env file dhundho
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// 🔍 DEBUG: Terminal me check karo ki values aa rahi hain ya nahi
console.log("🔍 SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("🔍 SECRET KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "Loaded (Hidden)" : "Missing!");

if (!process.env.SUPABASE_URL) {
    console.error("❌ ERROR: .env file me SUPABASE_URL nahi mila! Check your .env file in the 'backend' folder.");
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);