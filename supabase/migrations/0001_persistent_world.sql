-- Server-only PostgreSQL schema. Never grant this role to browser/agent logins.
CREATE ROLE little_worlds_runtime NOLOGIN;
CREATE SCHEMA little_worlds;
REVOKE ALL ON SCHEMA little_worlds FROM PUBLIC;
GRANT USAGE ON SCHEMA little_worlds TO little_worlds_runtime;
CREATE TABLE little_worlds.worlds (
 world_id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name)>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE little_worlds.world_settings (
 world_id uuid PRIMARY KEY REFERENCES little_worlds.worlds,
 multiplier double precision NOT NULL CHECK(multiplier>0 AND multiplier<=100),
 interval_ms integer NOT NULL CHECK(interval_ms BETWEEN 1000 AND 3600000)
);
CREATE TABLE little_worlds.simulation_state (
 world_id uuid PRIMARY KEY REFERENCES little_worlds.worlds,
 virtual_time double precision NOT NULL CHECK(virtual_time>=0 AND virtual_time<'Infinity'),
 last_real_time double precision NOT NULL CHECK(last_real_time>=0 AND last_real_time<'Infinity'),
 tick bigint NOT NULL CHECK(tick>=0), random_state bigint NOT NULL CHECK(random_state BETWEEN 1 AND 4294967295),
 weather text NOT NULL CHECK(weather IN ('clear','rain','cloudy'))
);
CREATE TABLE little_worlds.locations (
 world_id uuid NOT NULL REFERENCES little_worlds.worlds, id text NOT NULL,
 name text NOT NULL, actions jsonb NOT NULL CHECK(jsonb_typeof(actions)='array'),
 PRIMARY KEY(world_id,id)
);
CREATE TABLE little_worlds.actors (
 world_id uuid NOT NULL REFERENCES little_worlds.worlds, id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('caretaker','operator','narrator')), PRIMARY KEY(world_id,id)
);
CREATE FUNCTION little_worlds.bounded_attributes(value jsonb, keys text[]) RETURNS boolean
 LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
 SELECT jsonb_typeof(value)='object' AND
 (SELECT count(*) FROM jsonb_object_keys(value))=cardinality(keys) AND
 NOT EXISTS(SELECT 1 FROM unnest(keys) k WHERE value->k IS NULL OR
 jsonb_typeof(value->k)<>'number' OR NOT ((value->>k)::numeric BETWEEN 0 AND 100));
$$;
CREATE TABLE little_worlds.creatures (
 world_id uuid NOT NULL REFERENCES little_worlds.worlds, id text NOT NULL,
 location_id text NOT NULL, owner_id text, data jsonb NOT NULL,
 PRIMARY KEY(world_id,id),
 FOREIGN KEY(world_id,location_id) REFERENCES little_worlds.locations(world_id,id),
 FOREIGN KEY(world_id,owner_id) REFERENCES little_worlds.actors(world_id,id),
 CHECK((data->>'id') IS NOT DISTINCT FROM id),
 CHECK((data->>'world_id') IS NOT DISTINCT FROM world_id::text),
 CHECK((data->>'location') IS NOT DISTINCT FROM location_id),
 CHECK((data->>'owner') IS NOT DISTINCT FROM owner_id),
 CHECK(data ? 'needs' AND little_worlds.bounded_attributes(data->'needs',ARRAY['hunger','energy','happiness','health'])),
 CHECK(data ? 'traits' AND little_worlds.bounded_attributes(data->'traits',ARRAY['curiosity','energy','sociability','patience','caution']))
);
CREATE INDEX creatures_location ON little_worlds.creatures(world_id,location_id);
CREATE TABLE little_worlds.simulation_ticks (
 world_id uuid NOT NULL REFERENCES little_worlds.worlds, request_id text NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128),
 tick_from bigint NOT NULL, tick_to bigint NOT NULL CHECK(tick_to>=tick_from),
 virtual_time double precision NOT NULL CHECK(virtual_time>=0),
 real_time double precision NOT NULL CHECK(real_time>=0), committed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,request_id)
);
CREATE TABLE little_worlds.event_journal (
 world_id uuid NOT NULL REFERENCES little_worlds.worlds, id text NOT NULL,
 virtual_time double precision NOT NULL CHECK(virtual_time>=0), real_time double precision NOT NULL CHECK(real_time>=0),
 recorded_at timestamptz NOT NULL DEFAULT now(), source text NOT NULL, event_type text NOT NULL,
 actor_id text NOT NULL, location_id text NOT NULL, payload jsonb NOT NULL, effects jsonb NOT NULL,
 correlation_id text NOT NULL, PRIMARY KEY(world_id,id),
 FOREIGN KEY(world_id,actor_id) REFERENCES little_worlds.creatures(world_id,id),
 FOREIGN KEY(world_id,location_id) REFERENCES little_worlds.locations(world_id,id),
 FOREIGN KEY(world_id,correlation_id) REFERENCES little_worlds.simulation_ticks(world_id,request_id)
);
CREATE INDEX journal_time ON little_worlds.event_journal(world_id,virtual_time,id);
CREATE INDEX journal_actor ON little_worlds.event_journal(world_id,actor_id,virtual_time);
CREATE FUNCTION little_worlds.reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'History is append-only'; END;
$$;
CREATE TRIGGER immutable_journal BEFORE UPDATE OR DELETE ON little_worlds.event_journal
 FOR EACH ROW EXECUTE FUNCTION little_worlds.reject_history_change();
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE ON little_worlds.simulation_ticks
 FOR EACH ROW EXECUTE FUNCTION little_worlds.reject_history_change();
CREATE FUNCTION little_worlds.monotonic_clock() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF NEW.virtual_time<OLD.virtual_time OR NEW.last_real_time<OLD.last_real_time OR NEW.tick<OLD.tick THEN
 RAISE EXCEPTION 'Simulation clock must be monotonic'; END IF; RETURN NEW;
 END;
$$;
CREATE TRIGGER monotonic_state BEFORE UPDATE ON little_worlds.simulation_state
 FOR EACH ROW EXECUTE FUNCTION little_worlds.monotonic_clock();
-- No policies for anon/authenticated/PUBLIC: private by default on Supabase too.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['worlds','world_settings','simulation_state','locations','actors','creatures','simulation_ticks','event_journal'] LOOP
 EXECUTE format('ALTER TABLE little_worlds.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY server_access ON little_worlds.%I TO little_worlds_runtime USING (true) WITH CHECK (true)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA little_worlds TO little_worlds_runtime;
GRANT UPDATE ON little_worlds.simulation_state,little_worlds.creatures TO little_worlds_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA little_worlds FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA little_worlds TO little_worlds_runtime;
