-- Migration to create application_evaluations table
-- This stores detailed evaluations by reviewers with scores and comments for each criteria

CREATE TABLE IF NOT EXISTS public.application_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.startup_applications(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Evaluation Criteria Scores (1-10 Likert scale)
  need_score INTEGER CHECK (need_score >= 1 AND need_score <= 10),
  novelty_score INTEGER CHECK (novelty_score >= 1 AND novelty_score <= 10),
  feasibility_scalability_score INTEGER CHECK (feasibility_scalability_score >= 1 AND feasibility_scalability_score <= 10),
  market_potential_score INTEGER CHECK (market_potential_score >= 1 AND market_potential_score <= 10),
  impact_score INTEGER CHECK (impact_score >= 1 AND impact_score <= 10),
  
  -- Evaluation Criteria Comments
  need_comment TEXT,
  novelty_comment TEXT,
  feasibility_scalability_comment TEXT,
  market_potential_comment TEXT,
  impact_comment TEXT,
  
  -- Overall Comment
  overall_comment TEXT,
  
  -- Calculated total score (sum of all criteria scores)
  total_score INTEGER GENERATED ALWAYS AS (
    COALESCE(need_score, 0) +
    COALESCE(novelty_score, 0) +
    COALESCE(feasibility_scalability_score, 0) +
    COALESCE(market_potential_score, 0) +
    COALESCE(impact_score, 0)
  ) STORED,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  
  -- Ensure one evaluation per reviewer per application
  UNIQUE(application_id, reviewer_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_application_evaluations_application_id ON public.application_evaluations(application_id);
CREATE INDEX IF NOT EXISTS idx_application_evaluations_reviewer_id ON public.application_evaluations(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_application_evaluations_total_score ON public.application_evaluations(total_score DESC);
CREATE INDEX IF NOT EXISTS idx_application_evaluations_created_at ON public.application_evaluations(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.application_evaluations ENABLE ROW LEVEL SECURITY;

-- Allow reviewers to view their own evaluations
CREATE POLICY "Reviewers can view their own evaluations"
  ON public.application_evaluations FOR SELECT
  USING (
    reviewer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Allow reviewers to create evaluations for applications assigned to them
CREATE POLICY "Reviewers can create evaluations"
  ON public.application_evaluations FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'reviewer'
    )
    AND EXISTS (
      SELECT 1 FROM public.application_reviewers
      WHERE application_id = application_evaluations.application_id
      AND reviewer_id = auth.uid()
    )
  );

-- Allow reviewers to update their own evaluations
CREATE POLICY "Reviewers can update their own evaluations"
  ON public.application_evaluations FOR UPDATE
  USING (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'reviewer'
    )
  );

-- Allow managers to view all evaluations
CREATE POLICY "Managers can view all evaluations"
  ON public.application_evaluations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_application_evaluations_updated_at
  BEFORE UPDATE ON public.application_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
