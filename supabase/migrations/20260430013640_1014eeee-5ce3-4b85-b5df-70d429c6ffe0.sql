CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior job
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'process-recurring-expenses-hourly';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'process-recurring-expenses-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qapdpfahcvdrfwkbyacx.supabase.co/functions/v1/process-recurring-expenses',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $$
);