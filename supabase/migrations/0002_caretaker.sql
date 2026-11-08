ALTER TABLE little_worlds.actors ADD COLUMN state jsonb NOT NULL DEFAULT '{"location":"cottage","inventory":{"berries":12,"seeds":3},"crops":0}'::jsonb;
CREATE TABLE little_worlds.agent_credentials (
 world_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), actor_id text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 role text NOT NULL CHECK(role IN ('caretaker','narrator')), expires_at timestamptz NOT NULL,
 revoked boolean NOT NULL DEFAULT false, window_start timestamptz NOT NULL DEFAULT now(), requests integer NOT NULL DEFAULT 0 CHECK(requests>=0),
 PRIMARY KEY(world_id,id), FOREIGN KEY(world_id,actor_id) REFERENCES little_worlds.actors(world_id,id)
);
CREATE TABLE little_worlds.action_receipts (
 world_id uuid NOT NULL, actor_id text NOT NULL, request_id text NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128),
 command jsonb NOT NULL, result jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,actor_id,request_id), FOREIGN KEY(world_id,actor_id) REFERENCES little_worlds.actors(world_id,id)
);
CREATE TRIGGER immutable_actions BEFORE UPDATE OR DELETE ON little_worlds.action_receipts FOR EACH ROW EXECUTE FUNCTION little_worlds.reject_history_change();
DO $$ DECLARE fk text; BEGIN
 SELECT conname INTO fk FROM pg_constraint WHERE conrelid='little_worlds.event_journal'::regclass AND confrelid='little_worlds.simulation_ticks'::regclass;
 EXECUTE format('ALTER TABLE little_worlds.event_journal DROP CONSTRAINT %I',fk);
END $$;
ALTER TABLE little_worlds.event_journal ADD COLUMN tick_request_id text;
ALTER TABLE little_worlds.event_journal ADD COLUMN action_request_id text;
ALTER TABLE little_worlds.event_journal ADD COLUMN initiating_actor_id text;
-- Disable only the history guard while migrating existing provenance columns.
ALTER TABLE little_worlds.event_journal DISABLE TRIGGER immutable_journal;
UPDATE little_worlds.event_journal SET tick_request_id=correlation_id;
ALTER TABLE little_worlds.event_journal ENABLE TRIGGER immutable_journal;
ALTER TABLE little_worlds.event_journal ADD FOREIGN KEY(world_id,tick_request_id) REFERENCES little_worlds.simulation_ticks(world_id,request_id);
ALTER TABLE little_worlds.event_journal ADD FOREIGN KEY(world_id,initiating_actor_id,action_request_id) REFERENCES little_worlds.action_receipts(world_id,actor_id,request_id);
ALTER TABLE little_worlds.event_journal ADD CHECK(
 (source='simulation' AND tick_request_id IS NOT NULL AND tick_request_id=correlation_id AND action_request_id IS NULL AND initiating_actor_id IS NULL)
 OR (source='caretaker' AND action_request_id IS NOT NULL AND action_request_id=correlation_id AND initiating_actor_id IS NOT NULL AND tick_request_id IS NULL));
ALTER TABLE little_worlds.agent_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE little_worlds.action_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY server_access ON little_worlds.agent_credentials TO little_worlds_runtime USING(true) WITH CHECK(true);
CREATE POLICY server_access ON little_worlds.action_receipts TO little_worlds_runtime USING(true) WITH CHECK(true);
GRANT SELECT,UPDATE ON little_worlds.agent_credentials TO little_worlds_runtime;
GRANT SELECT,INSERT ON little_worlds.action_receipts TO little_worlds_runtime;
GRANT UPDATE ON little_worlds.actors TO little_worlds_runtime;
CREATE INDEX actions_time ON little_worlds.action_receipts(world_id,recorded_at);
