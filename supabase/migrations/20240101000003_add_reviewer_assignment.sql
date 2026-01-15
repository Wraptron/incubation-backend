-- Add reviewer_id field to startup_applications table
-- This allows assigning a reviewer to an application
ALTER TABLE public.startup_applications
ADD COLUMN IF NOT EXISTS reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create index for reviewer_id
CREATE INDEX IF NOT EXISTS idx_startup_applications_reviewer_id ON public.startup_applications(reviewer_id);

-- Drop existing policies that might conflict (if they exist)
DROP POLICY IF EXISTS "Reviewers can view assigned applications" ON public.startup_applications;
DROP POLICY IF EXISTS "Managers can assign reviewers" ON public.startup_applications;
DROP POLICY IF EXISTS "Reviewers can update assigned applications" ON public.startup_applications;

-- Allow reviewers to view applications assigned to them
-- Note: Managers can view all via service role key in backend
CREATE POLICY "Reviewers can view assigned applications"
  ON public.startup_applications FOR SELECT
  USING (
    reviewer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Allow managers to update applications (including reviewer assignment)
-- Note: Backend uses service role key, so this is mainly for direct database access
CREATE POLICY "Managers can update applications"
  ON public.startup_applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Allow reviewers to update status of assigned applications
CREATE POLICY "Reviewers can update assigned applications"
  ON public.startup_applications FOR UPDATE
  USING (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'reviewer'
    )
  );
