CREATE TABLE little_worlds.experiment_runs(
 world_id uuid PRIMARY KEY REFERENCES little_worlds.worlds,
 config jsonb NOT NULL,source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN ('running','completed','failed')),
 completed_days integer NOT NULL DEFAULT 0 CHECK(completed_days BETWEEN 0 AND 30),
 initial_snapshot jsonb NOT NULL,report jsonb,semantic_hash text,
 failure_code text CHECK(failure_code ~ '^[A-Z_]+$'),
 started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 CHECK(status<>'completed' OR (report IS NOT NULL AND semantic_hash IS NOT NULL AND finished_at IS NOT NULL AND completed_days=(config->>'days')::integer))
);
CREATE TABLE little_worlds.experiment_inputs(
 world_id uuid NOT NULL REFERENCES little_worlds.experiment_runs,
 sequence integer NOT NULL CHECK(sequence>0),day integer NOT NULL CHECK(day BETWEEN 1 AND 30),
 label text NOT NULL,kind text NOT NULL CHECK(kind IN ('tick','action','narrator','proposal','review')),
 input jsonb NOT NULL,outcome jsonb,status text NOT NULL CHECK(status IN ('pending','completed','failed')),
 PRIMARY KEY(world_id,sequence),UNIQUE(world_id,label),
 CHECK((status='pending' AND outcome IS NULL) OR (status<>'pending' AND outcome IS NOT NULL))
);
CREATE TABLE little_worlds.experiment_days(
 world_id uuid NOT NULL REFERENCES little_worlds.experiment_runs,day integer NOT NULL CHECK(day BETWEEN 1 AND 30),
 snapshot jsonb NOT NULL,PRIMARY KEY(world_id,day)
);
CREATE TRIGGER immutable_experiment_days BEFORE UPDATE OR DELETE ON little_worlds.experiment_days FOR EACH ROW EXECUTE FUNCTION little_worlds.reject_history_change();
CREATE FUNCTION little_worlds.final_experiment_row() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF OLD.status IN ('completed','failed') THEN RAISE EXCEPTION 'Experiment record is final'; END IF; RETURN NEW; END;
$$;
REVOKE ALL ON FUNCTION little_worlds.final_experiment_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION little_worlds.final_experiment_row() TO little_worlds_runtime;
CREATE TRIGGER final_experiment_run BEFORE UPDATE OR DELETE ON little_worlds.experiment_runs FOR EACH ROW EXECUTE FUNCTION little_worlds.final_experiment_row();
CREATE TRIGGER final_experiment_input BEFORE UPDATE OR DELETE ON little_worlds.experiment_inputs FOR EACH ROW EXECUTE FUNCTION little_worlds.final_experiment_row();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['experiment_runs','experiment_inputs','experiment_days'] LOOP
 EXECUTE format('ALTER TABLE little_worlds.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY server_access ON little_worlds.%I TO little_worlds_runtime USING(true) WITH CHECK(true)',t);
 EXECUTE format('GRANT SELECT,INSERT ON little_worlds.%I TO little_worlds_runtime',t);
 END LOOP;
END $$;
GRANT UPDATE(completed_days,status,report,semantic_hash,failure_code,finished_at) ON little_worlds.experiment_runs TO little_worlds_runtime;
GRANT UPDATE(outcome,status) ON little_worlds.experiment_inputs TO little_worlds_runtime;
