import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vrreeybsuhucjtgduiuw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZycmVleWJzdWh1Y2p0Z2R1aXV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0Mjc2MzEsImV4cCI6MjA5NzAwMzYzMX0.6C4BTHhF_eG20N5T6lXYql_zyG9T11EBQ_b4s_rybJQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});
