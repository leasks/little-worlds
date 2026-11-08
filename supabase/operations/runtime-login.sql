-- Run only as the trusted migration owner after approval, never as the web app.
-- This file contains no password. Set it privately afterward using psql \password.
CREATE ROLE little_worlds_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT little_worlds_runtime TO little_worlds_app;
