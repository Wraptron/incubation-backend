import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://dfzfmtthyvwltwwmntmd.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmemZtdHRoeXZ3bHR3d21udG1kIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODQwNDk0NiwiZXhwIjoyMDgzOTgwOTQ2fQ.m8DKbf04d5Awu99sYyTIpv15xvnkoXV3WTOlk4GP8HE';

// Create Supabase client with service role key (bypasses RLS)
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Test database connection
export const testConnection = async (): Promise<boolean> => {
  try {
    console.log('🔄 Testing Supabase connection...');
    console.log(`📍 URL: ${SUPABASE_URL}`);
    
    const { data, error } = await supabase
      .from('applications')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('❌ Supabase connection failed:', error.message);
      return false;
    }
    
    console.log('✅ Supabase connected successfully!');
    return true;
  } catch (error) {
    console.error('❌ Supabase connection error:', error);
    return false;
  }
};

// Alternative: Generic health check that doesn't require specific tables
export const testConnectionGeneric = async (): Promise<boolean> => {
  try {
    console.log('🔄 Testing Supabase connection...');
    console.log(`📍 URL: ${SUPABASE_URL}`);
    
    const { error } = await supabase.rpc('ping').then(
      () => ({ error: null }),
      (err) => ({ error: err })
    );
    
    const { data, error: authError } = await supabase.auth.getUser();
    
    if (authError && authError.message.includes('no rows')) {
      console.log('✅ Supabase connected successfully!');
      return true;
    }
    
    if (authError && !authError.message.includes('no rows')) {
      console.error('❌ Supabase connection failed:', authError.message);
      return false;
    }
    
    console.log('✅ Supabase connected successfully!');
    return true;
  } catch (error) {
    console.error('❌ Supabase connection error:', error);
    return false;
  }
};

// Optional: Create a separate client for user-level operations
export const createUserClient = (accessToken: string) => {
  return createClient(
    SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY || '',
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );
};