-- Runtime authentication may advance counters, never mint/rebind/revive credentials.
REVOKE UPDATE ON little_worlds.agent_credentials FROM little_worlds_runtime;
GRANT UPDATE(window_start,requests) ON little_worlds.agent_credentials TO little_worlds_runtime;
REVOKE UPDATE ON little_worlds.actors FROM little_worlds_runtime;
GRANT UPDATE(state) ON little_worlds.actors TO little_worlds_runtime;
