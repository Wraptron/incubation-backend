-- Create a function to check if current user is a manager (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'manager'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Allow managers to view all user profiles (needed for reviewer assignment)
-- This policy uses the SECURITY DEFINER function to avoid circular dependency
CREATE POLICY "Managers can view all user profiles"
  ON public.user_profiles FOR SELECT
  USING (public.is_manager());
