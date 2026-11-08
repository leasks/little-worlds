ALTER TABLE little_worlds.world_settings ADD COLUMN is_test boolean NOT NULL DEFAULT false;
ALTER TABLE little_worlds.world_settings ADD COLUMN paused boolean NOT NULL DEFAULT false;
ALTER TABLE little_worlds.world_settings ADD COLUMN paused_at_ms double precision;
ALTER TABLE little_worlds.world_settings ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE little_worlds.world_settings ADD CHECK(paused=(paused_at_ms IS NOT NULL));
CREATE TABLE little_worlds.operator_login_limits(
 world_id uuid PRIMARY KEY REFERENCES little_worlds.worlds,window_start timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL CHECK(attempts>0)
);
CREATE TABLE little_worlds.operator_sessions(
 world_id uuid NOT NULL,token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),credential_id uuid NOT NULL,
 root_world_id uuid NOT NULL,root_credential_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,
 FOREIGN KEY(world_id,credential_id) REFERENCES little_worlds.agent_credentials(world_id,id),
 FOREIGN KEY(root_world_id,root_credential_id) REFERENCES little_worlds.agent_credentials(world_id,id)
);
CREATE INDEX operator_session_expiry ON little_worlds.operator_sessions(expires_at);
CREATE TABLE little_worlds.operator_commands(
 world_id uuid NOT NULL,actor_id text NOT NULL,request_id text NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128),
 command jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,actor_id,request_id),FOREIGN KEY(world_id,actor_id) REFERENCES little_worlds.actors(world_id,id)
);
CREATE TABLE little_worlds.operator_audit(
 world_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),actor_id text NOT NULL,action text NOT NULL,details jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(world_id,id),FOREIGN KEY(world_id,actor_id) REFERENCES little_worlds.actors(world_id,id)
);
CREATE TRIGGER immutable_operator_commands BEFORE UPDATE OR DELETE ON little_worlds.operator_commands FOR EACH ROW EXECUTE FUNCTION little_worlds.reject_history_change();
CREATE TRIGGER immutable_operator_audit BEFORE UPDATE OR DELETE ON little_worlds.operator_audit FOR EACH ROW EXECUTE FUNCTION little_worlds.reject_history_change();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['operator_login_limits','operator_sessions','operator_commands','operator_audit'] LOOP
 EXECUTE format('ALTER TABLE little_worlds.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY server_access ON little_worlds.%I TO little_worlds_runtime USING(true) WITH CHECK(true)',t);
 EXECUTE format('GRANT SELECT,INSERT ON little_worlds.%I TO little_worlds_runtime',t);
 END LOOP;
END $$;
GRANT UPDATE ON little_worlds.operator_login_limits TO little_worlds_runtime;
GRANT UPDATE(revoked) ON little_worlds.operator_sessions TO little_worlds_runtime;
GRANT UPDATE(paused,paused_at_ms,archived,is_test) ON little_worlds.world_settings TO little_worlds_runtime;
-- A narrow helper for fresh local-test resets. It cannot issue other roles or copy live access.
CREATE FUNCTION little_worlds.derive_test_operator(old_world uuid,old_credential uuid,new_world uuid,new_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,little_worlds AS $$
DECLARE source little_worlds.agent_credentials; issued uuid:=gen_random_uuid();
BEGIN
 SELECT c.* INTO source FROM little_worlds.agent_credentials c JOIN little_worlds.world_settings w USING(world_id)
 WHERE c.world_id=old_world AND c.id=old_credential AND c.role='operator' AND NOT c.revoked AND c.expires_at>now() AND w.is_test;
 IF source.id IS NULL OR NOT EXISTS(SELECT 1 FROM little_worlds.world_settings WHERE world_id=new_world AND is_test) THEN RAISE EXCEPTION 'Test operator derivation denied'; END IF;
 INSERT INTO little_worlds.agent_credentials(world_id,id,actor_id,token_hash,role,expires_at)
 VALUES(new_world,issued,'local-operator',new_hash,'operator',LEAST(source.expires_at,now()+interval '8 hours'));
 RETURN issued;
END;
$$;
REVOKE ALL ON FUNCTION little_worlds.derive_test_operator(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION little_worlds.derive_test_operator(uuid,uuid,uuid,text) TO little_worlds_runtime;
