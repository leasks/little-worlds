CREATE TABLE little_worlds.scheduler_runs(
 world_id uuid NOT NULL REFERENCES little_worlds.worlds,request_id text NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128),
 status text NOT NULL CHECK(status IN ('started','succeeded','failed')),attempts integer NOT NULL DEFAULT 1 CHECK(attempts>0),
 started_at timestamptz NOT NULL DEFAULT now(),last_attempt_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 result jsonb,error_code text CHECK(error_code ~ '^[A-Z_]+$'),PRIMARY KEY(world_id,request_id),
 CHECK(status<>'succeeded' OR (result IS NOT NULL AND finished_at IS NOT NULL))
);
ALTER TABLE little_worlds.scheduler_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY server_access ON little_worlds.scheduler_runs TO little_worlds_runtime USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON little_worlds.scheduler_runs TO little_worlds_runtime;
CREATE INDEX scheduler_last_attempt ON little_worlds.scheduler_runs(world_id,last_attempt_at DESC);
