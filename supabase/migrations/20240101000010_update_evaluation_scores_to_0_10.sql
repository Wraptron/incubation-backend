-- Migration to update evaluation score constraints from 1-10 to 0-10

-- Drop existing check constraints
ALTER TABLE public.application_evaluations
DROP CONSTRAINT IF EXISTS application_evaluations_need_score_check;

ALTER TABLE public.application_evaluations
DROP CONSTRAINT IF EXISTS application_evaluations_novelty_score_check;

ALTER TABLE public.application_evaluations
DROP CONSTRAINT IF EXISTS application_evaluations_feasibility_scalability_score_check;

ALTER TABLE public.application_evaluations
DROP CONSTRAINT IF EXISTS application_evaluations_market_potential_score_check;

ALTER TABLE public.application_evaluations
DROP CONSTRAINT IF EXISTS application_evaluations_impact_score_check;

-- Add new check constraints allowing 0-10
ALTER TABLE public.application_evaluations
ADD CONSTRAINT application_evaluations_need_score_check 
CHECK (need_score >= 0 AND need_score <= 10);

ALTER TABLE public.application_evaluations
ADD CONSTRAINT application_evaluations_novelty_score_check 
CHECK (novelty_score >= 0 AND novelty_score <= 10);

ALTER TABLE public.application_evaluations
ADD CONSTRAINT application_evaluations_feasibility_scalability_score_check 
CHECK (feasibility_scalability_score >= 0 AND feasibility_scalability_score <= 10);

ALTER TABLE public.application_evaluations
ADD CONSTRAINT application_evaluations_market_potential_score_check 
CHECK (market_potential_score >= 0 AND market_potential_score <= 10);

ALTER TABLE public.application_evaluations
ADD CONSTRAINT application_evaluations_impact_score_check 
CHECK (impact_score >= 0 AND impact_score <= 10);
