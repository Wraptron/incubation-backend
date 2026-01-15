-- Create enum for application status
CREATE TYPE application_status AS ENUM ('pending', 'under_review', 'approved', 'rejected', 'withdrawn');

-- Create enum for funding stage
CREATE TYPE funding_stage AS ENUM ('pre_seed', 'seed', 'series_a', 'series_b', 'series_c_plus', 'bootstrapped');

-- Create startup_applications table
CREATE TABLE IF NOT EXISTS public.startup_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Company Information
  company_name TEXT NOT NULL,
  website TEXT,
  description TEXT NOT NULL,
  
  -- Founder Information
  founder_name TEXT NOT NULL,
  co_founders TEXT,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  
  -- Business Details
  problem TEXT NOT NULL,
  solution TEXT NOT NULL,
  target_market TEXT NOT NULL,
  business_model TEXT NOT NULL,
  
  -- Funding & Traction
  funding_stage funding_stage,
  funding_amount TEXT,
  current_traction TEXT,
  
  -- Application Details
  why_incubator TEXT NOT NULL,
  status application_status NOT NULL DEFAULT 'pending',
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  
  -- Constraints
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Create indexes for better query performance
CREATE INDEX idx_startup_applications_user_id ON public.startup_applications(user_id);
CREATE INDEX idx_startup_applications_status ON public.startup_applications(status);
CREATE INDEX idx_startup_applications_created_at ON public.startup_applications(created_at DESC);
CREATE INDEX idx_startup_applications_email ON public.startup_applications(email);

-- Enable Row Level Security
ALTER TABLE public.startup_applications ENABLE ROW LEVEL SECURITY;

-- Create policy to allow anonymous inserts (for public application form)
CREATE POLICY "Allow anonymous application creation"
  ON public.startup_applications FOR INSERT
  WITH CHECK (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update updated_at
CREATE TRIGGER update_startup_applications_updated_at
  BEFORE UPDATE ON public.startup_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
