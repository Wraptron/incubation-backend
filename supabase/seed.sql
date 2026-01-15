-- Seed file for development/testing
-- This creates a test manager user for login

-- Note: In production, you would create users through Supabase Auth API or dashboard
-- This is a placeholder for local development

-- Example SQL to create a test manager (run this manually in Supabase Studio SQL Editor):
-- 
-- 1. First, create the user in auth.users (this is typically done via Supabase Auth API)
-- 2. Then update their profile:
--
-- UPDATE user_profiles 
-- SET role = 'manager' 
-- WHERE id = '<user-id-from-auth-users>';
--
-- Or insert directly if user already exists:
--
-- INSERT INTO user_profiles (id, role, full_name)
-- VALUES ('<user-id>', 'manager', 'Admin User')
-- ON CONFLICT (id) DO UPDATE SET role = 'manager';
