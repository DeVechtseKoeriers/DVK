const SUPABASE_URL = "https://awjmjhvfigvcbpnabzes.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3am1qaHZmaWd2Y2JwbmFiemVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MTY3MDYsImV4cCI6MjA4NjQ5MjcwNn0.As9vdyAGs1elV72X1iPnmTZTs17JTRQBeFfR8qPYg2s";

window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

console.log("Supabase verbonden");
