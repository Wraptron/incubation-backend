-- Migration to support multiple reviewers per application (up to 5)
-- Create junction table for application_reviewers

CREATE TABLE IF NOT EXISTS public.application_reviewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.startup_applications(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Ensure a reviewer can only be assigned once per application
  UNIQUE(application_id, reviewer_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_application_reviewers_application_id ON public.application_reviewers(application_id);
CREATE INDEX IF NOT EXISTS idx_application_reviewers_reviewer_id ON public.application_reviewers(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_application_reviewers_assigned_at ON public.application_reviewers(assigned_at DESC);

-- Enable Row Level Security
ALTER TABLE public.application_reviewers ENABLE ROW LEVEL SECURITY;

-- Allow reviewers to view their own assignments
CREATE POLICY "Reviewers can view their assignments"
  ON public.application_reviewers FOR SELECT
  USING (
    reviewer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Allow managers to assign reviewers
CREATE POLICY "Managers can assign reviewers"
  ON public.application_reviewers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Allow managers to remove reviewer assignments
CREATE POLICY "Managers can remove reviewer assignments"
  ON public.application_reviewers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Create function to enforce maximum 5 reviewers per application
CREATE OR REPLACE FUNCTION public.check_max_reviewers()
RETURNS TRIGGER AS $$
DECLARE
  reviewer_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO reviewer_count
  FROM public.application_reviewers
  WHERE application_id = NEW.application_id;
  
  IF reviewer_count >= 5 THEN
    RAISE EXCEPTION 'Maximum of 5 reviewers allowed per application';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce maximum reviewers
CREATE TRIGGER enforce_max_reviewers
  BEFORE INSERT ON public.application_reviewers
  FOR EACH ROW
  EXECUTE FUNCTION public.check_max_reviewers();

-- Migrate existing reviewer_id assignments to the new junction table
INSERT INTO public.application_reviewers (application_id, reviewer_id, assigned_at)
SELECT id, reviewer_id, created_at
FROM public.startup_applications
WHERE reviewer_id IS NOT NULL
ON CONFLICT (application_id, reviewer_id) DO NOTHING;

-- Note: We keep reviewer_id column for backward compatibility but it's now optional
-- The junction table is the source of truth for reviewer assignments
