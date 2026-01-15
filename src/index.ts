import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Supabase Configuration
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
    
    // Simple connection test - just check if we can connect
    const { error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    
    if (error && !error.message.includes('no rows')) {
      console.error('❌ Supabase connection failed:', error.message);
      return false;
    }
    
    console.log('✅ Supabase connected successfully!');
    return true;
  } catch (error) {
    console.error('❌ Supabase connection error:', error);
    console.log('⚠️  Connection test failed, but server is running. Check your Supabase credentials.');
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

// Middleware
app.use(cors());
// Increase body size limit to 50MB to handle file uploads (base64 encoded)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Backend server is running' });
});

// API routes
app.get('/api', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to the Incubation Screen API' });
});

// Import routes only if they exist
try {
  const applicationsRouter = require('./routes/applications').default;
  app.use('/api/applications', applicationsRouter);
  console.log('✅ Applications routes loaded');
} catch (error) {
  console.log('⚠️  Applications routes not found - skipping');
}

try {
  const evaluationsRouter = require('./routes/evaluations').default;
  app.use('/api/evaluations', evaluationsRouter);
  console.log('✅ Evaluations routes loaded');
} catch (error) {
  console.log('⚠️  Evaluations routes not found - skipping');
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 Applications API: http://localhost:${PORT}/api/applications`);
  
  // Test Supabase connection on startup
  await testConnection();
});